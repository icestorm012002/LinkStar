import React, { useState, useEffect } from 'react';
import { CloudSyncService } from '../../services/CloudSyncService';
import { Folder, File, ChevronRight, CornerRightUp, HardDrive, Home, Image, Download, FileText } from 'lucide-react';

interface FolderBrowserDialogProps {
  onClose: () => void;
  onSelect: (path: string, name: string) => void;
}

export function FolderBrowserDialog({ onClose, onSelect }: FolderBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<{ name: string; isDir: boolean; path: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [systemPaths, setSystemPaths] = useState<{ paths: Record<string, string>; drives: string[] } | null>(null);

  useEffect(() => {
    // start with base directory
    const startPath = localStorage.getItem('linkstar_workspace_base_dir') || 'E:\\';
    loadDirectory(startPath);
    
    CloudSyncService.getSystemPaths().then(res => {
      setSystemPaths(res);
    }).catch(err => console.error("Failed to fetch system paths:", err));
  }, []);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await CloudSyncService.browseDirectory(path);
      setCurrentPath(result.path);
      setEntries(result.entries);
    } catch (err: any) {
      setError(err.message || 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  const handleUp = () => {
    // naive parent directory calculation
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    if (parts.length <= 1) {
      // maybe at root like E:
      if (currentPath.match(/^[A-Za-z]:[\\/]?$/)) {
        return; // already root
      }
      loadDirectory('/'); // unix root
      return;
    }
    
    // windows drive letter special case
    if (parts.length === 1 && parts[0].match(/^[A-Za-z]:$/)) {
      loadDirectory(parts[0] + '\\');
      return;
    }

    parts.pop();
    let parentPath = parts.join(separator);
    if (separator === '\\' && !parentPath.includes('\\')) {
        parentPath += '\\';
    } else if (separator === '/') {
        parentPath = '/' + parentPath;
    }
    loadDirectory(parentPath);
  };

  return (
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
        width: '700px',
        height: '60vh',
        backgroundColor: 'var(--bg-primary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600 }}>Select Workspace Folder</h3>
        </div>

        {/* Path Bar */}
        <div style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={handleUp} style={iconBtnStyle} title="Go up one level">
            <CornerRightUp size={16} />
          </button>
          
          {systemPaths?.drives && systemPaths.drives.length > 0 && (
            <select
              value={systemPaths.drives.find(d => currentPath.toUpperCase().startsWith(d.toUpperCase())) || ''}
              onChange={(e) => {
                const selectedDrive = e.target.value;
                if (selectedDrive) {
                  loadDirectory(selectedDrive);
                }
              }}
              style={{
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '80px',
                height: '30px'
              }}
            >
              <option value="" disabled>盘符...</option>
              {systemPaths.drives.map(drive => (
                <option key={drive} value={drive}>{drive}</option>
              ))}
            </select>
          )}

          <input 
            type="text" 
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
            style={{
              flex: 1,
              padding: '0.4rem 0.6rem',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              height: '30px',
              boxSizing: 'border-box'
            }}
          />
          <button onClick={() => loadDirectory(currentPath)} style={{ ...smallBtnStyle, height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Go</button>
        </div>

        {/* Main Content Area */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* Quick Access Sidebar */}
          <div style={{ 
            width: '180px', 
            borderRight: '1px solid var(--border-color)', 
            backgroundColor: 'var(--bg-secondary)', 
            overflowY: 'auto',
            padding: '0.5rem 0'
          }}>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quick Access</div>
            {systemPaths?.paths && (
              <>
                <QuickAccessItem icon={<Home size={14} />} label="Home" onClick={() => loadDirectory(systemPaths.paths.home)} />
                <QuickAccessItem icon={<FileText size={14} />} label="Documents" onClick={() => loadDirectory(systemPaths.paths.documents)} />
                <QuickAccessItem icon={<Download size={14} />} label="Downloads" onClick={() => loadDirectory(systemPaths.paths.downloads)} />
                <QuickAccessItem icon={<Image size={14} />} label="Pictures" onClick={() => loadDirectory(systemPaths.paths.pictures)} />
                <QuickAccessItem icon={<Folder size={14} />} label="Desktop" onClick={() => loadDirectory(systemPaths.paths.desktop)} />
              </>
            )}
            
            <div style={{ padding: '1rem 1rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Drives</div>
            {systemPaths?.drives.map(drive => (
              <QuickAccessItem key={drive} icon={<HardDrive size={14} />} label={drive} onClick={() => loadDirectory(drive)} />
            ))}
          </div>

          {/* File List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', backgroundColor: 'var(--bg-primary)' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading...</div>
            ) : error ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>{error}</div>
            ) : entries.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Empty folder</div>
            ) : (
              entries.map((entry, idx) => (
                <div 
                  key={idx}
                  onClick={() => entry.isDir && loadDirectory(entry.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    cursor: entry.isDir ? 'pointer' : 'default',
                    borderRadius: '4px',
                    color: entry.isDir ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    opacity: entry.isDir ? 1 : 0.6
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  {entry.isDir ? <Folder size={16} color="var(--accent-primary)" /> : <File size={16} />}
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>{entry.name}</span>
                  {entry.isDir && <ChevronRight size={14} color="var(--text-tertiary)" />}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', backgroundColor: 'var(--bg-secondary)' }}>
          <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          <button 
            onClick={() => {
              const name = currentPath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
              onSelect(currentPath, name);
            }} 
            style={primaryBtnStyle}
            disabled={loading || !!error}
          >
            Select Current Folder
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '0.4rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const smallBtnStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  padding: '0.4rem 0.8rem',
  fontSize: '0.85rem'
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-secondary)',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.85rem'
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: 'none',
  background: 'var(--accent-primary)',
  color: 'white',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 500
};

function QuickAccessItem({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 1rem',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontSize: '0.85rem',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-primary)', opacity: 0.8 }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  );
}
