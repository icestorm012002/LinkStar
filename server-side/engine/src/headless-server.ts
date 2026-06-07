/**
 * headless-server.ts — 多租户云端无头入口
 *
 * 职责：
 *   1. 接收来自编排器（orchestrator）的会话配置（JSON via stdin 或 CLI args）
 *   2. 通过 Claude_CONFIG_DIR 等环境变量实现用户级隔离
 *   3. 复用 Claude-code 的 init → getTools → QueryEngine 链路
 *   4. 将 QueryEngine 产生的 SDKMessage 流序列化为 NDJSON 输出到 stdout
 *   5. 编排器负责捕获 stdout 并通过 WebSocket 转发到用户本地客户端
 *
 * 本模块 **不改写** 任何 Claude-code 核心文件——它只是核心引擎的一个新消费者。
 *
 * 启动方式（由编排器调用）:
 *   node headless-server.js '{"prompt":"...","sessionDir":"/data/users/abc123"}'
 *   echo '{"prompt":"hello"}' | node headless-server.js --stdin
 */

// --- Mock MACRO global for bun run (normally injected by bun build) ---
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.0.0-headless',
    NATIVE_PACKAGE_URL: '@anthropic-ai/Claude-code',
    PACKAGE_URL: '@anthropic-ai/Claude-code',
    VERSION_CHANGELOG: {},
  },
})

// --- Mock feature global for bun run ---
const feature = (name: string) => false
Object.assign(globalThis, { feature })

import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, writeSync } from 'fs'
import { join, resolve } from 'path'
import { applyMonkeyPatches } from './multi-tenant/monkey-patch.js'

import { homedir } from 'os'
import { copyFileSync } from 'fs'

// ---------------------------------------------------------------------------
// 1. 会话配置类型
// ---------------------------------------------------------------------------
export type HeadlessSessionConfig = {
  /** 用户的 prompt 文本 */
  prompt: string
  /** 该用户在云端的隔离目录 (由编排器创建) */
  sessionDir: string
  /** 远程用户的工作目录（在用户本地机器上的 CWD，映射到云端影子目录） */
  remoteCwd: string
  /** 用户客户端操作系统标识，用于跨平台路径/命令适配 */
  clientOS?: 'win32' | 'darwin' | 'linux'
  /** 用户客户端默认 shell */
  clientShell?: string
  /** 可选：用户指定的 AI 模型 */
  model?: string
  /** 可选：最大回合数 */
  maxTurns?: number
  /** 可选：预算上限（美元） */
  maxBudgetUsd?: number
  /** 可选：API provider 环境变量覆盖（如用户自带 key） */
  envOverrides?: Record<string, string>
  /** 可选：上次断网遗留的未完成写入文件列表（.tmp），用于 AI 提示恢复 */
  incompleteWrites?: string[]
  /** 可选：会话/对话唯一标识，用于在 .Claude 恢复历史上下文 */
  sessionId?: string
}

// ---------------------------------------------------------------------------
// 2. 环境隔离注入 — 必须在任何 Claude-code 模块导入之前执行
// ---------------------------------------------------------------------------
function injectSessionEnvironment(config: HeadlessSessionConfig): void {
  // 核心隔离：将 Claude-code 的全局配置目录指向用户专属目录
  const configDir = join(config.sessionDir, '.Claude')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  
  // 从全局目录复制登录凭证（OAuth token 等），让用户继承宿主机的登录状态
  try {
    const globalSettingsPath = join(homedir(), '.Claude', 'settings.json')
    const localSettingsPath = join(configDir, 'settings.json')
    if (existsSync(globalSettingsPath) && !existsSync(localSettingsPath)) {
      copyFileSync(globalSettingsPath, localSettingsPath)
    }
  } catch (e) {
    console.error('[Headless] Failed to copy global settings.json:', e)
  }

  process.env.Claude_CONFIG_DIR = configDir

  // 标记为无头/RPC 模式
  process.env.Claude_CODE_ENTRYPOINT = 'headless-rpc'

  // 标记为非交互式会话（跳过 trust dialog 等 UI 流程）
  process.env.Claude_CODE_IS_NONINTERACTIVE = '1'

  // SIMPLE/BARE 模式：跳过 keychain、hooks、LSP、plugin sync 等不需要的初始化
  process.env.Claude_CODE_SIMPLE = '1'

  // 注入用户客户端系统信息——让 AI 产生正确的命令
  if (config.clientOS) {
    process.env.Claude_CLIENT_OS = config.clientOS
  }
  if (config.clientShell) {
    process.env.Claude_CLIENT_SHELL = config.clientShell
  }

  // 用户自带 API key / provider 配置
  if (config.envOverrides) {
    for (const [key, value] of Object.entries(config.envOverrides)) {
      process.env[key] = value
    }
    
    // 如果前端指定了 provider 或 model，强制在沙箱的 config.json 中写入，避免回退到默认 Anthropic
    const provider = config.envOverrides['Claude_PROVIDER']
    const targetModel = config.envOverrides['Claude_MODEL']
    
    if (provider && provider.toLowerCase() !== 'anthropic' || targetModel) {
      // 纯透传：前端传了什么模型就是什么模型，服务端绝不硬编码模型名字
      const finalModel = targetModel || provider
      const configFile = join(configDir, 'config.json')
      let existingConfig: any = {}
      if (existsSync(configFile)) {
        try { existingConfig = JSON.parse(readFileSync(configFile, 'utf8')) } catch (e) {}
      }
      if (existingConfig.primaryModel !== finalModel) {
        existingConfig.primaryModel = finalModel
        writeFileSync(configFile, JSON.stringify(existingConfig, null, 2))
      }
    }
  }

  // CWD 设置为实际开发工作目录（绝对路径则直接使用本地物理目录，否则使用云端影子目录）
  const isAbsolute = (p: string) => {
    return p.startsWith('/') || p.includes(':') || p.startsWith('\\\\')
  }
  const cloudCwd = (config.remoteCwd && isAbsolute(config.remoteCwd))
    ? resolve(config.remoteCwd)
    : resolve(config.sessionDir, 'workspace')

  if (!existsSync(cloudCwd)) {
    mkdirSync(cloudCwd, { recursive: true })
  }
  process.chdir(cloudCwd)

  // 只有当不是本地直连物理目录模式时，才应用 RPC 穿隧劫持补丁
  // 否则，AI 读写文件与命令执行完全可以在本地磁盘高速执行，免去复杂的 RPC 数据帧编解码和网络抖动！
  const isLocalDirectMode = config.remoteCwd && isAbsolute(config.remoteCwd)
  if (!isLocalDirectMode) {
    applyMonkeyPatches(cloudCwd)
  }
}

// ---------------------------------------------------------------------------
// 3. NDJSON 输出协议
// ---------------------------------------------------------------------------
type OutputEvent =
  | { type: 'session_start'; sessionId: string; timestamp: string }
  | { type: 'engine_event'; data: unknown; timestamp: string }
  | { type: 'session_end'; sessionId: string; exitCode: number; timestamp: string }
  | { type: 'error'; message: string; timestamp: string }

function emit(event: OutputEvent): void {
  try {
    // 绕过 Node/Bun stream 缓存，直接同步写入文件描述符 1 (stdout)，保障流式数据的 0 延迟传输
    writeSync(1, JSON.stringify(event) + '\n')
  } catch (e) {
    process.stdout.write(JSON.stringify(event) + '\n')
  }
}

// ---------------------------------------------------------------------------
// 4. 核心：启动引擎并流式输出
// ---------------------------------------------------------------------------
async function runSession(config: HeadlessSessionConfig): Promise<number> {
  const sessionId = randomUUID()
  const timestamp = () => new Date().toISOString()

  emit({ type: 'session_start', sessionId, timestamp: timestamp() })

  try {
    // --- 延迟导入 Claude-code 模块（环境变量已在导入前注入完毕）---
    const { init } = await import('./entrypoints/init.js')
    await init()

    const { getDefaultAppState } = await import('./state/AppStateStore.js')
    const { createStore } = await import('./state/store.js')
    const { onChangeAppState } = await import('./state/onChangeAppState.js')
    const { getTools } = await import('./tools.js')
    const { getCommands } = await import('./commands.js')
    const { QueryEngine } = await import('./QueryEngine.js')
    const { getCwd } = await import('./utils/cwd.js')
    const { setCwd } = await import('./utils/Shell.js')
    const {
      initializeToolPermissionContext,
      initialPermissionModeFromCLI,
    } = await import('./utils/permissions/permissionSetup.js')
    const { setIsInteractive, setSessionSource, switchSession } =
      await import('./bootstrap/state.js')
    const { hasPermissionsToUseTool } = await import(
      './utils/permissions/permissions.js'
    )
    const { createFileStateCacheWithSizeLimit, READ_FILE_STATE_CACHE_SIZE } =
      await import('./utils/fileStateCache.js')

    // --- 配置会话级状态 ---
    setIsInteractive(false)
    setSessionSource('sdk-cli')
    switchSession(config.sessionId as any)



    // 设置 CWD（影子工作区目录）
    setCwd(getCwd())

    // 初始化权限上下文
    const permissionModeResult = initialPermissionModeFromCLI({
      permissionModeCli: 'bypassPermissions',
      dangerouslySkipPermissions: true,
    })
    
    const { toolPermissionContext } = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      permissionMode: permissionModeResult.mode,
      allowDangerouslySkipPermissions: true,
      addDirs: [],
    })

    // 获取工具和命令
    const tools = getTools(toolPermissionContext)
    const commands = await getCommands(getCwd())
    const headlessCommands = commands.filter(
      (cmd) =>
        (cmd.type === 'prompt' && !cmd.disableNonInteractive) ||
        (cmd.type === 'local' && cmd.supportsNonInteractive),
    )



    // 创建 AppState Store
    const initialState = {
      ...getDefaultAppState(),
      toolPermissionContext,
    }
    console.log('[DEBUG] toolPermissionContext keys:', Object.keys(initialState.toolPermissionContext || {}))
    const store = createStore(initialState, onChangeAppState)

    // canUseTool：在无头 RPC 模式下，默认放行所有工具
    // 实际权限校验由编排器/客户端侧的沙箱接管
    const canUseTool: Parameters<typeof QueryEngine['prototype']['submitMessage']> extends never
      ? never
      : any = async (
      tool: any,
      input: any,
      toolUseContext: any,
      _assistantMessage: any,
      _toolUseID: any,
      _forceDecision: any,
    ) => {
      // 检查基础权限规则
      // console.error('[CHILD STDERR] toolPermissionContext from store:', JSON.stringify(store.getState().toolPermissionContext))
      
      const result = await hasPermissionsToUseTool(
        tool,
        input,
        toolUseContext,
        _assistantMessage,
        _toolUseID,
      )
      return result ?? { behavior: 'allow' as const }
    }

    // 创建 readFileState cache
    const readFileCache = createFileStateCacheWithSizeLimit(
      READ_FILE_STATE_CACHE_SIZE,
    )

    // --- Load History ---
    let initialMessages: any[] = []
    try {
      const { loadConversationForResume } = await import('./utils/conversationRecovery.js')
      const result = await loadConversationForResume(config.sessionId, undefined)
      if (result && result.messages) {
        initialMessages = result.messages
      }
    } catch (err) {
      console.error('[CHILD STDERR] Error loading conversation history:', err)
    }

    // --- 实例化 QueryEngine ---
    const engine = new QueryEngine({
      cwd: getCwd(),
      tools,
      commands: headlessCommands,
      mcpClients: [],
      agents: [],
      canUseTool,
      getAppState: () => store.getState(),
      setAppState: store.setState,
      readFileCache,
      userSpecifiedModel: config.model || (config.envOverrides ? config.envOverrides['Claude_MODEL'] : undefined),
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      verbose: true,
      initialMessages,
    })

    // --- 运行单轮对话并流式输出 ---
    let finalPrompt = config.prompt
    
    // Natively instruct the AI model about its brand, role, and local environment
    const systemBrandingInstruction = `[System Instruction: You are CLAUDE, a premium AI coding assistant designed to build and refine codebases. Never refer to yourself as Claude or Anthropic. Always refer to yourself as CLAUDE. You are directly editing the local codebase on the developer's computer. When displaying paths, use the real physical filesystem paths on the host.]`
    
    // 如果存在未完成的写入（断网遗留），在此处向大模型注入隐式上下文
    if (config.incompleteWrites && config.incompleteWrites.length > 0) {
      const filesStr = config.incompleteWrites.map(f => `- ${f}`).join('\n')
      finalPrompt = `${systemBrandingInstruction}\n\n[System Message: The previous session was disconnected while writing to the following files. The local client has retained the incomplete .tmp files. Please ask the user if they want to resume/re-attempt writing to these files before proceeding with their request.]\n${filesStr}\n\nUser Request: ${config.prompt}`
    } else {
      finalPrompt = `${systemBrandingInstruction}\n\nUser Request: ${config.prompt}`
    }

    let yieldedCount = 0;
    for await (const message of engine.submitMessage(finalPrompt, { includePartialMessages: true })) {
      yieldedCount++;
      emit({
        type: 'engine_event',
        data: message,
        timestamp: timestamp(),
      })
    }
    // console.error(`[CHILD STDERR] submitMessage completed. Yielded ${yieldedCount} messages.`);

    // --- Save History ---
    try {
      const { recordTranscript } = await import('./utils/sessionStorage.js')
      await recordTranscript(engine.mutableMessages)
    } catch (err) {
      console.error('[CHILD STDERR] Error saving conversation history:', err)
    }

    emit({ type: 'session_end', sessionId, exitCode: 0, timestamp: timestamp() })
    return 0
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    emit({ type: 'error', message: msg, timestamp: timestamp() })
    emit({ type: 'session_end', sessionId, exitCode: 1, timestamp: timestamp() })
    return 1
  }
}

// ---------------------------------------------------------------------------
// 5. 入口：解析配置并启动
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  let config: HeadlessSessionConfig

  const cliArg = process.argv[2]
  if (cliArg === '--stdin') {
    // 从 stdin 读取完整 JSON 配置
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim()
    config = JSON.parse(raw) as HeadlessSessionConfig
  } else if (cliArg) {
    // 从 CLI 参数读取 JSON 配置
    config = JSON.parse(cliArg) as HeadlessSessionConfig
  } else {
    process.stderr.write(
      'Usage: node headless-server.js \'{"prompt":"...","sessionDir":"..."}\'\n' +
        '       echo \'{"prompt":"...","sessionDir":"..."}\' | node headless-server.js --stdin\n',
    )
    process.exit(1)
  }

  // 注入环境（在任何 Claude-code 模块加载之前）
  injectSessionEnvironment(config)

  const exitCode = await runSession(config)
  process.exit(exitCode)
}

// 仅在直接执行时运行入口
// 作为模块导入时仅导出 runSession / HeadlessSessionConfig
export { runSession, injectSessionEnvironment }

// ESM 直接执行检测
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('headless-server.js') ||
    process.argv[1].endsWith('headless-server.ts'))

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`)
    process.exit(2)
  })
}
