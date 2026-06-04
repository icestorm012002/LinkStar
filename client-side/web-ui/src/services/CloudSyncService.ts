/**
 * CloudSyncService — 前端 WebSocket 通信单例
 *
 * 职责：
 *   1. 维护与后端 WsGateway 的 WebSocket 长连接
 *   2. 自动重连（指数退避）
 *   3. 发送 auth / chat / cancel 消息
 *   4. 接收引擎事件并分发给 Zustand Store
 *
 * 前端 UI 组件不直接操作 WebSocket，全部通过本 Service 进行。
 */

import { useAppStore } from '../store/useAppStore';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type ServerMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'session_start'; sessionId: string }
  | { type: 'engine_event'; sessionId: string; event: any }
  | { type: 'session_end'; sessionId: string; code: number | null; signal: string | null }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'test_connection_result'; success: boolean; status: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'browse_directory_result'; path: string; entries: { name: string; isDir: boolean; path: string }[] }
  | { type: 'read_file_result'; path: string; content: string; error?: string }
  | { type: 'system_paths_result'; paths?: Record<string, string>; drives?: string[] };

type EventCallback = (msg: ServerMessage) => void;

class CloudSyncServiceImpl {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<EventCallback> = new Set();
  private currentSessionId: string | null = null;
  private currentProjectId: string | null = null;
  private pendingMessages: any[] = [];
  
  private _state: ConnectionState = 'disconnected';
  
  get state() { return this._state; }
  set state(val: ConnectionState) {
    this._state = val;
    useAppStore.getState().setConnectionState(val);
  }

  constructor() {
    this.url = this.buildUrl();
  }

  private buildUrl(): string {
    // 强制使用当前页面的地址（通过 Vite 代理），避免 localStorage 里的 9800 旧配置干扰
    const wsHost = window.location.hostname;
    const wsPort = window.location.port;
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    let base = `${protocol}${wsHost}${wsPort ? `:${wsPort}` : ''}/ws`;

    if (!base.includes('/ws')) {
      base = base.replace(/\/$/, '') + '/ws';
    }

    const state = useAppStore.getState();
    let sessionId = state.activeConversationId || 'conv-1';
    const userId = localStorage.getItem('linkstar_user_id') || 'anonymous';
    if (!sessionId.endsWith(`_${userId}`)) {
      sessionId = `${sessionId}_${userId}`;
    }
    const token = localStorage.getItem('linkstar_token') || '';
    const workspaceId = localStorage.getItem('linkstar_workspace_id') || 'default';

    return `${base}?session_id=${sessionId}&user_id=${userId}&token=${token}&workspace_id=${workspaceId}&client_type=web`;
  }

  /** 注册事件监听 */
  subscribe(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 建立连接 */
  connect(): void {
    const state = useAppStore.getState();
    let targetSessionId = state.activeConversationId || 'conv-1';
    const userId = localStorage.getItem('linkstar_user_id') || 'anonymous';
    if (!targetSessionId.endsWith(`_${userId}`)) {
      targetSessionId = `${targetSessionId}_${userId}`;
    }
    const targetProjectId = state.activeProjectId;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.currentSessionId !== targetSessionId || this.currentProjectId !== targetProjectId) {
        console.log(`[CloudSync] Session or Project changed (session: ${this.currentSessionId} -> ${targetSessionId}, project: ${this.currentProjectId} -> ${targetProjectId}), reconnecting...`);
        this.disconnect();
      } else {
        return;
      }
    }

    this.currentSessionId = targetSessionId;
    this.currentProjectId = targetProjectId;
    // 每次连接前重新读取 URL（Settings 可能已修改）
    this.url = this.buildUrl();
    this.state = 'connecting';
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.state = 'connected';
      this.reconnectAttempts = 0;
      console.log('[CloudSync] Connected to backend');
      
      // Automatically send auth (even if API key is not entered yet)
      const apiKey = localStorage.getItem('linkstar_api_key') || '';
      const displayName = localStorage.getItem('linkstar_display_name') || 'anonymous';
      const apiProvider = localStorage.getItem('linkstar_api_provider') || 'anthropic';
      const baseUrl = localStorage.getItem('linkstar_base_url') || '';
      
      const clientOS = this.detectClientOS();
      const envOverrides: Record<string, string> = {
        LINKSTAR_SAFETY_LEVEL: localStorage.getItem('linkstar_safety_level') || 'full',
        LINKSTAR_SANDBOX_ENABLED: localStorage.getItem('linkstar_sandbox_enabled') || 'true',
        LINKSTAR_PATH_WHITELIST: localStorage.getItem('linkstar_path_whitelist') || '',
      };
      
      if (apiKey) {
        if (apiProvider === 'anthropic') {
          envOverrides.ANTHROPIC_API_KEY = apiKey;
          if (baseUrl) envOverrides.ANTHROPIC_BASE_URL = baseUrl;
        } else if (apiProvider === 'bedrock') {
          envOverrides.CLAUDE_CODE_USE_BEDROCK = '1';
        } else if (apiProvider === 'vertex') {
          envOverrides.CLAUDE_CODE_USE_VERTEX = '1';
        } else if (apiProvider === 'gemini') {
          envOverrides.GEMINI_API_KEY = apiKey;
          if (baseUrl) envOverrides.GOOGLE_GEMINI_BASE_URL = baseUrl;
        } else if (apiProvider === 'codex') {
          envOverrides.CODEX_API_KEY = apiKey;
        } else if (apiProvider === 'deepseek') {
          envOverrides.DEEPSEEK_API_KEY = apiKey;
          if (baseUrl) envOverrides.DEEPSEEK_BASE_URL = baseUrl;
        } else if (apiProvider === 'openai') {
          envOverrides.OPENAI_API_KEY = apiKey;
          if (baseUrl) envOverrides.OPENAI_BASE_URL = baseUrl;
        }
      }

      if (apiProvider) {
        envOverrides.CLAUDE_PROVIDER = apiProvider;
      }
      const targetModel = localStorage.getItem('linkstar_model');
      if (targetModel) {
        envOverrides.CLAUDE_MODEL = targetModel;
      }
      
      const activeProject = state.projects.find(p => p.id === state.activeProjectId);
      let workspacePath = activeProject ? activeProject.path : '';
      
      console.log('[CloudSync] Sending authentication for tenant:', displayName, 'workspacePath:', workspacePath);
      this.sendAuth(displayName, clientOS, undefined, envOverrides, workspacePath);

      // Flush pending messages
      if (this.pendingMessages.length > 0) {
        console.log(`[CloudSync] Flushing ${this.pendingMessages.length} pending messages`);
        const messagesToSend = [...this.pendingMessages];
        this.pendingMessages = [];
        for (const msg of messagesToSend) {
          this.send(msg);
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);
        this.notifyListeners(msg);
      } catch (err) {
        console.error('[CloudSync] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      this.state = 'disconnected';
      console.log('[CloudSync] Disconnected from backend');
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      this.state = 'error';
      console.error('[CloudSync] WebSocket error:', err);
    };
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
  }

  /** 发送认证消息 */
  sendAuth(userId: string, clientOS: 'win32' | 'darwin' | 'linux', clientShell?: string, envOverrides?: Record<string, string>, workspacePath?: string): void {
    this.send({ type: 'auth', userId, clientOS, clientShell, envOverrides, workspacePath });
  }

  /** 发送聊天消息 */
  sendChat(content: string, model?: string): void {
    this.send({ type: 'chat', content, model });
  }

  /** 取消当前会话 */
  cancelSession(): void {
    this.send({ type: 'cancel_session' });
  }

  /** 发送 RPC 响应（工具执行结果） */
  sendRpcResponse(payload: any): void {
    this.send({ type: 'rpc_response', payload });
  }

  /** 获取远端目录 */
  browseDirectory(path: string): Promise<{ path: string; entries: { name: string; isDir: boolean; path: string }[] }> {
    return new Promise((resolve, reject) => {
      const listener = (msg: ServerMessage) => {
        if (msg.type === 'browse_directory_result' && msg.path === path) {
          this.listeners.delete(listener);
          resolve({ path: msg.path, entries: msg.entries });
        } else if (msg.type === 'error' && msg.message.includes('browse_directory')) {
          this.listeners.delete(listener);
          reject(new Error(msg.message));
        }
      };
      this.listeners.add(listener);
      this.send({ type: 'browse_directory', path });
      
      // 10s timeout
      setTimeout(() => {
        if (this.listeners.has(listener)) {
          this.listeners.delete(listener);
          reject(new Error('browse_directory timeout'));
        }
      }, 10000);
    });
  }

  /** 获取系统路径和驱动器 */
  getSystemPaths(): Promise<{ paths: Record<string, string>; drives: string[] }> {
    return new Promise((resolve, reject) => {
      const listener = (msg: ServerMessage) => {
        if (msg.type === 'system_paths_result') {
          this.listeners.delete(listener);
          resolve({ paths: msg.paths || {}, drives: msg.drives || [] });
        } else if (msg.type === 'error' && msg.message.includes('get_system_paths')) {
          this.listeners.delete(listener);
          reject(new Error(msg.message));
        }
      };
      this.listeners.add(listener);
      this.send({ type: 'get_system_paths' });
      
      setTimeout(() => {
        if (this.listeners.has(listener)) {
          this.listeners.delete(listener);
          reject(new Error('get_system_paths timeout'));
        }
      }, 5000);
    });
  }

  /** 获取文件内容 */
  readFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const listener = (msg: ServerMessage) => {
        if (msg.type === 'read_file_result' && msg.path === path) {
          this.listeners.delete(listener);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg.content);
          }
        }
      };
      this.listeners.add(listener);
      this.send({ type: 'read_file', path });
      
      // 10s timeout
      setTimeout(() => {
        if (this.listeners.has(listener)) {
          this.listeners.delete(listener);
          reject(new Error('read_file timeout'));
        }
      }, 10000);
    });
  }

  // -------------------------------------------------------------------------
  // 内部方法
  // -------------------------------------------------------------------------

  send(msg: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[CloudSync] Not connected. Queuing message:', msg.type);
      if (msg.type !== 'auth') {
        this.pendingMessages.push(msg);
      }
    }
  }

  private notifyListeners(msg: ServerMessage): void {
    for (const cb of this.listeners) {
      try {
        cb(msg);
      } catch (err) {
        console.error('[CloudSync] Listener error:', err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[CloudSync] Max reconnect attempts reached');
      return;
    }
    // 指数退避：1s, 2s, 4s, 8s...（上限 30s）
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[CloudSync] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private detectClientOS(): 'win32' | 'darwin' | 'linux' {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'win32';
    if (ua.includes('mac')) return 'darwin';
    return 'linux';
  }
}

// 全局单例
export const CloudSyncService = new CloudSyncServiceImpl();
