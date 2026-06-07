import { useState } from 'react';
import { Settings, Folder, MessageSquare, TerminalSquare, Clock, Plus, Trash2, Film } from 'lucide-react';
import { useAppStore, type Theme } from '../../store/useAppStore';
import { SettingsPanel } from './SettingsPanel';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { FileTree } from './FileTree';

export function Sidebar() {
  const { projects, activeProjectId, setActiveProject, theme, setTheme, addProject, deleteProject, activeModule, setActiveModule } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  
  // Local project creation state
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [showServerBrowserDialog, setShowServerBrowserDialog] = useState(false);
  const [customProjName, setCustomProjName] = useState('');
  const [customProjPath, setCustomProjPath] = useState('');

  const handleOpenFolder = () => {
    setShowServerBrowserDialog(true);
  };

  const themes: { id: Theme, label: string }[] = [
    { id: 'yellow', label: 'Old Paper' },
    { id: 'dark', label: 'Dark Mode' },
    { id: 'light', label: 'Light Mode' },
  ];

  return (
    <>
      <aside style={{
        width: '260px',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0'
      }}>
        {/* Brand */}
        <div style={{
          height: '48px',
          padding: '0 1rem',
          marginBottom: '1rem',
          fontWeight: 600,
          fontSize: '1rem',
          backgroundColor: 'var(--header-bg)',
          color: 'var(--header-text)',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          letterSpacing: '0.02em'
        }}>
          LinkStar
        </div>

        {/* Main Nav */}
        <nav style={{ padding: '0 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <div onClick={() => setActiveModule('chat')}>
            <NavItem icon={<MessageSquare size={16} />} label="New Conversation" active={activeModule === 'chat'} />
          </div>
          <NavItem icon={<Clock size={16} />} label="Conversation History" />
          <NavItem icon={<TerminalSquare size={16} />} label="Scheduled Tasks" />
          <div onClick={() => setActiveModule('media')}>
            <NavItem icon={<Film size={16} />} label="Media Studio" active={activeModule === 'media'} />
          </div>
        </nav>

        {/* Projects Section */}
        <div style={{ 
          padding: '1.5rem 1rem 0.5rem', 
          fontSize: '0.75rem', 
          fontWeight: 600, 
          color: 'var(--text-tertiary)', 
          textTransform: 'uppercase', 
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>Projects</span>
          <button
            onClick={handleOpenFolder}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-light)',
              borderRadius: '4px',
              color: 'var(--accent-primary)',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Plus size={10} />
            Open
          </button>
        </div>
        
        <div style={{ padding: '0 0.5rem', flex: 1, overflowY: 'auto' }}>
          {projects.map(p => (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                onClick={() => setActiveProject(p.id)}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  backgroundColor: activeProjectId === p.id ? 'var(--bg-tertiary)' : 'transparent',
                  color: activeProjectId === p.id ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                <Folder size={14} />
                <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete project "${p.name}"?`)) {
                      deleteProject(p.id);
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '4px',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.color = '#ef4444'}
                  onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              
              {/* If this is the active project, show the File Tree below it */}
              {activeProjectId === p.id && (
                <div style={{ paddingLeft: '0.5rem', borderLeft: '1px solid var(--border-light)', marginLeft: '1rem', marginTop: '0.2rem', marginBottom: '0.5rem' }}>
                  <FileTree basePath={p.path} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Theme & Settings */}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>THEME</div>
          <div style={{ display: 'flex', gap: '0.4rem', flexDirection: 'column', marginBottom: '0.75rem' }}>
            {themes.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                style={{
                  textAlign: 'left',
                  background: theme === t.id ? 'var(--accent-primary)' : 'transparent',
                  color: theme === t.id ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.5rem',
              background: 'transparent',
              border: '1px solid var(--border-light)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              marginBottom: '1rem'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Settings size={16} />
            Settings
          </button>

          {/* User Profile Bar */}
          {localStorage.getItem('claude_token') ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem',
              borderRadius: '6px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-light)',
            }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                backgroundColor: 'var(--accent-primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 600, fontSize: '0.8rem', flexShrink: 0
              }}>
                {(localStorage.getItem('claude_display_name') || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{
                  fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {localStorage.getItem('claude_display_name') || 'Unknown'}
                </div>
              </div>
              <button
                onClick={() => window.dispatchEvent(new Event('claude_logout'))}
                title="Sign Out"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: '2px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', borderRadius: '4px'
                }}
                onMouseOver={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => window.dispatchEvent(new Event('claude_require_login'))}
              style={{
                width: '100%',
                padding: '0.6rem',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                transition: 'all 0.2s'
              }}
            >
              Sign In to Chat
            </button>
          )}
        </div>
      </aside>

      {/* Settings Modal */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Manual Local Directory Modal Dialog (Fallback) */}
      {showFolderDialog && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            width: '400px',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600 }}>Open Local Directory</h3>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Input the path and name of your local folder to mount it as a workspace project.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Project Name</label>
              <input 
                type="text" 
                value={customProjName}
                onChange={(e) => setCustomProjName(e.target.value)}
                placeholder="e.g. My Unreal Project"
                style={dialogInputStyle}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Local Directory Path</label>
              <input 
                type="text" 
                value={customProjPath}
                onChange={(e) => setCustomProjPath(e.target.value)}
                placeholder="e.g. E:/Unreal/A1workhouse"
                style={dialogInputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button 
                onClick={() => {
                  setShowFolderDialog(false);
                  setCustomProjName('');
                  setCustomProjPath('');
                }} 
                style={{
                  padding: '0.4rem 0.8rem',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (!customProjName.trim() || !customProjPath.trim()) {
                    alert('Please fill out both Name and Path');
                    return;
                  }
                  addProject(customProjName.trim(), customProjPath.trim());
                  setShowFolderDialog(false);
                  setCustomProjName('');
                  setCustomProjPath('');
                }}
                style={{
                  padding: '0.4rem 0.8rem',
                  border: 'none',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 500
                }}
              >
                Open Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {showServerBrowserDialog && (
        <FolderBrowserDialog 
          onClose={() => setShowServerBrowserDialog(false)}
          onSelect={(path, name) => {
            addProject(name, path);
            setShowServerBrowserDialog(false);
          }}
        />
      )}
    </>
  );
}

function NavItem({ icon, label, active }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.5rem 0.6rem',
      fontSize: '0.85rem',
      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      backgroundColor: active ? 'var(--bg-tertiary)' : 'transparent',
      cursor: 'pointer',
      borderRadius: '6px'
    }}
    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{icon}</span>
      {label}
    </div>
  );
}

const dialogInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-sans)',
};
