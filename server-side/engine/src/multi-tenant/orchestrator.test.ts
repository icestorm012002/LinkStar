/**
 * orchestrator.test.ts — 多租户编排器的隔离性与并发性测试
 *
 * 验证目标：
 *   1. 每个用户会话运行在独立子进程中
 *   2. 一个用户的目录对其他用户不可见
 *   3. 多个用户可以同时运行会话
 *   4. 超时保护正确终止卡住的会话
 *   5. 用户会话数限制生效
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import {
  SessionOrchestrator,
  initializeUserDirectory,
  type OrchestratorConfig,
  type UserIdentity,
} from './orchestrator.js'

// ---------------------------------------------------------------------------
// 测试 Helper
// ---------------------------------------------------------------------------

/** 创建临时测试数据目录 */
function createTempDataRoot(): string {
  const tempDir = resolve(
    process.cwd(),
    '.test-temp',
    `orchestrator-test-${randomUUID().slice(0, 8)}`,
  )
  mkdirSync(tempDir, { recursive: true })
  return tempDir
}

/** 创建一个最小的 mock server 脚本，用于模拟 headless-server 的行为 */
function createMockServerScript(dataRoot: string): string {
  const scriptPath = join(dataRoot, '_mock-server.js')
  // 这个 mock 脚本：
  //   1. 从 stdin 读取 JSON 配置
  //   2. 输出 NDJSON 事件到 stdout
  //   3. 验证自己的 CLAUDE_CONFIG_DIR 是否被正确隔离
  writeFileSync(
    scriptPath,
    `
let inputData = '';
process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const config = JSON.parse(inputData);
    const ts = () => new Date().toISOString();

    // 输出 session_start
    process.stdout.write(JSON.stringify({
      type: 'session_start',
      sessionId: 'mock-' + Date.now(),
      timestamp: ts()
    }) + '\\n');

    // 验证环境隔离
    const configDir = process.env.CLAUDE_CONFIG_DIR || 'NOT_SET';
    process.stdout.write(JSON.stringify({
      type: 'engine_event',
      data: {
        type: 'isolation_check',
        configDir,
        pid: process.pid,
        cwd: process.cwd(),
        sessionDir: config.sessionDir,
        clientOS: config.clientOS || 'unknown',
      },
      timestamp: ts()
    }) + '\\n');

    // 模拟处理 prompt
    process.stdout.write(JSON.stringify({
      type: 'engine_event',
      data: {
        type: 'assistant',
        content: 'Echo: ' + config.prompt,
      },
      timestamp: ts()
    }) + '\\n');

    // 如果收到 "slow" prompt，模拟长时间运行
    if (config.prompt === 'slow') {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({
          type: 'session_end',
          sessionId: 'mock',
          exitCode: 0,
          timestamp: ts()
        }) + '\\n');
        process.exit(0);
      }, 10000);
    } else {
      // 正常退出
      process.stdout.write(JSON.stringify({
        type: 'session_end',
        sessionId: 'mock',
        exitCode: 0,
        timestamp: ts()
      }) + '\\n');
      process.exit(0);
    }
  } catch (err) {
    process.stderr.write('JSON parse error in mock server: ' + err.message + '\\n');
    process.exit(1);
  }
});
`,
    'utf-8',
  )
  return scriptPath
}

const makeUser = (id: string, os: 'win32' | 'darwin' | 'linux' = 'linux'): UserIdentity => ({
  userId: id,
  displayName: `Test User ${id}`,
  clientOS: os,
})

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('initializeUserDirectory', () => {
  let dataRoot: string

  beforeEach(() => {
    dataRoot = createTempDataRoot()
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('应该创建完整的用户目录结构', () => {
    const userDir = initializeUserDirectory(dataRoot, 'user-001')

    expect(existsSync(join(userDir, '.claude'))).toBe(true)
    expect(existsSync(join(userDir, 'workspace'))).toBe(true)
    expect(existsSync(join(userDir, 'logs'))).toBe(true)
  })

  it('应该写入 tenant-meta.json', () => {
    const userDir = initializeUserDirectory(dataRoot, 'user-002')
    const metaPath = join(userDir, '.claude', 'tenant-meta.json')

    expect(existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.userId).toBe('user-002')
    expect(meta.version).toBe(1)
    expect(meta.createdAt).toBeDefined()
  })

  it('不同用户的目录应该彼此隔离', () => {
    const dir1 = initializeUserDirectory(dataRoot, 'user-A')
    const dir2 = initializeUserDirectory(dataRoot, 'user-B')

    expect(dir1).not.toBe(dir2)
    expect(dir1.includes('user-A')).toBe(true)
    expect(dir2.includes('user-B')).toBe(true)

    // 目录互不可见（不在彼此的子路径中）
    expect(dir1.startsWith(dir2)).toBe(false)
    expect(dir2.startsWith(dir1)).toBe(false)
  })

  it('重复初始化同一用户不应报错也不应覆盖元数据', () => {
    const dir1 = initializeUserDirectory(dataRoot, 'user-repeat')
    const meta1 = JSON.parse(
      readFileSync(join(dir1, '.claude', 'tenant-meta.json'), 'utf-8'),
    )

    // 再次初始化
    const dir2 = initializeUserDirectory(dataRoot, 'user-repeat')
    const meta2 = JSON.parse(
      readFileSync(join(dir2, '.claude', 'tenant-meta.json'), 'utf-8'),
    )

    expect(dir1).toBe(dir2)
    // 创建时间不应被覆盖
    expect(meta1.createdAt).toBe(meta2.createdAt)
  })
})

describe('SessionOrchestrator', () => {
  let dataRoot: string
  let mockScript: string
  let orchestrator: SessionOrchestrator

  beforeEach(() => {
    dataRoot = createTempDataRoot()
    mockScript = createMockServerScript(dataRoot)
    orchestrator = new SessionOrchestrator({
      dataRoot,
      serverScript: mockScript,
      maxSessionsPerUser: 3,
      sessionTimeoutMs: 5000,
    })
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('应该能启动一个会话并收到事件', async () => {
    const events: any[] = []

    orchestrator.on('session:event', (_sid: string, _uid: string, event: any) => {
      events.push(event)
    })

    const sessionId = orchestrator.startSession(makeUser('u1'), 'Hello world')
    expect(sessionId).toBeDefined()
    expect(typeof sessionId).toBe('string')

    // 等待会话完成
    await new Promise<void>((resolve) => {
      orchestrator.on('session:end', () => resolve())
    })

    // 应该收到 session_start + isolation_check + assistant + session_end
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events[0].type).toBe('session_start')
  })

  it('不同用户的会话应在不同 PID 中运行（进程隔离）', async () => {
    const pids: Record<string, number> = {}

    orchestrator.on('session:event', (_sid: string, uid: string, event: any) => {
      if (event.data?.type === 'isolation_check') {
        pids[uid] = event.data.pid
      }
    })

    orchestrator.startSession(makeUser('iso-A'), 'test A')
    orchestrator.startSession(makeUser('iso-B'), 'test B')

    // 等待两个会话都完成
    let endCount = 0
    await new Promise<void>((resolve) => {
      orchestrator.on('session:end', () => {
        endCount++
        if (endCount >= 2) resolve()
      })
    })

    expect(pids['iso-A']).toBeDefined()
    expect(pids['iso-B']).toBeDefined()
    expect(pids['iso-A']).not.toBe(pids['iso-B'])
  })

  it('不同用户的 CLAUDE_CONFIG_DIR 应该指向各自的隔离目录', async () => {
    const configDirs: Record<string, string> = {}

    orchestrator.on('session:event', (_sid: string, uid: string, event: any) => {
      if (event.data?.type === 'isolation_check') {
        configDirs[uid] = event.data.configDir
      }
    })

    orchestrator.startSession(makeUser('cfg-A'), 'test')
    orchestrator.startSession(makeUser('cfg-B'), 'test')

    let endCount = 0
    await new Promise<void>((resolve) => {
      orchestrator.on('session:end', () => {
        endCount++
        if (endCount >= 2) resolve()
      })
    })

    expect(configDirs['cfg-A']).toContain('cfg-A')
    expect(configDirs['cfg-B']).toContain('cfg-B')
    expect(configDirs['cfg-A']).not.toBe(configDirs['cfg-B'])
  })

  it('应该限制单用户最大并发会话数', () => {
    const user = makeUser('limit-user')

    // 使用 "slow" prompt 让会话保持运行
    orchestrator.startSession(user, 'slow')
    orchestrator.startSession(user, 'slow')
    orchestrator.startSession(user, 'slow')

    expect(() => {
      orchestrator.startSession(user, 'slow')
    }).toThrow(/max concurrent sessions/)
  })

  it('getActiveSessions 应返回所有运行中的会话', () => {
    orchestrator.startSession(makeUser('active-1'), 'slow')
    orchestrator.startSession(makeUser('active-2'), 'slow')

    const sessions = orchestrator.getActiveSessions()
    expect(sessions.length).toBe(2)

    const userIds = sessions.map((s) => s.userId).sort()
    expect(userIds).toEqual(['active-1', 'active-2'])
  })

  it('terminateSession 应该能终止会话', async () => {
    const sessionId = orchestrator.startSession(makeUser('term-user'), 'slow')

    // 给子进程一点启动时间
    await new Promise((r) => setTimeout(r, 200))

    const result = orchestrator.terminateSession(sessionId)
    expect(result).toBe(true)

    // 等待 session:end 事件
    await new Promise<void>((resolve) => {
      orchestrator.on('session:end', (sid: string) => {
        if (sid === sessionId) resolve()
      })
      // 防止无限等待
      setTimeout(resolve, 6000)
    })

    expect(orchestrator.getActiveSessions().length).toBe(0)
  })

  it('超时应该自动终止会话', async () => {
    // 创建一个 1 秒超时的编排器
    const shortTimeoutOrchestrator = new SessionOrchestrator({
      dataRoot,
      serverScript: mockScript,
      sessionTimeoutMs: 1000,
    })

    let terminateReason = ''
    shortTimeoutOrchestrator.on(
      'session:terminate',
      (_sid: string, _uid: string, reason: string) => {
        terminateReason = reason
      },
    )

    shortTimeoutOrchestrator.startSession(makeUser('timeout-user'), 'slow')

    // 等待超时触发
    await new Promise<void>((resolve) => {
      shortTimeoutOrchestrator.on('session:end', () => resolve())
      // 给超时 + 清理足够时间
      setTimeout(resolve, 8000)
    })

    expect(terminateReason).toBe('timeout')

    await shortTimeoutOrchestrator.shutdown()
  })
})
