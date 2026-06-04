import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { CloudSyncService } from '../../services/CloudSyncService';
import { X, Key, Server, User, Monitor, Shield, Zap, Eye, EyeOff } from 'lucide-react';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { setApiModel } = useAppStore();

  // Settings state (will be persisted to localStorage)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('linkstar_api_key') || '');
  const [apiProvider, setApiProvider] = useState<'anthropic' | 'bedrock' | 'vertex' | 'gemini' | 'codex' | 'deepseek' | 'openai'>(
    () => (localStorage.getItem('linkstar_api_provider') as any) || 'anthropic'
  );
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('linkstar_base_url') || '');
  const [wsHost, setWsHost] = useState(() => localStorage.getItem('linkstar_ws_host') || 'localhost');
  const [wsPort, setWsPort] = useState(() => localStorage.getItem('linkstar_ws_port') || '9800');
  const [displayName] = useState(() => localStorage.getItem('linkstar_display_name') || '');
  const [model, setModel] = useState(() => localStorage.getItem('linkstar_model') || 'claude-sonnet-4-20250514');
  const [activeSection, setActiveSection] = useState<'api' | 'server' | 'user' | 'security'>('api');
  const [safetyLevel, setSafetyLevel] = useState<'full' | 'ask' | 'sandbox'>(
    () => (localStorage.getItem('linkstar_safety_level') as any) || 'full'
  );
  const [pathWhitelist, setPathWhitelist] = useState<string>(
    () => localStorage.getItem('linkstar_path_whitelist') || ''
  );
  const [workspaceBaseDir, setWorkspaceBaseDir] = useState<string>(
    () => localStorage.getItem('linkstar_workspace_base_dir') || 'E:\\clawd-home'
  );
  const [saved, setSaved] = useState(false);
  const [connectionState, setConnectionState] = useState(() => CloudSyncService.state);
  
  // Real-time API Probing Test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { success: boolean; status: number; message: string }>(null);

  useEffect(() => {
    const unsub = CloudSyncService.subscribe((msg: any) => {
      if (msg.type === 'auth_ok') {
        setConnectionState('connected');
      }
      
      // Listen for actual remote endpoint connection handshake results
      if (msg.type === 'test_connection_result') {
        setTesting(false);
        setTestResult({
          success: msg.success,
          status: msg.status,
          message: msg.message
        });
      }
    });

    const timer = setInterval(() => {
      setConnectionState(CloudSyncService.state);
    }, 200);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  // Clear test results on input change to ensure accurate visual state
  // Use a ref to track whether the component has received its first result,
  // and clear inline in onChange handlers instead of via useEffect (which fires on mount/StrictMode)
  const clearTestResult = () => {
    if (testResult !== null) setTestResult(null);
  };

  const handleSave = () => {
    localStorage.setItem('linkstar_api_key', apiKey);
    localStorage.setItem('linkstar_ws_host', wsHost);
    localStorage.setItem('linkstar_ws_port', wsPort);
    localStorage.setItem('linkstar_display_name', displayName);
    localStorage.setItem('linkstar_safety_level', safetyLevel);
    localStorage.setItem('linkstar_sandbox_enabled', String(safetyLevel === 'sandbox'));
    localStorage.setItem('linkstar_path_whitelist', pathWhitelist);
    localStorage.setItem('linkstar_workspace_base_dir', workspaceBaseDir);

    // Sync to global Zustand store (which internally sets localStorage for provider/model/baseUrl too)
    setApiModel(apiProvider, model, baseUrl);

    // Reconnect WebSocket with new settings
    CloudSyncService.disconnect();
    
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const PROVIDER_DEFAULTS = {
    anthropic: {
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com'
    },
    gemini: {
      model: 'google-gemini/gemini-3-flash-preview',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
    },
    codex: {
      model: 'openai-codex/gpt-5.5',
      baseUrl: ''
    },
    deepseek: {
      model: 'deepseek/deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com'
    },
    openai: {
      model: 'openai/gpt-4o',
      baseUrl: 'https://api.openai.com/v1'
    },
    bedrock: {
      model: 'claude-sonnet-4-20250514',
      baseUrl: ''
    },
    vertex: {
      model: 'claude-sonnet-4-20250514',
      baseUrl: ''
    }
  };

  const handleConnect = () => {
    if (!apiKey.trim()) {
      alert('Please enter your API Key first');
      return;
    }

    // Save first
    handleSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    // Disconnect and reconnect (CloudSyncService.connect will automatically read the updated settings and authenticate safely)
    CloudSyncService.disconnect();
    CloudSyncService.connect();
  };

  const handleTestConnection = () => {
    if (!apiKey.trim()) {
      alert('Please enter your API Key/Token first');
      return;
    }
    if (connectionState !== 'connected') {
      alert('WebSocket is not connected to the backend. Please connect first.');
      return;
    }

    setTesting(true);
    setTestResult(null);

    // Send testing command to backend gateway
    CloudSyncService.send({
      type: 'test_api_connection',
      provider: apiProvider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model
    });
  };

  const sections = [
    { id: 'api' as const, label: 'API Settings', icon: <Key size={16} /> },
    { id: 'server' as const, label: 'Server', icon: <Server size={16} /> },
    { id: 'user' as const, label: 'Profile', icon: <User size={16} /> },
    { id: 'security' as const, label: 'Permissions', icon: <Shield size={16} /> },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        width: '640px',
        maxHeight: '80vh',
        backgroundColor: 'var(--bg-primary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--header-bg)',
          color: 'var(--header-text)'
        }}>
          <span style={{ fontWeight: 600, fontSize: '1rem' }}>Settings</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--header-text)',
            cursor: 'pointer', padding: '4px', borderRadius: '4px'
          }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left nav */}
          <div style={{
            width: '160px',
            borderRight: '1px solid var(--border-light)',
            padding: '0.5rem',
            backgroundColor: 'var(--bg-secondary)'
          }}>
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeSection === s.id ? 'var(--bg-tertiary)' : 'transparent',
                  color: activeSection === s.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  marginBottom: '0.2rem'
                }}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
            {activeSection === 'api' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <SettingGroup label="API Provider">
                  <select
                    value={apiProvider}
                    onChange={(e) => {
                      clearTestResult();
                      const val = e.target.value as any;
                      setApiProvider(val);
                      // Set default model and base URL for selected provider
                      const defaults = PROVIDER_DEFAULTS[val as keyof typeof PROVIDER_DEFAULTS];
                      if (defaults) {
                        setModel(defaults.model);
                        setBaseUrl(defaults.baseUrl);
                      }
                    }}
                    style={selectStyle}
                  >
                    <option value="anthropic">Direct API</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="codex">OpenAI Codex</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="bedrock">AWS Bedrock</option>
                    <option value="vertex">Google Vertex AI</option>
                  </select>
                </SettingGroup>

                <SettingGroup 
                  label={apiProvider === 'codex' ? 'Session Token' : 'API Key'} 
                  hint={
                    apiProvider === 'anthropic' ? 'Your API key (sk-ant-...)' :
                    apiProvider === 'gemini' ? 'Your Gemini API key (AIzaSy...)' :
                    apiProvider === 'codex' ? 'Your OpenAI Codex Session Token' :
                    apiProvider === 'deepseek' ? 'Your DeepSeek API key' :
                    'Cloud platform credentials'
                  }
                >
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { clearTestResult(); setApiKey(e.target.value); }}
                    placeholder={
                      apiProvider === 'anthropic' ? 'sk-ant-api03-...' :
                      apiProvider === 'gemini' ? 'AIzaSy...' :
                      apiProvider === 'codex' ? 'Codex Session Token' :
                      apiProvider === 'deepseek' ? 'sk-...' :
                      'Enter credentials'
                    }
                    style={inputStyle}
                  />
                </SettingGroup>

                <SettingGroup label="Base URL (Optional)" hint="Custom API endpoint, leave empty for default">
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => { clearTestResult(); setBaseUrl(e.target.value); }}
                    placeholder={
                      apiProvider === 'anthropic' ? 'https://api.anthropic.com' :
                      apiProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai' :
                      apiProvider === 'deepseek' ? 'https://api.deepseek.com' :
                      'https://...'
                    }
                    style={inputStyle}
                  />
                </SettingGroup>

                <SettingGroup label="Model">
                  <select
                    value={model}
                    onChange={(e) => { clearTestResult(); setModel(e.target.value); }}
                    style={selectStyle}
                  >
                    {apiProvider === 'anthropic' && (
                      <>
                        <option value="claude-sonnet-4-20250514">Sonnet 4</option>
                        <option value="claude-opus-4-20250514">Opus 4</option>
                        <option value="claude-3-5-sonnet-20241022">Sonnet 3.5</option>
                        <option value="claude-3-5-haiku-20241022">Haiku 3.5</option>
                      </>
                    )}
                    {apiProvider === 'gemini' && (
                      <>
                        <option value="google-gemini/gemini-3-flash-preview">Gemini 3 Flash</option>
                        <option value="google-gemini/gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                        <option value="google-gemini/gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite</option>
                        <option value="google-gemini/gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="google-gemini/gemini-2.5-flash">Gemini 2.5 Flash</option>
                      </>
                    )}
                    {apiProvider === 'codex' && (
                      <option value="openai-codex/gpt-5.5">GPT 5.5 (Codex)</option>
                    )}
                    {apiProvider === 'deepseek' && (
                      <>
                        <option value="deepseek/deepseek-v4-pro">DeepSeek-V4-Pro</option>
                        <option value="deepseek/deepseek-v4-flash">DeepSeek-V4-Flash</option>
                        <option value="deepseek/deepseek-chat">DeepSeek Chat (V3)</option>
                        <option value="deepseek/deepseek-reasoner">DeepSeek Reasoner (R1)</option>
                      </>
                    )}
                    {apiProvider === 'openai' && (
                      <>
                        <option value="openai/gpt-4o">GPT-4o</option>
                        <option value="openai/gpt-4o-mini">GPT-4o-mini</option>
                        <option value="openai/o1-preview">o1-preview</option>
                        <option value="openai/o1-mini">o1-mini</option>
                      </>
                    )}
                    {(apiProvider === 'bedrock' || apiProvider === 'vertex') && (
                      <>
                        <option value="claude-sonnet-4-20250514">Sonnet 4</option>
                        <option value="claude-opus-4-20250514">Opus 4</option>
                        <option value="claude-3-5-sonnet-20241022">Sonnet 3.5</option>
                      </>
                    )}
                  </select>
                </SettingGroup>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                  <style>{`
                    @keyframes spin {
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                  
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={handleConnect} style={{
                      padding: '0.6rem 1rem',
                      background: saved ? '#22c55e' : 'var(--accent-primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 500,
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      transition: 'all 0.3s ease',
                      flex: 1
                    }}>
                      <Shield size={16} />
                      {saved ? '✓ Saved & Connecting...' : 'Save & Connect'}
                    </button>

                    <button
                      onClick={handleTestConnection}
                      disabled={testing || connectionState !== 'connected'}
                      style={{
                        padding: '0.6rem 1rem',
                        background: testing ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                        color: connectionState === 'connected' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        cursor: connectionState === 'connected' ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.3s ease',
                        flex: 1
                      }}
                    >
                      {testing ? (
                        <>
                          <span style={{
                            width: '12px',
                            height: '12px',
                            border: '2px solid var(--text-secondary)',
                            borderTop: '2px solid transparent',
                            borderRadius: '50%',
                            display: 'inline-block',
                            animation: 'spin 1s linear infinite'
                          }}></span>
                          <span>Testing API...</span>
                        </>
                      ) : (
                        <>
                          <Zap size={16} style={{ color: connectionState === 'connected' ? '#f59e0b' : 'inherit' }} />
                          <span>Test Connection</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Gateway Status Box */}
                  <div style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    userSelect: 'none'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span style={{ 
                        display: 'inline-block', 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        backgroundColor: connectionState === 'connected' ? '#22c55e' : connectionState === 'connecting' ? '#f59e0b' : '#ef4444',
                        boxShadow: connectionState === 'connected' ? '0 0 8px #22c55e' : 'none',
                        transition: 'all 0.3s ease'
                      }}></span>
                      <span>
                        {connectionState === 'connected' ? 'Gateway Connected' : connectionState === 'connecting' ? 'Connecting...' : 'Backend Disconnected'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                      Port {wsPort}
                    </span>
                  </div>

                  {/* Real-time Probing Result Box */}
                  {testResult && (
                    <div style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '6px',
                      border: `1px solid ${testResult.success ? '#22c55e' : '#ef4444'}`,
                      background: testResult.success ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: testResult.success ? '#22c55e' : '#ef4444' }}>
                        <span>{testResult.success ? '🟢 API Connected' : '🔴 Connection Failed'}</span>
                        <span style={{ fontSize: '0.75rem', padding: '1px 6px', borderRadius: '4px', background: testResult.success ? '#22c55e' : '#ef4444', color: '#fff' }}>
                          {testResult.status}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                        {testResult.message}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === 'server' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <SettingGroup label="WebSocket Host" hint="Backend server address">
                  <input
                    type="text"
                    value={wsHost}
                    onChange={(e) => setWsHost(e.target.value)}
                    placeholder="localhost"
                    style={inputStyle}
                  />
                </SettingGroup>

                <SettingGroup label="WebSocket Port">
                  <input
                    type="text"
                    value={wsPort}
                    onChange={(e) => setWsPort(e.target.value)}
                    placeholder="9800"
                    style={inputStyle}
                  />
                </SettingGroup>

                <SettingGroup label="Workspace Base Directory" hint="Absolute directory containing your local projects (e.g. E:\clawd-home)">
                  <input
                    type="text"
                    value={workspaceBaseDir}
                    onChange={(e) => setWorkspaceBaseDir(e.target.value)}
                    placeholder="E:\clawd-home"
                    style={inputStyle}
                  />
                </SettingGroup>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                  <Monitor size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  Detected OS: <strong>{detectClientOS()}</strong>
                </div>
              </div>
            )}

            {activeSection === 'user' && (
              <ProfileSection />
            )}

            {activeSection === 'security' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <SettingGroup 
                  label="Terminal Safety Level" 
                  hint="Determine terminal execution safety when AI executes code (e.g. npm, git, rm, cargo)"
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.4rem' }}>
                    {[
                      { 
                        value: 'full', 
                        title: 'Full Mode (免审模式)', 
                        desc: '允许文件读写、常规包安装及环境测试一通到底，无繁琐弹窗阻碍，高危破坏性系统操作仍由底层静默拦截。' 
                      },
                      { 
                        value: 'ask', 
                        title: 'Ask Mode (交互审计)', 
                        desc: 'AI 读写文件直接通过，但执行任何可能有副作用的终端命令（如 npm install 等）时必须经过你弹窗批准。' 
                      },
                      { 
                        value: 'sandbox', 
                        title: 'Sandbox Mode (沙箱隔离)', 
                        desc: '物理上将 AI 绝对限制在当前项目根目录内，禁止任何越出该目录的文件修改或越权命令，安全系数最高。' 
                      }
                    ].map(opt => (
                      <label 
                        key={opt.value} 
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          padding: '0.75rem 1rem',
                          borderRadius: '8px',
                          border: `1px solid ${safetyLevel === opt.value ? 'var(--accent-primary, #6366f1)' : 'var(--border-color)'}`,
                          backgroundColor: safetyLevel === opt.value ? 'rgba(99, 102, 241, 0.04)' : 'var(--bg-secondary)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          userSelect: 'none'
                        }}
                      >
                        <input
                          type="radio"
                          name="safetyLevel"
                          value={opt.value}
                          checked={safetyLevel === opt.value}
                          onChange={() => setSafetyLevel(opt.value as any)}
                          style={{ marginTop: '0.2rem', cursor: 'pointer' }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: safetyLevel === opt.value ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                            {opt.title}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                            {opt.desc}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </SettingGroup>

                <SettingGroup 
                  label="Allowed Paths Whitelist" 
                  hint="Allow AI to tunnel access to these specific folders outside the sandbox (separated by commas or semicolons)"
                >
                  <textarea
                    value={pathWhitelist}
                    onChange={(e) => setPathWhitelist(e.target.value)}
                    placeholder="Example: E:\Assets, D:\CommonLibrary"
                    style={{
                      ...inputStyle,
                      minHeight: '80px',
                      resize: 'vertical',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-mono)'
                    } as any}
                  />
                </SettingGroup>
              </div>
            )}

            {/* Save button for Server and User sections */}
            {activeSection !== 'api' && (
              <button onClick={handleSave} style={{
                marginTop: '1.5rem',
                padding: '0.5rem 1rem',
                background: saved ? '#22c55e' : 'var(--accent-primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '0.85rem',
                transition: 'background 0.3s ease'
              }}>
                {saved ? '✓ Saved' : 'Save Settings'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Profile Section Component ----

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

function ProfileSection() {
  const [profile, setProfile] = useState<{
    user_id: string; username: string; email: string;
    avatar: string; display_name: string; created_at: string;
  } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Password change
  const [showPwChange, setShowPwChange] = useState(false);
  const [showPws, setShowPws] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  // Fetch profile on mount
  useEffect(() => {
    const token = localStorage.getItem('linkstar_token');
    if (!token) return;
    fetch('/api/auth/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setProfile(data.user);
          setDisplayName(data.user.display_name || data.user.username || '');
          setEmail(data.user.email || '');
          setAvatarColor(data.user.avatar || AVATAR_COLORS[0]);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = async () => {
    const token = localStorage.getItem('linkstar_token');
    if (!token) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, avatar: avatarColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setProfile(data.user);
      localStorage.setItem('linkstar_display_name', displayName);
      setSaveMsg('✓ Profile saved');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err: any) {
      setSaveMsg('✕ ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match'); return; }
    if (newPw.length < 4) { setPwMsg('Password must be at least 4 characters'); return; }
    const token = localStorage.getItem('linkstar_token');
    if (!token) return;
    setPwSaving(true);
    setPwMsg('');
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Change failed');
      setPwMsg('✓ Password changed');
      setOldPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => { setPwMsg(''); setShowPwChange(false); }, 2000);
    } catch (err: any) {
      setPwMsg('✕ ' + err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const handleLogout = () => {
    window.dispatchEvent(new Event('linkstar_logout'));
  };

  const initial = (profile?.display_name || profile?.username || '?')[0].toUpperCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          backgroundColor: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.75rem', fontWeight: 700, color: '#fff',
          boxShadow: `0 4px 16px ${avatarColor}44`, transition: 'all 0.3s ease',
        }}>
          {initial}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {AVATAR_COLORS.map(c => (
            <button key={c} onClick={() => setAvatarColor(c)} style={{
              width: '20px', height: '20px', borderRadius: '50%', border: avatarColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
              backgroundColor: c, cursor: 'pointer', padding: 0, transition: 'transform 0.15s',
              transform: avatarColor === c ? 'scale(1.2)' : 'scale(1)',
            }} />
          ))}
        </div>
      </div>

      {/* User Info (read-only) */}
      <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Username</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{profile?.username || '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>User ID</span>
          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{profile?.user_id ? profile.user_id.slice(0, 8) + '...' : '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Joined</span>
          <span style={{ color: 'var(--text-secondary)' }}>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</span>
        </div>
      </div>

      {/* Editable fields */}
      <SettingGroup label="Display Name" hint="Name shown in conversations">
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" style={inputStyle} />
      </SettingGroup>

      <SettingGroup label="Email" hint="Contact email address">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
      </SettingGroup>

      {/* Save Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button onClick={handleSaveProfile} disabled={saving} style={{
          padding: '0.5rem 1.25rem', border: 'none', borderRadius: '6px',
          background: saveMsg.startsWith('✓') ? '#22c55e' : 'var(--accent-primary)',
          color: '#fff', fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.3s',
        }}>
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
        {saveMsg && <span style={{ fontSize: '0.8rem', color: saveMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{saveMsg}</span>}
      </div>

      {/* Password Change (collapsible) */}
      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1rem' }}>
        <button onClick={() => setShowPwChange(!showPwChange)} style={{
          background: 'transparent', border: 'none', color: 'var(--text-secondary)',
          cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span style={{ transform: showPwChange ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
          Change Password
        </button>
        {showPwChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem', paddingLeft: '1rem' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input type={showPws ? 'text' : 'password'} value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="Current password" style={{...inputStyle, paddingRight: '36px', width: '100%'}} />
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input type={showPws ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" style={{...inputStyle, paddingRight: '36px', width: '100%'}} />
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input type={showPws ? 'text' : 'password'} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Confirm new password" style={{...inputStyle, paddingRight: '36px', width: '100%'}} />
              <button
                type="button"
                onClick={() => setShowPws(!showPws)}
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: '4px', display: 'flex'
                }}
                title="Toggle password visibility for all fields"
              >
                {showPws ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button onClick={handleChangePassword} disabled={pwSaving} style={{
                padding: '0.4rem 1rem', border: 'none', borderRadius: '6px',
                background: pwMsg.startsWith('✓') ? '#22c55e' : 'var(--accent-primary)',
                color: '#fff', fontWeight: 500, fontSize: '0.8rem', cursor: 'pointer',
              }}>
                {pwSaving ? 'Changing...' : 'Update Password'}
              </button>
              {pwMsg && <span style={{ fontSize: '0.78rem', color: pwMsg.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{pwMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Logout (danger zone) */}
      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Danger Zone
        </div>
        <button onClick={handleLogout} style={{
          padding: '0.5rem 1.25rem', border: '1px solid #ef4444', borderRadius: '6px',
          background: 'transparent', color: '#ef4444', fontWeight: 500, fontSize: '0.85rem',
          cursor: 'pointer', transition: 'all 0.2s',
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#fff'; }}
        onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ef4444'; }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

// ---- Helper components ----

function SettingGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
        {label}
      </label>
      {hint && <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>{hint}</div>}
      {children}
    </div>
  );
}

function detectClientOS(): 'win32' | 'darwin' | 'linux' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win32';
  if (ua.includes('mac')) return 'darwin';
  return 'linux';
}

// ---- Shared styles ----

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-mono)',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
};
