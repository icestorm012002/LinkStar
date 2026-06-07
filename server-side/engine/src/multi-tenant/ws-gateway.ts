/**
 * ws-gateway.ts — WebSocket 网关服务
 *
 * 职责：
 *   1. 启动 WebSocket 服务器，接受来自 LinksTar 前端客户端的连接
 *   2. 将客户端消息路由到 SessionOrchestrator（启动/复用会话）
 *   3. 将 Orchestrator 产出的事件流实时推送回客户端
 *   4. 处理斜杠命令的前端识别与透传
 *
 * 本模块是前后端的唯一桥梁。前端 WebSocket → 本网关 → Orchestrator → headless-server
 */

import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import { SessionOrchestrator, type UserIdentity, type OrchestratorConfig, initializeUserDirectory } from './orchestrator.js'
import { resolve, join } from 'path'
import { spawn, execSync } from 'child_process'
import os from 'os'
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { readdir, stat, readFile } from 'fs/promises'

const LOGS_DIR = resolve(import.meta.dir, '..', '..', '..', '..', 'logs')
const GATEWAY_LOG_PATH = join(LOGS_DIR, 'gateway.log')

function logToFile(message: string): void {
  try {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true })
    }
    const timestamp = new Date().toISOString()
    appendFileSync(GATEWAY_LOG_PATH, `[${timestamp}] ${message}\n`, 'utf-8')
  } catch (err) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 1. 协议类型定义（前后端共享）
// ---------------------------------------------------------------------------

/** 客户端 → 服务端的消息类型 */
export type ClientMessage =
  | { type: 'auth'; userId: string; clientOS: 'win32' | 'darwin' | 'linux'; clientShell?: string; envOverrides?: Record<string, string>; workspacePath?: string }
  | { type: 'chat'; content: string; model?: string }
  | { type: 'cancel_session' }
  | { type: 'rpc_response'; payload: any }
  | { type: 'test_api_connection'; provider: string; apiKey: string; baseUrl: string; model: string }
  | { type: 'browse_directory'; path: string }
  | { type: 'get_system_paths' }
  | { type: 'read_file'; path: string }

/** 服务端 → 客户端的消息类型 */
export type ServerMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'session_start'; sessionId: string }
  | { type: 'engine_event'; sessionId: string; event: any }
  | { type: 'session_end'; sessionId: string; code: number | null; signal: string | null }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'error'; message: string }
  | { type: 'browse_directory_result'; path: string; entries: { name: string; isDir: boolean; path: string }[] }
  | { type: 'read_file_result'; path: string; content: string; error?: string }

// ---------------------------------------------------------------------------
// 2. 连接上下文
// ---------------------------------------------------------------------------

interface ClientContext {
  ws: WebSocket
  user: UserIdentity | null
  activeSessionId: string | null
  conversationId?: string
  workspacePath?: string
}

// ---------------------------------------------------------------------------
// 3. 网关核心
// ---------------------------------------------------------------------------

export class WsGateway {
  private wss: WebSocketServer
  private orchestrator: SessionOrchestrator
  private clients: Map<WebSocket, ClientContext> = new Map()
  private orchestratorConfig: OrchestratorConfig

  constructor(port: number, orchestratorConfig: OrchestratorConfig) {
    this.orchestratorConfig = orchestratorConfig
    this.orchestrator = new SessionOrchestrator(orchestratorConfig)

    this.wss = new WebSocketServer({ port })
    console.log(`[WsGateway] WebSocket server listening on ws://localhost:${port}`)
    
    // Keep event loop alive
    setInterval(() => {
      // noop
    }, 5000);

    // 注册 Orchestrator 事件 → 推送到客户端
    this.orchestrator.on('session:event', (sessionId: string, userId: string, event: any) => {
      logToFile(`[WsGateway] Session Event [${sessionId}]: ${JSON.stringify(event).slice(0, 200)}`)
      this.broadcastToSession(sessionId, { type: 'engine_event', sessionId, event })
    })

    this.orchestrator.on('session:end', (sessionId: string, userId: string, info: { code: number | null; signal: string | null }) => {
      logToFile(`[WsGateway] Session End [${sessionId}] (code: ${info.code}, signal: ${info.signal})`)
      this.broadcastToSession(sessionId, { type: 'session_end', sessionId, code: info.code, signal: info.signal })
      // 清除客户端的 activeSessionId
      for (const ctx of this.clients.values()) {
        if (ctx.activeSessionId === sessionId) {
          ctx.activeSessionId = null
        }
      }
    })

    this.orchestrator.on('session:error', (sessionId: string, userId: string, err: Error) => {
      logToFile(`[WsGateway] Session Error [${sessionId}]: ${err.message}`)
      this.broadcastToSession(sessionId, { type: 'session_error', sessionId, error: err.message })
    })

    // 处理新连接
    this.wss.on('connection', (ws, req) => {
      let conversationId = 'default-conv'
      if (req.url) {
        try {
          const urlObj = new URL(req.url, 'http://localhost')
          const param = urlObj.searchParams.get('session_id')
          if (param) conversationId = param
        } catch {
          // ignore
        }
      }
      const ctx: ClientContext = { ws, user: null, activeSessionId: null, conversationId }
      this.clients.set(ws, ctx)
      const connMsg = `[WsGateway] Client connected (total: ${this.clients.size}, conversation: ${conversationId})`
      console.log(connMsg)
      logToFile(connMsg)

      ws.on('message', (raw: RawData) => {
        this.handleMessage(ctx, raw)
      })

      ws.on('close', () => {
        this.clients.delete(ws)
        const closeMsg = `[WsGateway] Client disconnected (total: ${this.clients.size})`
        console.log(closeMsg)
        logToFile(closeMsg)
      })

      ws.on('error', (err) => {
        console.error(`[WsGateway] Client error:`, err.message)
      })
    })
  }

  // -------------------------------------------------------------------------
  // 消息处理
  // -------------------------------------------------------------------------

  private handleMessage(ctx: ClientContext, raw: RawData): void {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      this.send(ctx.ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    switch (msg.type) {
      case 'auth':
        this.handleAuth(ctx, msg)
        break
      case 'chat':
        this.handleChat(ctx, msg)
        break
      case 'cancel_session':
        this.handleCancel(ctx)
        break
      case 'rpc_response':
        this.handleRpcResponse(ctx, msg)
        break
      case 'test_api_connection':
        this.handleTestConnection(ctx, msg)
        break
      case 'browse_directory':
        this.handleBrowseDirectory(ctx, msg)
        break
      case 'get_system_paths':
        this.handleGetSystemPaths(ctx)
        break
      case 'read_file':
        this.handleReadFile(ctx, msg)
        break
      default:
        this.send(ctx.ws, { type: 'error', message: `Unknown message type` })
    }
  }

  private handleAuth(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'auth' }>): void {
    ctx.user = {
      userId: msg.userId,
      clientOS: msg.clientOS,
      clientShell: msg.clientShell,
      envOverrides: msg.envOverrides,
    }
    
    ctx.workspacePath = msg.workspacePath || undefined
    this.send(ctx.ws, { type: 'auth_ok', userId: msg.userId })
    const authMsg = `[WsGateway] User authenticated: ${msg.userId} (workspacePath: ${ctx.workspacePath || 'none'}, envOverrides keys: ${Object.keys(msg.envOverrides || {}).join(',')})`
    console.log(authMsg)
    logToFile(authMsg)
  }

  private handleChat(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'chat' }>): void {
    const chatMsg = `[WsGateway] Received chat message from user ${ctx.user?.userId || 'unknown'} (length: ${msg.content.length}, content: "${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}")`
    console.log(chatMsg);
    logToFile(chatMsg)
    if (!ctx.user) {
      this.send(ctx.ws, { type: 'error', message: 'Not authenticated. Send auth message first.' })
      return
    }

    // 如果有活跃会话，先终止旧的
    if (ctx.activeSessionId) {
      const termMsg = `[WsGateway] Terminating previous session ${ctx.activeSessionId} for user ${ctx.user.userId}`
      console.log(termMsg);
      logToFile(termMsg)
      this.orchestrator.terminateSession(ctx.activeSessionId, 'user_cancel')
    }

    try {
      const startCallMsg = `[WsGateway] Calling orchestrator.startSession for user ${ctx.user.userId} with conversation ${ctx.conversationId}`
      console.log(startCallMsg);
      logToFile(startCallMsg)
      const sessionId = this.orchestrator.startSession(ctx.user, msg.content, { 
        model: msg.model,
        conversationId: ctx.conversationId,
        workspacePath: ctx.workspacePath
      })
      const startedMsg = `[WsGateway] Started session ${sessionId}`
      console.log(startedMsg);
      logToFile(startedMsg)
      ctx.activeSessionId = sessionId
      this.send(ctx.ws, { type: 'session_start', sessionId })
    } catch (err: any) {
      const failMsg = `[WsGateway] Failed to start session: ${err.message}`
      console.error(failMsg);
      logToFile(failMsg)
      this.send(ctx.ws, { type: 'error', message: err.message })
    }
  }

  private handleCancel(ctx: ClientContext): void {
    if (ctx.activeSessionId) {
      const cancelMsg = `[WsGateway] Cancelling session ${ctx.activeSessionId}`
      console.log(cancelMsg)
      logToFile(cancelMsg)
      this.orchestrator.terminateSession(ctx.activeSessionId, 'user_cancel')
      ctx.activeSessionId = null
    }
  }

  private handleRpcResponse(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'rpc_response' }>): void {
    if (ctx.activeSessionId) {
      this.orchestrator.sendRpcResponse(ctx.activeSessionId, msg.payload)
    }
  }

  private async handleBrowseDirectory(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'browse_directory' }>): Promise<void> {
    try {
      const targetPath = msg.path || process.env.CLAUDE_WORKSPACE_BASE || 'E:\\'
      
      let entries: { name: string; isDir: boolean; path: string }[] = []
      try {
        const files = await readdir(targetPath)
        for (const file of files) {
          try {
            const fullPath = join(targetPath, file)
            const s = await stat(fullPath)
            entries.push({ name: file, isDir: s.isDirectory(), path: fullPath })
          } catch {
            // ignore access errors
          }
        }
      } catch (err: any) {
        console.error(`[WsGateway] Error reading directory ${targetPath}:`, err)
      }
      
      // Sort: folders first, then alphabetical
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      this.send(ctx.ws, { type: 'browse_directory_result', path: targetPath, entries })
    } catch (err: any) {
      this.send(ctx.ws, { type: 'error', message: `browse_directory error: ${err.message}` })
    }
  }

  private handleGetSystemPaths(ctx: ClientContext): void {
    try {
      const homeDir = os.homedir()
      const paths = {
        home: homeDir,
        desktop: join(homeDir, 'Desktop'),
        documents: join(homeDir, 'Documents'),
        downloads: join(homeDir, 'Downloads'),
        pictures: join(homeDir, 'Pictures'),
      }

      let drives: string[] = []
      if (os.platform() === 'win32') {
        try {
          const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' })
          drives = output
            .split('\\n')
            .map(line => line.trim())
            .filter(line => line.match(/^[A-Za-z]:$/))
            .map(drive => drive + '\\\\')
        } catch {
          drives = ['C:\\\\']
        }
      } else {
        drives = ['/']
      }

      this.send(ctx.ws, { type: 'system_paths_result', paths, drives })
    } catch (err: any) {
      this.send(ctx.ws, { type: 'error', message: `get_system_paths error: ${err.message}` })
    }
  }
  private async handleReadFile(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'read_file' }>): Promise<void> {
    try {
      if (!msg.path) throw new Error('Path is required');
      const content = await readFile(msg.path, 'utf-8');
      this.send(ctx.ws, { type: 'read_file_result', path: msg.path, content });
    } catch (err: any) {
      this.send(ctx.ws, { type: 'read_file_result', path: msg.path, content: '', error: err.message });
    }
  }
  // -------------------------------------------------------------------------
  // 工具方法
  // -------------------------------------------------------------------------

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private broadcastToSession(sessionId: string, msg: ServerMessage): void {
    for (const ctx of this.clients.values()) {
      if (ctx.activeSessionId === sessionId) {
        this.send(ctx.ws, msg)
      }
    }
  }

  private async handleTestConnection(ctx: ClientContext, msg: Extract<ClientMessage, { type: 'test_api_connection' }>): Promise<void> {
    const { provider, apiKey, baseUrl, model } = msg
    const userId = ctx.user?.userId || 'anonymous'
    console.log(`[WsGateway] Testing API connection via claude-code for tenant: ${userId}, provider: ${provider}, model: ${model}`)

    // 辅助：向同一用户的所有当前活跃连接发送结果（防止异步期间旧连接关闭导致消息丢失）
    const sendResultToUser = (result: any) => {
      let delivered = false
      for (const c of this.clients.values()) {
        if (c.user?.userId === userId && c.ws.readyState === c.ws.OPEN) {
          c.ws.send(JSON.stringify(result))
          delivered = true
        }
      }
      if (!delivered) {
        console.warn(`[WsGateway] Test result could not be delivered: no active connection for user ${userId}`)
      }
    }

    try {
      // 初始化用户目录
      const userDir = initializeUserDirectory(this.orchestratorConfig.dataRoot, userId)

      // 构建环境变量，注入对应的 API 密钥和基准地址
      const testEnv: Record<string, string> = {
        ...process.env,
        CLAUDE_: join(userDir, '.CLAUDE'),
        HOME: userDir,
        USERPROFILE: userDir,
      }

      if (apiKey) {
        if (provider === 'anthropic') {
          testEnv.ANTHROPIC_API_KEY = apiKey
          if (baseUrl) testEnv.ANTHROPIC_BASE_URL = baseUrl
        } else if (provider === 'gemini') {
          testEnv.GEMINI_API_KEY = apiKey
          testEnv.GOOGLE_GEMINI_API_KEY = apiKey
          if (baseUrl) testEnv.GOOGLE_GEMINI_BASE_URL = baseUrl
        } else if (provider === 'deepseek') {
          testEnv.DEEPSEEK_API_KEY = apiKey
          if (baseUrl) testEnv.DEEPSEEK_BASE_URL = baseUrl
        } else if (provider === 'openai') {
          testEnv.OPENAI_API_KEY = apiKey
          if (baseUrl) testEnv.OPENAI_BASE_URL = baseUrl
        } else if (provider === 'codex') {
          testEnv.CODEX_API_KEY = apiKey
        }
      }

      const cliPath = resolve(import.meta.dir, '..', '..', 'dist', 'cli.js')
      console.log(`[WsGateway] Spawning child process: node ${cliPath}`)

      const child = spawn(process.argv[0] || 'node', [
        cliPath,
        '--print',
        "Respond with ONLY 'Connection successful!' to verify connection.",
        '--model',
        model,
        '--dangerously-skip-permissions',
        '--bare',
        '--no-session-persistence'
      ], {
        env: testEnv
      })

      let stdout = ''
      let stderr = ''
       child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

      let timeoutId: any = null

      child.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId)
        console.error(`[WsGateway] Child process spawn/execution error:`, err)
        sendResultToUser({
          type: 'test_connection_result',
          success: false,
          status: 500,
          message: `Spawn error: ${err.message}`
        })
      })

      // 设置 15 秒超时保护
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
      }, 15000)

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        const cleanStdout = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
        const cleanStderr = stderr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()

        if (code === 0) {
          sendResultToUser({
            type: 'test_connection_result',
            success: true,
            status: 200,
            message: cleanStdout || 'Connection Test Passed'
          })
        } else {
          sendResultToUser({
            type: 'test_connection_result',
            success: false,
            status: code || 500,
            message: cleanStderr || cleanStdout || `Process exited with code ${code}`
          })
        }
      })
    } catch (err: any) {
      sendResultToUser({
        type: 'test_connection_result',
        success: false,
        status: 500,
        message: `Gateway internal error: ${err.message || err}`
      })
    }
  }

  async shutdown(): Promise<void> {
    console.log('[WsGateway] Shutting down...')
    await this.orchestrator.shutdown()
    this.wss.close()
  }
}

// ---------------------------------------------------------------------------
// 4. 独立启动入口
// ---------------------------------------------------------------------------

const WS_PORT = parseInt(process.env.CLAUDE_WS_PORT || '9800', 10)
const DATA_ROOT = resolve(process.env.CLAUDE_DATA_ROOT || './.claude-data')
const SERVER_SCRIPT = resolve(import.meta.dir, '..', 'headless-server.ts')

const gateway = new WsGateway(WS_PORT, {
  dataRoot: DATA_ROOT,
  serverScript: SERVER_SCRIPT,
  maxSessionsPerUser: 5,
  sessionTimeoutMs: 600_000, // 10 分钟
})

// 优雅退出
process.on('SIGINT', async () => {
  await gateway.shutdown()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await gateway.shutdown()
  process.exit(0)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WsGateway] Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[WsGateway] Uncaught Exception:', err)
  setTimeout(() => process.exit(1), 1000)
})
