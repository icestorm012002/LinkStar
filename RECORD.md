# Claude Code 项目运行记录

> 项目: `/Users/konghayao/code/ai/claude-code`
> 日期: 2026-03-31
> 包管理器: bun

---

## 一、项目目标

**将 claude-code 项目运行起来，必要时可以删减次级能力。**

这是 Anthropic 官方 Claude Code CLI 工具的源码反编译/逆向还原项目。

### 核心保留能力

- API 通信（Anthropic SDK / Bedrock / Vertex）
- Bash/FileRead/FileWrite/FileEdit 等核心工具
- REPL 交互界面（ink 终端渲染）
- 对话历史与会话管理
- 权限系统（基础）
- Agent/子代理系统

### 已删减的次级能力

| 模块 | 处理方式 |
|------|----------|
| Computer Use (`@ant/computer-use-*`) | stub |
| Claude for Chrome (`@ant/claude-for-chrome-mcp`) | stub |
| Magic Docs / Voice Mode / LSP Server | 移除 |
| Analytics / GrowthBook / Sentry | 空实现 |
| Plugins/Marketplace / Desktop Upsell | 移除 |
| Ultraplan / Tungsten / Auto Dream | 移除 |
| MCP OAuth/IDP | 简化 |
| DAEMON / BRIDGE / BG_SESSIONS / TEMPLATES 等 | feature flag 关闭 |

---

## 二、当前状态：Dev 模式已可运行

```bash
# dev 运行
bun run dev
# 直接运行
bun run src/entrypoints/cli.tsx
# 测试 -p 模式
echo "say hello" | bun run src/entrypoints/cli.tsx -p
# 构建
bun run build
```

| 测试 | 结果 |
|------|------|
| `--version` | `2.1.87 (Claude Code)` |
| `--help` | 完整帮助信息输出 |
| `-p` 模式 | 成功调用 API 返回响应 |

### TS 类型错误说明

~~仍有 ~1341 个 tsc 错误~~ → 经过系统性类型修复，已降至 **~294 个**（减少 78%）。剩余错误分散在小文件中，均为反编译产生的源码级类型问题（`unknown`/`never`/`{}`），**不影响 Bun 运行时**。

---

## 三、关键修复记录

### 3.1 自动化 stub 生成

通过 3 个脚本自动处理了缺失模块问题：
- `scripts/create-type-stubs.mjs` — 生成 1206 个 stub 文件
- `scripts/fix-default-stubs.mjs` — 修复 120 个默认导出 stub
- `scripts/fix-missing-exports.mjs` — 补全 81 个模块的 161 个缺失导出

### 3.2 手动类型修复

- `src/types/global.d.ts` — MACRO 宏、内部函数声明
- `src/types/internal-modules.d.ts` — `@ant/*` 等私有包类型声明
- `src/entrypoints/sdk/` — 6 个 SDK 子模块 stub
- 泛型类型修复（DeepImmutable、AttachmentMessage 等）
- 4 个 `export const default` 非法语法修复

### 3.3 运行时修复

**Commander 非法短标志**：`-d2e, --debug-to-stderr` → `--debug-to-stderr`（反编译错误）

**`bun:bundle` 运行时 Polyfill**（`src/entrypoints/cli.tsx` 顶部）：
```typescript
const feature = (_name: string) => false;  // 所有 feature flag 分支被跳过
(globalThis as any).MACRO = { VERSION: "2.1.87", ... };  // 绕过版本检查
```

---

## 四、关键文件清单

| 文件 | 用途 |
|------|------|
| `src/entrypoints/cli.tsx` | 入口文件（含 MACRO/feature polyfill） |
| `src/main.tsx` | 主 CLI 逻辑（Commander 定义） |
| `src/types/global.d.ts` | 全局变量/宏声明 |
| `src/types/internal-modules.d.ts` | 内部 npm 包类型声明 |
| `src/entrypoints/sdk/*.ts` | SDK 类型 stub |
| `src/types/message.ts` | Message 系列类型 stub |
| `scripts/create-type-stubs.mjs` | 自动 stub 生成脚本 |
| `scripts/fix-default-stubs.mjs` | 修复默认导出 stub |
| `scripts/fix-missing-exports.mjs` | 补全缺失导出 |

---

## 五、Monorepo 改造（2026-03-31）

### 5.1 背景

`color-diff-napi` 原先是手工放在 `node_modules/` 下的 stub 文件，导出的是普通对象而非 class，导致 `new ColorDiff(...)` 报错：
```
ERROR Object is not a constructor (evaluating 'new ColorDiff(patch, firstLine, filePath, fileContent)')
```
同时 `@ant/*`、其他 `*-napi` 包也只有 `declare module` 类型声明，无运行时实现。

### 5.2 方案

将项目改造为 **Bun workspaces monorepo**，所有内部包统一放在 `packages/` 下，通过 `workspace:*` 依赖解析。

### 5.3 创建的 workspace 包

| 包名 | 路径 | 类型 |
|------|------|------|
| `color-diff-napi` | `packages/color-diff-napi/` | 完整实现（~1000行 TS，从 `src/native-ts/color-diff/` 移入） |
| `modifiers-napi` | `packages/modifiers-napi/` | stub（macOS 修饰键检测） |
| `audio-capture-napi` | `packages/audio-capture-napi/` | stub |
| `image-processor-napi` | `packages/image-processor-napi/` | stub |
| `url-handler-napi` | `packages/url-handler-napi/` | stub |
| `@ant/claude-for-chrome-mcp` | `packages/@ant/claude-for-chrome-mcp/` | stub |
| `@ant/computer-use-mcp` | `packages/@ant/computer-use-mcp/` | stub（含 subpath exports: sentinelApps, types） |
| `@ant/computer-use-input` | `packages/@ant/computer-use-input/` | stub |
| `@ant/computer-use-swift` | `packages/@ant/computer-use-swift/` | stub |

### 5.4 新增的 npm 依赖

| 包名 | 原因 |
|------|------|
| `@opentelemetry/semantic-conventions` | 构建报错缺失 |
| `fflate` | `src/utils/dxt/zip.ts` 动态 import |
| `vscode-jsonrpc` | `src/services/lsp/LSPClient.ts` import |
| `@aws-sdk/credential-provider-node` | `src/utils/proxy.ts` 动态 import |

### 5.5 关键变更

- `package.json`：添加 `workspaces`，添加所有 workspace 包和缺失 npm 依赖
- `src/types/internal-modules.d.ts`：删除已移入 monorepo 的 `declare module` 块，仅保留 `bun:bundle`、`bun:ffi`、`@anthropic-ai/mcpb`
- `src/native-ts/color-diff/` → `packages/color-diff-napi/src/`：移动并内联了对 `stringWidth` 和 `logError` 的依赖
- 删除 `node_modules/color-diff-napi/` 手工 stub

### 5.6 构建验证

```
$ bun run build
Bundled 5326 modules in 491ms
  cli.js  25.74 MB  (entry point)
```

---

## 六、系统性类型修复（2026-03-31）

### 6.1 背景

反编译产生的源码存在 ~1341 个 tsc 类型错误，主要成因：
- `unknown` 类型上的属性访问（714 个，占 54%）
- 类型赋值不兼容（212 个）
- 参数类型不匹配（140 个）
- 不可能的字面量比较（106 个，如 `"external" === 'ant'`）

### 6.2 修复策略

通过 4 轮并行 agent（每轮 7 个）系统性修复，**从 1341 降至 ~294**（减少 78%）。

#### 根因修复（影响面最大）

| 修复 | 影响 |
|------|------|
| `useAppState<R>` 添加泛型签名 (`AppState.tsx`) | 消除全局大量 `unknown` 返回值 |
| `Message` 类型重构 (`message.ts`) | content 改为 `string \| ContentBlockParam[] \| ContentBlock[]`；添加 `MessageType` 扩展联合；`GroupedToolUseMessage`/`CollapsedReadSearchGroup` 结构化 |
| `SDKAssistantMessageError` 命名冲突修复 (`coreTypes.generated.ts`) | 解决 37 个 errors.ts 类型错误 |
| SDK 消息类型增强 (`coreTypes.generated.ts`) | `SDKAssistantMessage`/`SDKUserMessage` 等添加具体字段声明 |
| `NonNullableUsage` 扩展 (`sdkUtilityTypes.ts`) | 添加 snake_case 属性声明 |

#### 批量模式修复

| 模式 | 修复方式 | 数量 |
|------|----------|------|
| `"external" === 'ant'` 编译常量比较 | `("external" as string) === 'ant'` | ~60 处 |
| `unknown` 属性访问 | 精确类型断言（`as SomeType`） | ~400 处 |
| `message.content` union 无法调用数组方法 | `Array.isArray()` 守卫 | ~80 处 |
| stub 包缺失方法/类型 | 补全 stub 类型声明 | ~15 个包 |

#### Stub 包类型补全

| 包 | 补全内容 |
|----|----------|
| `@ant/computer-use-swift` | `ComputerUseAPI` 完整接口（apps/display/screenshot） |
| `@ant/computer-use-input` | `ComputerUseInputAPI` 完整接口 |
| `audio-capture-napi` | 4 个函数签名 |

### 6.3 修复的关键文件

| 文件 | 修复错误数 |
|------|-----------|
| `src/screens/REPL.tsx` | ~100 |
| `src/utils/hooks.ts` | ~81 |
| `src/utils/sessionStorage.ts` | ~58 |
| `src/components/PromptInput/` | ~45 |
| `src/services/api/errors.ts` | ~37 |
| `src/utils/computerUse/executor.ts` | ~36 |
| `src/utils/messages.ts` | ~83 |
| `src/QueryEngine.ts` | ~39 |
| `src/services/api/claude.ts` | ~35 |
| `src/cli/print.ts` + `structuredIO.ts` | ~46 |
| 其他 ~50 个文件 | ~487 |

---

## 七、多租户云端隔离与安全权限架构重构（2026-05-27）

在本次迭代中，我们对项目进行了云端与本地跨平台混合架构的扩展，新增了多租户工作区物理隔离、会话原生断点恢复与安全权限过滤体系。

### 7.1 新增/修改的文件及用途清单

| 变更类型 | 文件路径 | 用途与修改点说明 |
|:---|:---|:---|
| **[NEW]** | `apps/claude-code/src/headless-server.ts` | **云端无头服务主入口**：将 `claude-code` 核心引擎进行二次封装，对外通过 `process.stdin/stdout` 吐出 NDJSON 事件流。 |
| **[NEW]** | `apps/claude-code/src/multi-tenant/ws-gateway.ts` | **WebSocket 通信网关**：监听 `9800` 端口，实现客户端鉴权、API 连接连通性测试（Probing）探针，并桥接 WebSocket 与底层无头会话子进程。 |
| **[NEW]** | `apps/claude-code/src/multi-tenant/orchestrator.ts` | **会话并发与进程编排器**：管理多租户会话生命周期。为每个会话在云端影子根目录创建隔离的项目文件夹，并以独立子进程运行 `headless-server`。 |
| **[NEW]** | `apps/claude-code/src/multi-tenant/monkey-patch.ts` | **文件系统与进程劫持补丁**：重写 `fs.writeFileSync`、`fsPromises.writeFile` 以及 `child_process.spawn`，拦截云端影子文件操作，并通过 RPC 穿隧至用户本地 Bridge 代理。 |
| **[NEW]** | `apps/claude-code/src/multi-tenant/rpc.ts` | **RPC 全双工调度层**：管理云端影子操作与本地 Bridge 代理间 RPC 请求与响应的标识派发。 |
| **[MODIFY]** | `apps/claude-code/src/multi-tenant/orchestrator.test.ts` | **自动化测试套件**：重构测试中的 Mock Server 生成器，使其从 `stdin` 读取配置流，全面覆盖隔离与超时终止的 11 项单元测试。 |
| **[MODIFY]** | `apps/client/src/services/CloudSyncService.ts` | **前端连接服务**：鉴权时自动携带本地项目真实 `workspacePath` 与安全策略（安全级别、白名单、沙箱状态等）到云端 `envOverrides`。 |
| **[MODIFY]** | `apps/client/src/components/sidebar/SettingsPanel.tsx` | **前端安全设置面板**：实装完整的免审模式（Full）、交互审计（Ask）、沙箱隔离（Sandbox）选择，以及白名单输入框与连通性测试指示器。 |

### 7.2 关键底层重构点与防忘备忘录

1. **项目级物理隔离目录**：
   - 云端租户物理隔离根目录：`{dataRoot}/{userId}/projects/{projectName}/`
   - 其中 `{projectName}` 自动提取自前端的 `workspacePath`（本地项目绝对路径最后一段盘符或文件夹名），彻底解决了多目录重合、跨目录覆盖的同步冲突问题。
2. **会话历史无损原生加载**：
   - 彻底移除了自定义 `initialMessages` 的注入层。
   - 统一注入环境变量 `CLAUDE_CONFIG_DIR = {userDir}/.claude` 到子进程，结合底层原生的 `switchSession(config.sessionId)`，实现了原生会话存储中聊天记录的完美持久化与无缝断点续接。
3. **安全过滤与跨目录白名单**：
   - 前端设置面板的 “安全与权限” 选项，会随 WebSocket `auth` 鉴权握手事件在 `envOverrides` 中自动传递：
     - `CLAUDE_SAFETY_LEVEL`: `full` (免审模式) | `ask` (交互审计) | `sandbox` (沙箱隔离)
     - `CLAUDE_SANDBOX_ENABLED`: `true` | `false`
     - `CLAUDE_PATH_WHITELIST`: 半角逗号或分号分隔的物理路径白名单（如 `E:\Shared;D:\Library`）
   - 后端服务及本地 `bridge.exe` 守护进程会自动识别这些参数并进行命令阻断与文件代理路径的穿越比对放行。

## 八、本地直连模式与路径规范化修复（2026-05-27 ~ 2026-05-28）

### 8.1 问题背景

在本轮修复前，系统存在以下三个关键 Bug：

1. **路径拼装错误**：前端 project path 存储为相对路径（如 `./GTP5.5`），后端 orchestrator 检测到非绝对路径后 fallback 到影子目录 `{dataRoot}/{userId}/projects/GTP5.5/workspace`，导致 AI 的 CWD 落入空的影子目录而非用户的物理工作区 `E:\clawd-home\GTP5.5`。
2. **品牌化路径污染**：UI 层的 `sanitizeBrand` 正则替换将所有 `claude` 替换为 `CLAUDE`，导致文件路径中的 `claude-code` 被错误渲染为 `CLAUDE-code`。
3. **Linux 风格 Windows 路径**：默认项目路径 `/e/Unreal/A1workhouse` 未被转换为 Windows 标准格式 `E:\Unreal\A1workhouse`。

### 8.2 新增/修改文件及修改点

| 变更类型 | 文件路径 | 修改行号 | 修改点说明 |
|:---|:---|:---|:---|
| **[MODIFY]** | `apps/client/src/services/CloudSyncService.ts` | L35-97, L136-157 | 1. 新增 `currentProjectId` 属性，用于检测项目切换并触发 WebSocket 重连；2. `connect()` 中增加 projectId 变化检测；3. `onopen` 中增加双层路径规范化：(a) 将相对路径 `./xxx` 结合 `claude_workspace_base_dir` 扩展为绝对路径, (b) 将 Linux 风格 `/e/xxx` 转换为 `E:\xxx` |
| **[MODIFY]** | `apps/claude-code/src/multi-tenant/ws-gateway.ts` | L180-212 | `handleAuth` 中新增后端侧路径规范化（与前端双层保障）：(a) 相对路径 `./xxx` → 结合 `CLAUDE_WORKSPACE_BASE` 环境变量或 `envOverrides` 中的基目录扩展为绝对路径, (b) Linux 风格 `/e/xxx` → `E:\xxx` |
| **[MODIFY]** | `apps/client/src/components/chat/ChatArea.tsx` | L170 | `useEffect` 依赖数组增加 `activeProjectId`，确保项目切换时重新注册 CloudSyncService 监听器并触发重连 |
| **[MODIFY]** | `apps/client/src/store/useAppStore.ts` | (前轮已改) | 移除了 UI 层 `sanitizeBrand` 正则，恢复原始消息存储 |
| **[MODIFY]** | `apps/claude-code/src/headless-server.ts` | L100-118, L260-271 | 1. 当 `remoteCwd` 为绝对路径时，跳过 `applyMonkeyPatches`，直接在本地物理目录执行；2. 注入 `systemBrandingInstruction` 到 prompt 开头，让 AI 模型原生自称 CLAUDE |
| **[MODIFY]** | `apps/claude-code/src/multi-tenant/orchestrator.ts` | L186-191 | 将 `options.workspacePath` 透传为 `remoteCwd`（如为绝对路径则直接使用） |
| **[MODIFY]** | `apps/client/src/components/sidebar/SettingsPanel.tsx` | L26-28, L78 | 新增 "Workspace Base Directory" 配置输入（localStorage key: `claude_workspace_base_dir`） |
| **[MODIFY]** | `apps/client/src/components/sidebar/Sidebar.tsx` | L20-22 | `handleOpenFolder` 使用 `claude_workspace_base_dir` 拼接绝对路径 |

### 8.3 路径规范化数据流

```
前端 project.path (如 "./GTP5.5")
  ↓
CloudSyncService.onopen → 路径规范化（前端侧）
  ↓ workspacePath = "E:\clawd-home\GTP5.5"
WsGateway.handleAuth → 路径规范化（后端侧，双层保障）
  ↓ ctx.workspacePath = "E:\clawd-home\GTP5.5"
Orchestrator.startSession → 检测绝对路径
  ↓ remoteCwd = "E:\clawd-home\GTP5.5"
headless-server.injectSessionEnvironment
  → process.chdir("E:\clawd-home\GTP5.5")
  → 跳过 applyMonkeyPatches（本地直连模式）
  → AI 直接在物理目录中读写文件
```

### 8.4 品牌化策略变更

- **移除**：UI 层的 `sanitizeBrand` 正则替换（`replace(/\bclaude\b/gi, 'CLAUDE')`），该方法导致路径中的 `claude-code` 被误替换为 `CLAUDE-code`。
- **新增**：在 `headless-server.ts` 中通过 `systemBrandingInstruction` 原生注入到 AI prompt 开头，让模型自然自称 CLAUDE，不依赖后处理替换。

