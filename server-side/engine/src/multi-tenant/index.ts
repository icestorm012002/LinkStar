/**
 * multi-tenant/index.ts — 多租户模块统一导出
 *
 * 本模块提供多租户 Cloud Brain 后端适配的核心公共 API。
 * 上游（如 WebSocket 服务器、HTTP API 层）只需导入本模块即可。
 */

export {
  SessionOrchestrator,
  initializeUserDirectory,
  type OrchestratorConfig,
  type UserIdentity,
  type SessionState,
} from './orchestrator.js'

export {
  WsGateway,
  type ClientMessage,
  type ServerMessage,
} from './ws-gateway.js'

export {
  type HeadlessSessionConfig,
} from '../headless-server.js'
