/**
 * orchestrator.ts — 多租户会话编排器
 *
 * 职责：
 *   1. 为每个用户会话 fork 一个独立的 headless-server 子进程
 *   2. 将子进程的 NDJSON stdout 流转发给上游（HTTP/WebSocket 层）
 *   3. 管理用户目录的初始化和生命周期
 *   4. 确保进程级隔离——一个用户崩溃不影响其他用户
 *
 * 本模块是纯 Node.js 层，不依赖 claude-code 内部模块。
 * 它通过 child_process.fork() 启动 headless-server.ts，利用操作系统进程边界实现强隔离。
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs'
import { EventEmitter } from 'events'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'

const LOGS_DIR = resolve(import.meta.dir, '..', '..', '..', '..', 'logs')

function logToOrchestrator(message: string): void {
  try {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true })
    }
    const timestamp = new Date().toISOString()
    appendFileSync(join(LOGS_DIR, 'orchestrator.log'), `[${timestamp}] ${message}\n`, 'utf-8')
  } catch (err) {
    // ignore
  }
}

function logSessionStream(conversationId: string, streamType: 'stdout' | 'stderr', data: string): void {
  try {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true })
    }
    appendFileSync(join(LOGS_DIR, `session_${conversationId}.log`), `[${new Date().toISOString()}] [${streamType}] ${data}`, 'utf-8')
  } catch (err) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

/** 用户身份信息——由认证层提供 */
export type UserIdentity = {
  userId: string
  displayName?: string
  clientOS: 'win32' | 'darwin' | 'linux'
  clientShell?: string
  /** 用户自带的 API 配置（如 ANTHROPIC_API_KEY, CLAUDE_ 等） */
  envOverrides?: Record<string, string>
}

/** 编排器配置 */
export type OrchestratorConfig = {
  /** 用户数据根目录（每个用户一个子目录） */
  dataRoot: string
  /** headless-server.ts 的绝对路径 */
  serverScript: string
  /** 单用户最大并发会话数 */
  maxSessionsPerUser?: number
  /** 子进程超时时间（毫秒） */
  sessionTimeoutMs?: number
}

/** 会话状态 */
export type SessionState = 'starting' | 'running' | 'completed' | 'error' | 'timeout'

/** 活跃会话的元数据 */
type ActiveSession = {
  sessionId: string
  userId: string
  process: ChildProcess
  state: SessionState
  startedAt: number
  timeoutTimer?: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// 2. 用户目录初始化
// ---------------------------------------------------------------------------

/**
 * 为用户创建隔离的云端工作目录
 * 目录结构:
 *   {dataRoot}/{userId}/
 *     .CLAUDE/           — claude-code 配置 & 会话存储
 *     workspace/          — 云端影子工作区（文件同步的目标）
 *     logs/               — 会话日志
 */
export function initializeUserDirectory(dataRoot: string, userId: string, projectName?: string, sessionId?: string): string {
  const userDir = projectName 
    ? resolve(dataRoot, userId, 'projects', projectName) 
    : resolve(dataRoot, userId)
  const dirs = [
    join(userDir, '.CLAUDE'),
    join(userDir, 'workspace'),
    join(userDir, 'logs'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // 写入元数据标记（用于审计和调试）
  const metaPath = join(userDir, '.CLAUDE', 'tenant-meta.json')
  if (!existsSync(metaPath)) {
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          userId,
          projectName,
          sessionId,
          createdAt: new Date().toISOString(),
          version: 1,
        },
        null,
        2,
      ),
      'utf-8',
    )
  }

  return userDir
}

// ---------------------------------------------------------------------------
// 3. 编排器核心
// ---------------------------------------------------------------------------

export class SessionOrchestrator extends EventEmitter {
  private config: OrchestratorConfig
  private sessions: Map<string, ActiveSession> = new Map()
  private userSessionCount: Map<string, number> = new Map()

  constructor(config: OrchestratorConfig) {
    super()
    this.config = config

    // 确保数据根目录存在
    if (!existsSync(config.dataRoot)) {
      mkdirSync(config.dataRoot, { recursive: true })
    }
  }

  /**
   * 启动一个新的用户会话
   * @returns sessionId——用于后续操作（如发送消息、终止会话）
   */
  startSession(
    user: UserIdentity,
    prompt: string,
    options?: { model?: string; maxTurns?: number; maxBudgetUsd?: number; conversationId?: string; workspacePath?: string },
  ): string {
    const maxSessions = this.config.maxSessionsPerUser ?? 3
    const currentCount = this.userSessionCount.get(user.userId) ?? 0

    if (currentCount >= maxSessions) {
      throw new Error(
        `User ${user.userId} has reached max concurrent sessions (${maxSessions})`,
      )
    }

    let projectName = 'default-project'
    if (options?.workspacePath) {
      const normalized = options.workspacePath.replace(/\\/g, '/')
      const parts = normalized.split('/').filter(Boolean)
      if (parts.length > 0) {
        projectName = parts[parts.length - 1]
      }
    }

    const conversationId = options?.conversationId || randomUUID()
    const sessionId = randomUUID()
    // 初始化项目级同名隔离目录
    const userDir = initializeUserDirectory(this.config.dataRoot, user.userId, projectName, sessionId)

    const isAbsolute = (p: string) => {
      return p.startsWith('/') || p.includes(':') || p.startsWith('\\\\')
    }
    const remoteCwd = (options?.workspacePath && isAbsolute(options.workspacePath))
      ? options.workspacePath
      : join(userDir, 'workspace')

    // 构建 headless-server 的配置
    const sessionConfig = {
      prompt,
      sessionDir: userDir,
      remoteCwd,
      clientOS: user.clientOS,
      clientShell: user.clientShell,
      model: options?.model,
      maxTurns: options?.maxTurns,
      maxBudgetUsd: options?.maxBudgetUsd,
      envOverrides: user.envOverrides,
      sessionId: conversationId,
    }

    // Spawn 子进程——关键：每个用户会话在独立进程中运行
    // 使用 bun run 以确保正确的 TypeScript 模块解析
    const spawnMsg = `[Orchestrator] Spawning child process for ${user.userId} with session ${sessionId} (conversationId=${conversationId})...`
    console.log(spawnMsg)
    logToOrchestrator(spawnMsg)
    const child = spawn('bun', ['run', this.config.serverScript, '--stdin'], {
      // 使用独立的 stdio 管道，而非继承父进程的
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      // 不继承父进程的环境变量——由 headless-server 自己根据 config 注入
      env: {
        ...process.env,
        // 覆盖关键隔离变量
        CLAUDE_: join(userDir, '.CLAUDE'),
        HOME: userDir,
        USERPROFILE: userDir,
      },
    })

    // 通过 stdin 发送 JSON 配置，避免 Windows CLI 参数引号被吃掉的问题
    child.stdin.write(JSON.stringify(sessionConfig))
    child.stdin.end()

    const session: ActiveSession = {
      sessionId,
      userId: user.userId,
      process: child,
      state: 'starting',
      startedAt: Date.now(),
    }

    // 设置超时保护
    const timeoutMs = this.config.sessionTimeoutMs ?? 300_000 // 默认 5 分钟
    session.timeoutTimer = setTimeout(() => {
      this.terminateSession(sessionId, 'timeout')
    }, timeoutMs)

    this.sessions.set(sessionId, session)
    this.userSessionCount.set(user.userId, currentCount + 1)

    // 监听子进程 stdout（NDJSON 流）并持久化到 logs
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const dataStr = chunk.toString('utf-8')
      logSessionStream(conversationId, 'stdout', dataStr)
      buffer += dataStr
      const lines = buffer.split('\n')
      // 保留最后一个不完整的行
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'session_start') {
            session.state = 'running'
          }
          // 向上层转发（WebSocket 层会监听这些事件）
          this.emit('session:event', sessionId, user.userId, event)
        } catch {
          // 非 JSON 行（如 debug 输出）转发为 stderr
          this.emit('session:stderr', sessionId, user.userId, line)
        }
      }
    })

    // 监听子进程 stderr 并持久化到 logs，去重合并
    child.stderr?.on('data', (chunk: Buffer) => {
      const dataStr = chunk.toString('utf-8')
      logSessionStream(conversationId, 'stderr', dataStr)
      console.error(`[CHILD STDERR] ${dataStr.trim()}`)
      this.emit('session:stderr', sessionId, user.userId, dataStr)
    })

    // 监听子进程退出
    child.on('exit', (code, signal) => {
      console.log(`[Orchestrator] Child process for session ${sessionId} exited with code=${code} signal=${signal}`);
      session.state = code === 0 ? 'completed' : 'error'
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer)
      }
      this.cleanupSession(sessionId)
      this.emit('session:end', sessionId, user.userId, { code, signal })
    })

    child.on('error', (err) => {
      session.state = 'error'
      this.emit('session:error', sessionId, user.userId, err)
      this.cleanupSession(sessionId)
    })

    // 监听子进程的 IPC 消息（如 RPC 请求）
    child.on('message', (msg: any) => {
      if (msg && msg.type === 'RPC_REQUEST') {
        this.emit('session:rpc_request', sessionId, user.userId, msg)
      }
    })

    this.emit('session:start', sessionId, user.userId)
    return sessionId
  }

  /**
   * 将客户端的 RPC 响应送回给对应的 headless-server 子进程
   */
  sendRpcResponse(sessionId: string, response: any): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || !session.process.connected) return false
    
    session.process.send(response)
    return true
  }

  /** 终止一个会话 */
  terminateSession(sessionId: string, reason: 'timeout' | 'user_cancel' | 'admin' = 'user_cancel'): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    session.state = reason === 'timeout' ? 'timeout' : 'completed'
    session.process.kill('SIGTERM')

    // 给进程 5 秒优雅退出的时间，否则强杀
    setTimeout(() => {
      if (!session.process.killed) {
        session.process.kill('SIGKILL')
      }
    }, 5000)

    this.emit('session:terminate', sessionId, session.userId, reason)
    return true
  }

  /** 获取当前所有活跃会话 */
  getActiveSessions(): Array<{
    sessionId: string
    userId: string
    state: SessionState
    durationMs: number
  }> {
    const now = Date.now()
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      userId: s.userId,
      state: s.state,
      durationMs: now - s.startedAt,
    }))
  }

  /** 获取某用户的活跃会话数 */
  getUserSessionCount(userId: string): number {
    return this.userSessionCount.get(userId) ?? 0
  }

  /** 内部清理 */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer)
    }

    const currentCount = this.userSessionCount.get(session.userId) ?? 1
    if (currentCount <= 1) {
      this.userSessionCount.delete(session.userId)
    } else {
      this.userSessionCount.set(session.userId, currentCount - 1)
    }

    this.sessions.delete(sessionId)
  }

  /** 关闭所有会话 */
  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    for (const id of sessionIds) {
      this.terminateSession(id, 'admin')
    }
    // 等待所有子进程退出
    await new Promise<void>((resolve) => {
      if (this.sessions.size === 0) {
        resolve()
        return
      }
      const check = setInterval(() => {
        if (this.sessions.size === 0) {
          clearInterval(check)
          resolve()
        }
      }, 100)
    })
  }
}
