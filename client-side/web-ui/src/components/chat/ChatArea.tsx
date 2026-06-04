import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore } from '../../store/useAppStore';
import { Send, Wifi, WifiOff, Loader2, Square } from 'lucide-react';
import { CloudSyncService } from '../../services/CloudSyncService';

function translatePaths(content: string, cloudPath: string | null, localPath: string): string {
  if (!cloudPath) return content;
  
  // Normalize both slashes
  const cleanCloud = cloudPath.replace(/\\/g, '/');
  
  // Escape regex special chars
  const escapedCloud = cleanCloud.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  // Allow flexible / or \ in path separators
  const flexibleCloudRegexStr = escapedCloud.replace(/\\\/|\\\\/g, '[\\/\\\\]+');
  const regex = new RegExp(flexibleCloudRegexStr, 'gi');
  
  return content.replace(regex, localPath);
}

// LINKSTAR 支持的斜杠命令列表
const SLASH_COMMANDS = [
  { name: '/help', desc: 'Show available commands' },
  { name: '/status', desc: 'Show current session status' },
  { name: '/compact', desc: 'Compact conversation context' },
  { name: '/config', desc: 'Edit settings' },
  { name: '/model', desc: 'Switch AI model' },
  { name: '/cost', desc: 'Show session cost' },
  { name: '/clear', desc: 'Clear conversation' },
  { name: '/memory', desc: 'Manage project memory' },
  { name: '/diff', desc: 'Show git diff' },
  { name: '/review', desc: 'Review code changes' },
  { name: '/plan', desc: 'Toggle plan mode' },
  { name: '/init', desc: 'Initialize project config' },
  { name: '/resume', desc: 'Resume a previous session' },
  { name: '/permissions', desc: 'Manage permissions' },
  { name: '/doctor', desc: 'Run diagnostics' },
  { name: '/login', desc: 'Login to your account' },
  { name: '/logout', desc: 'Logout' },
];

export function ChatArea() {
  const { 
    conversations, 
    activeConversationId, 
    addMessage,
    upsertMessage,
    apiProvider,
    model,
    setApiModel,
    projects,
    activeProjectId,
    connectionState
  } = useAppStore();
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(SLASH_COMMANDS);
  const [selectedCmdIndex, setSelectedCmdIndex] = useState(0);
  const [cloudCwd, setCloudCwd] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = activeConversationId ? conversations[activeConversationId] : null;
  const activeProject = projects.find(p => p.id === activeProjectId);

  const cloudCwdRef = useRef(cloudCwd);
  cloudCwdRef.current = cloudCwd;
  const activeProjectRef = useRef(activeProject);
  activeProjectRef.current = activeProject;

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  // 注册 CloudSyncService 事件监听
  useEffect(() => {
    // 尝试连接后端
    CloudSyncService.connect();

    let bufferedContent: { id: string; role: 'assistant'; content: string } | null = null;
    let lastUpdate = 0;
    const THROTTLE_MS = 60; // Max 16 FPS updates to prevent DOM choking

    const flushBuffer = () => {
      if (bufferedContent) {
        upsertMessage(activeConversationId, bufferedContent);
        bufferedContent = null;
        lastUpdate = Date.now();
      }
    };

    const intervalId = setInterval(() => {
      flushBuffer();
    }, THROTTLE_MS);

    const unsub = CloudSyncService.subscribe((msg) => {
      if (!activeConversationId) return;

      switch (msg.type) {
        case 'auth_ok':
          // Authenticated successfully
          break;

        case 'session_start':
          setIsThinking(true);
          break;

        case 'engine_event': {
          const ev = msg.event;
          if (!ev) break;

          if (ev.type === 'session_start') {
            setIsThinking(true);
          } else if (ev.type === 'session_end') {
            setIsThinking(false);
            flushBuffer();
          } else if (ev.type === 'engine_event') {
            const data = ev.data;
            if (data && data.type === 'system' && data.subtype === 'init') {
              if (data.cwd) {
                console.log('[CloudSync] Captured cloud CWD:', data.cwd);
                setCloudCwd(data.cwd);
              }
            }
            if (data && data.type === 'assistant') {
              const blocks = data.message?.content || [];
              const contentSegments: string[] = [];

              for (const block of blocks) {
                if (block.type === 'text') {
                  contentSegments.push(block.text);
                } else if (block.type === 'tool_use') {
                  // Hide massive text payloads and instead dispatch them to the ContextPanel
                  let toolLabel = `⚙️ **[Tool Call] ${block.name}**`;
                  let toolParams = '';
                  
                  if (block.name === 'BashTool' && block.input?.command) {
                    toolLabel = `⚡ **[Terminal] Executing command**`;
                    toolParams = `\`${block.input.command}\``;
                    useAppStore.getState().setActiveDocument({
                      title: 'Terminal Execution',
                      content: block.input.command,
                      language: 'bash'
                    });
                    useAppStore.getState().setActiveTab('overview');
                  } else if (block.name === 'FileWriteTool' && block.input?.file_contents) {
                    toolLabel = `📝 **[File Edit] Writing to ${block.input.file_path}**`;
                    
                    let language = 'plaintext';
                    const path = block.input.file_path || '';
                    if (path.endsWith('.ts') || path.endsWith('.tsx')) language = 'typescript';
                    else if (path.endsWith('.js') || path.endsWith('.jsx')) language = 'javascript';
                    else if (path.endsWith('.json')) language = 'json';
                    else if (path.endsWith('.md')) language = 'markdown';
                    
                    useAppStore.getState().setActiveDocument({
                      title: path.split('/').pop() || path,
                      content: block.input.file_contents,
                      language
                    });
                    useAppStore.getState().setActiveTab('overview');
                  } else if (block.name === 'FileReadTool') {
                     toolLabel = `📖 **[File Read] Reading ${block.input.file_path}**`;
                  } else {
                    const params = block.input 
                      ? Object.entries(block.input).map(([k, v]) => `${k}: \`${v}\``).join(', ') 
                      : '';
                    toolParams = `> *Parameters*: ${params || 'None'}`;
                  }
                  
                  contentSegments.push(`\n\n${toolLabel}\n${toolParams}\n\n`);
                }
              }

              const textContent = contentSegments.join('').trim();
              if (textContent) {
                const curProject = activeProjectRef.current;
                const curCloudCwd = cloudCwdRef.current;
                const translatedContent = (curProject && curCloudCwd)
                  ? translatePaths(textContent, curCloudCwd, curProject.path)
                  : textContent;

                const msgId = data.uuid || data.message?.id || 'last-assistant-msg';
                const now = Date.now();

                // If it's a new message ID or enough time has passed, update immediately
                if (now - lastUpdate > THROTTLE_MS) {
                  upsertMessage(activeConversationId, {
                    id: msgId,
                    role: 'assistant',
                    content: translatedContent,
                  });
                  lastUpdate = now;
                  bufferedContent = null;
                } else {
                  // Buffer it to be flushed by the interval
                  bufferedContent = {
                    id: msgId,
                    role: 'assistant',
                    content: translatedContent,
                  };
                }
              }
            } else if (data && data.type === 'result') {
              setIsThinking(false);
              flushBuffer();
            }
          }
          break;
        }

        case 'session_end':
          setIsThinking(false);
          flushBuffer();
          break;

        case 'session_error':
          setIsThinking(false);
          flushBuffer();
          addMessage(activeConversationId, {
            id: Date.now().toString(),
            role: 'system',
            content: `⚠️ Error: ${msg.error}`,
          });
          break;

        case 'error':
          flushBuffer();
          addMessage(activeConversationId, {
            id: Date.now().toString(),
            role: 'system',
            content: `⚠️ ${msg.message}`,
          });
          break;
      }
    });

    return () => {
      unsub();
      clearInterval(intervalId);
      flushBuffer();
    };
  }, [activeConversationId, addMessage, activeProjectId]);

  // 处理斜杠命令自动补全
  useEffect(() => {
    if (input.startsWith('/')) {
      const query = input.toLowerCase();
      const filtered = SLASH_COMMANDS.filter(c => c.name.startsWith(query));
      setFilteredCommands(filtered);
      setShowSlashMenu(filtered.length > 0);
      setSelectedCmdIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, [input]);

  const handleStop = () => {
    if (connectionState === 'connected') {
      CloudSyncService.cancelSession();
    }
    setIsThinking(false);
  };

  const handleSend = () => {
    if (!input.trim() || !activeConversationId) return;

    const token = localStorage.getItem('linkstar_token');
    if (!token) {
      window.dispatchEvent(new Event('linkstar_require_login'));
      return;
    }

    const apiKey = localStorage.getItem('linkstar_api_key');
    if (!apiKey) {
      addMessage(activeConversationId, {
        id: Date.now().toString(),
        role: 'system',
        content: '⚠️ Please configure your AI Provider API Key in the Settings panel before chatting.',
      });
      return;
    }

    // 添加用户消息到 UI
    addMessage(activeConversationId, {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    });

    // 通过 WebSocket 发送到后端
    if (connectionState === 'connected') {
      // 斜杠命令也通过 chat 发送，后端引擎会自动识别处理
      CloudSyncService.sendChat(input, model || undefined);
      setIsThinking(true);
    } else {
      // 未连接时的降级处理：提示用户
      addMessage(activeConversationId, {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: '⚠️ Not connected to backend. Please check if the server is running on port 9800.',
      });
    }

    setInput('');
    setShowSlashMenu(false);
  };

  const selectSlashCommand = (cmdName: string) => {
    setInput(cmdName + ' ');
    setShowSlashMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCmdIndex(i => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCmdIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (filteredCommands[selectedCmdIndex]) {
          e.preventDefault();
          selectSlashCommand(filteredCommands[selectedCmdIndex].name);
          return;
        }
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getModelsForCurrentProvider = () => {
    switch (apiProvider) {
      case 'anthropic':
        return [
          { value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' },
          { value: 'claude-opus-4-20250514', label: 'Opus 4' },
          { value: 'claude-3-5-sonnet-20241022', label: 'Sonnet 3.5' },
          { value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' }
        ];
      case 'gemini':
        return [
          { value: 'google-gemini/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
          { value: 'google-gemini/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
          { value: 'google-gemini/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite' },
          { value: 'google-gemini/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { value: 'google-gemini/gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
        ];
      case 'openai':
        return [
          { value: 'openai/gpt-4o', label: 'GPT-4o' },
          { value: 'openai/gpt-4o-mini', label: 'GPT-4o-mini' },
          { value: 'openai/o1-preview', label: 'o1-preview' },
          { value: 'openai/o1-mini', label: 'o1-mini' }
        ];
      case 'codex':
        return [
          { value: 'openai-codex/gpt-5.5', label: 'GPT 5.5 (Codex)' }
        ];
      case 'deepseek':
        return [
          { value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
          { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
          { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (V3)' },
          { value: 'deepseek/deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' }
        ];
      default:
        return [
          { value: 'claude-sonnet-4-20250514', label: 'Sonnet 4' }
        ];
    }
  };

  const getBaseUrlForProvider = (provider: string) => {
    switch (provider) {
      case 'anthropic': return 'https://api.anthropic.com';
      case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/openai';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'openai': return 'https://api.openai.com/v1';
      default: return '';
    }
  };

  return (
    <main style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-primary)',
      position: 'relative'
    }}>
      {/* Header */}
      <header style={{
        height: '48px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1rem',
        fontWeight: 500,
        color: 'var(--header-text)',
        backgroundColor: 'var(--header-bg)'
      }}>
        <span>{activeConv?.title || 'New Conversation'}</span>
        {/* 连接状态指示器 */}
        <div id="connection-status-container" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
          {connectionState === 'connected' ? (
            <>
              <Wifi size={14} color="#4ade80" />
              <span id="connection-status" style={{ color: '#4ade80' }}>Connected</span>
            </>
          ) : connectionState === 'connecting' ? (
            <>
              <Loader2 size={14} color="#f59e0b" className="spin" style={{ animation: 'spin 1s linear infinite' }} />
              <span id="connection-status" style={{ color: '#f59e0b' }}>Connecting...</span>
            </>
          ) : (
            <>
              <WifiOff size={14} color="#f87171" />
              <span id="connection-status" style={{ color: '#f87171' }}>Offline</span>
            </>
          )}
        </div>
      </header>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 15%' }}>
        {activeConv?.messages.map(msg => {
          const displayContent = (msg.role === 'assistant' && activeProject && cloudCwd)
            ? translatePaths(msg.content, cloudCwd, activeProject.path)
            : msg.content;
          return (
            <div key={msg.id} style={{
              marginBottom: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                fontSize: '0.75rem',
                color: msg.role === 'system' ? '#f59e0b' : 'var(--text-tertiary)',
                marginBottom: '0.3rem',
                textTransform: 'uppercase',
                fontWeight: 600
              }}>
                {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'LINKSTAR'}
              </div>
              <div style={{
                backgroundColor: msg.role === 'user' ? 'var(--bg-tertiary)' : msg.role === 'system' ? 'rgba(245, 158, 11, 0.1)' : (msg.role === 'assistant' ? 'transparent' : 'var(--bg-secondary)'),
                padding: msg.role === 'assistant' ? '0.25rem 0' : '0.75rem 1rem',
                borderRadius: '8px',
                maxWidth: '85%',
                lineHeight: 1.7,
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                border: msg.role === 'system' ? '1px solid rgba(245, 158, 11, 0.3)' : 'none',
                borderLeft: undefined,
                fontFamily: msg.role === 'assistant' ? "'Inter', sans-serif" : undefined,
                letterSpacing: msg.role === 'assistant' ? '0.01em' : undefined
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {displayContent}
                </ReactMarkdown>
              </div>
            </div>
          );
        })}

        {/* Thinking Indicator */}
        {isThinking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', fontSize: '0.85rem' }}>
            <Loader2 size={16} className="spin" />
            <span className="thinking-shimmer-text">LINKSTAR is thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Slash Command Autocomplete Menu */}
      {showSlashMenu && (
        <div style={{
          position: 'absolute',
          bottom: '140px',
          left: '15%',
          right: '15%',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          maxHeight: '200px',
          overflowY: 'auto',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
          zIndex: 100
        }}>
          {filteredCommands.map((cmd, i) => (
            <div
              key={cmd.name}
              onClick={() => selectSlashCommand(cmd.name)}
              style={{
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: i === selectedCmdIndex ? 'var(--bg-tertiary)' : 'transparent',
                fontSize: '0.85rem'
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{cmd.name}</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{cmd.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input Box */}
      <div style={{ padding: '1rem 15% 1.5rem', backgroundColor: 'var(--bg-primary)', borderTop: '1px solid var(--border-light)' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-secondary)',
          overflow: 'visible',
          position: 'relative'
        }}>
          {/* Model Selector Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.4rem 0.75rem',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            borderTopLeftRadius: '7px',
            borderTopRightRadius: '7px',
            userSelect: 'none',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e' }}></span>
              <span>Active Model: <strong>{apiProvider.toUpperCase()}</strong> ({model.includes('/') ? model.split('/').pop() : model})</span>
            </div>

            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '0.72rem',
                  color: 'var(--accent-primary)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Change
              </button>

              {/* Same-Provider Model Selection Dropdown Popover */}
              {showModelDropdown && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: '8px',
                  width: '210px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  boxShadow: '0 -4px 18px rgba(0,0,0,0.2)',
                  padding: '0.4rem',
                  zIndex: 200,
                  maxHeight: '220px',
                  overflowY: 'auto'
                }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', padding: '0.2rem 0.4rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-light)', marginBottom: '0.3rem', letterSpacing: '0.03em' }}>
                    {apiProvider.toUpperCase()} Models
                  </div>
                  {getModelsForCurrentProvider().map(m => {
                    const active = model === m.value;
                    return (
                      <div
                        key={m.value}
                        onClick={() => {
                          setApiModel(apiProvider, m.value, getBaseUrlForProvider(apiProvider));
                          setShowModelDropdown(false);
                        }}
                        style={{
                          padding: '0.4rem 0.5rem',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.78rem',
                          backgroundColor: active ? 'var(--bg-tertiary)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: active ? 600 : 500,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseOver={(e) => { if(!active) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                        onMouseOut={(e) => { if(!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <span>{m.label}</span>
                        {active && <span style={{ color: '#22c55e', fontSize: '0.75rem', fontWeight: 'bold' }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Textarea + Button area */}
          <div style={{ display: 'flex', alignItems: 'flex-end', backgroundColor: 'transparent' }}>
            <textarea
              id="chat-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything, type / for commands"
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                padding: '0.75rem 1rem',
                color: 'var(--text-primary)',
                resize: 'none',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                minHeight: '44px',
                maxHeight: '200px'
              }}
            />
            <button
              id="chat-send-button"
              onClick={isThinking ? handleStop : handleSend}
              style={{
                margin: '0.5rem',
                padding: '0.5rem',
                background: isThinking ? '#ef4444' : 'var(--accent-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              {isThinking ? <Square size={16} fill="white" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}
