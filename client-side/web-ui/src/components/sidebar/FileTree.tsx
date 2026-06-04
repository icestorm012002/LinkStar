import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileCode, Folder, FileText, Image, File } from 'lucide-react';
import { CloudSyncService } from '../../services/CloudSyncService';
import { useAppStore } from '../../store/useAppStore';

interface FileNode {
  name: string;
  isDir: boolean;
  path: string;
}

export function FileTree({ basePath }: { basePath: string }) {
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let mounted = true;
    const loadRoot = async () => {
      setLoading(true);
      try {
        const res = await CloudSyncService.browseDirectory(basePath);
        if (mounted) {
          setEntries(res.entries || []);
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadRoot();
    return () => { mounted = false; };
  }, [basePath]);

  if (loading && entries.length === 0) {
    return <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Loading files...</div>;
  }

  if (error) {
    return <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--text-error, #f87171)' }}>Error: {error}</div>;
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: '0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', wordBreak: 'break-all' }}>Path: {basePath}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Empty folder</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0.2rem 0', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 0.5rem 0.4rem', fontSize: '0.7rem', color: 'var(--text-tertiary)', wordBreak: 'break-all', opacity: 0.7 }}>
        {basePath}
      </div>
      {entries.map(entry => (
        <TreeNode key={entry.path} node={entry} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  
  const setActiveDocument = useAppStore(state => state.setActiveDocument);
  const setActiveTab = useAppStore(state => state.setActiveTab);

  const paddingLeft = `${1 + depth * 1}rem`;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (node.isDir) {
      if (!expanded && children === null) {
        setLoading(true);
        try {
          const res = await CloudSyncService.browseDirectory(node.path);
          setChildren(res.entries || []);
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }
      setExpanded(!expanded);
    } else {
      // It's a file, let's open it in the right panel!
      try {
        const content = await CloudSyncService.readFile(node.path);
        
        let language = 'plaintext';
        if (node.name.endsWith('.ts') || node.name.endsWith('.tsx')) language = 'typescript';
        else if (node.name.endsWith('.js') || node.name.endsWith('.jsx')) language = 'javascript';
        else if (node.name.endsWith('.json')) language = 'json';
        else if (node.name.endsWith('.md')) language = 'markdown';
        else if (node.name.endsWith('.css')) language = 'css';
        else if (node.name.endsWith('.html')) language = 'html';
        
        setActiveDocument({
          title: node.name,
          content,
          language
        });
        setActiveTab('overview');
      } catch (err: any) {
        alert('Failed to read file: ' + err.message);
      }
    }
  };

  const getIcon = () => {
    if (node.isDir) {
      return <Folder size={14} color="var(--accent-primary)" fill={expanded ? 'var(--accent-primary)' : 'transparent'} opacity={expanded ? 0.8 : 1} />;
    }
    if (node.name.endsWith('.ts') || node.name.endsWith('.js') || node.name.endsWith('.tsx') || node.name.endsWith('.jsx')) {
      return <FileCode size={14} color="#3b82f6" />;
    }
    if (node.name.endsWith('.md') || node.name.endsWith('.txt')) {
      return <FileText size={14} color="#10b981" />;
    }
    if (node.name.endsWith('.png') || node.name.endsWith('.svg') || node.name.endsWith('.jpg')) {
      return <Image size={14} color="#8b5cf6" />;
    }
    return <File size={14} color="var(--text-tertiary)" />;
  };

  return (
    <div>
      <div 
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: `0.25rem 0.5rem 0.25rem ${paddingLeft}`,
          cursor: 'pointer',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'background-color 0.1s ease',
        }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {node.isDir ? (
          <div style={{ width: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        ) : (
          <div style={{ width: '14px' }}></div>
        )}
        {getIcon()}
        <span style={{ color: node.isDir ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{node.name}</span>
      </div>
      
      {expanded && children && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {children.map(child => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
      
      {expanded && loading && (
        <div style={{ padding: `0.25rem 0.5rem 0.25rem ${1 + (depth + 1) * 1}rem`, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Loading...
        </div>
      )}
    </div>
  );
}
