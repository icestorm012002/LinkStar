import { useState } from 'react';
import { useAppStore, type DocumentEntry } from '../../store/useAppStore';
import { Plus, MessageCircle, Eye, Code, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';

export function DocumentViewer({ doc }: { doc: DocumentEntry }) {
  const { theme } = useAppStore();
  const isMd = doc.filename.endsWith('.md') || doc.filename.includes('Plan') || doc.filename.includes('Walkthrough');
  
  // Choose default mode based on file type
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'original'>(() => {
    return isMd ? 'preview' : 'code';
  });

  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  
  // Mock store for comments: { [lineIndex]: "Comment text" }
  const [comments, setComments] = useState<Record<number, string>>({});

  const lines = doc.content.split('\n');

  const handleAddComment = (lineIndex: number) => {
    if (!commentText.trim()) {
      setCommentingLine(null);
      return;
    }
    setComments(prev => ({ ...prev, [lineIndex]: commentText }));
    setCommentText('');
    setCommentingLine(null);
  };

  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'js' || ext === 'jsx') return 'javascript';
    if (ext === 'py') return 'python';
    if (ext === 'json') return 'json';
    if (ext === 'css') return 'css';
    if (ext === 'html') return 'html';
    if (ext === 'md') return 'markdown';
    return 'plaintext';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0 }}>
      {/* Dynamic Toggle Mode Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.4rem 0.6rem',
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-light)',
        borderRadius: '6px',
        marginBottom: '0.75rem',
        flexShrink: 0
      }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {doc.filename}
        </span>
        <div style={{ display: 'flex', gap: '0.2rem' }}>
          {isMd && (
            <button
              onClick={() => setViewMode('preview')}
              style={{
                ...navButtonStyle,
                backgroundColor: viewMode === 'preview' ? 'var(--bg-primary)' : 'transparent',
                color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: viewMode === 'preview' ? 600 : 500
              }}
            >
              <Eye size={12} />
              Preview
            </button>
          )}
          <button
            onClick={() => setViewMode('code')}
            style={{
              ...navButtonStyle,
              backgroundColor: viewMode === 'code' ? 'var(--bg-primary)' : 'transparent',
              color: viewMode === 'code' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: viewMode === 'code' ? 600 : 500
            }}
          >
            <Code size={12} />
            Editor
          </button>
          <button
            onClick={() => setViewMode('original')}
            style={{
              ...navButtonStyle,
              backgroundColor: viewMode === 'original' ? 'var(--bg-primary)' : 'transparent',
              color: viewMode === 'original' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: viewMode === 'original' ? 600 : 500
            }}
          >
            <MessageSquare size={12} />
            Lines & Notes
          </button>
        </div>
      </div>

      {/* Main Render Area */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        
        {/* 1. Preview Mode */}
        {viewMode === 'preview' && (
          <div style={markdownContainerStyle}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {doc.content}
            </ReactMarkdown>
          </div>
        )}

        {/* 2. Monaco Editor Code Mode */}
        {viewMode === 'code' && (
          <div style={{
            flex: 1,
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            overflow: 'hidden',
            backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff'
          }}>
            <Editor
              height="100%"
              language={detectLanguage(doc.filename)}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={doc.content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.6,
                padding: { top: 12, bottom: 12 }
              }}
            />
          </div>
        )}

        {/* 3. Original Lines & Comments Mode */}
        {viewMode === 'original' && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', minHeight: 0 }}>
            {/* Main Document Text */}
            <div style={{ flex: 1, paddingRight: '1rem', borderRight: '1px solid var(--border-light)' }}>
              {lines.map((line, index) => (
                <div 
                  key={index}
                  onMouseEnter={() => setHoveredLine(index)}
                  onMouseLeave={() => setHoveredLine(null)}
                  style={{
                    position: 'relative',
                    padding: '0.1rem 0.4rem',
                    minHeight: '20px',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: hoveredLine === index ? 'var(--bg-tertiary)' : 'transparent',
                    transition: 'background-color 0.1s ease',
                    borderRadius: '4px'
                  }}
                >
                  <span style={{ opacity: 0.3, width: '24px', fontSize: '0.7rem', userSelect: 'none', fontFamily: 'var(--font-mono)' }}>
                    {index + 1}
                  </span>
                  <span style={{ flex: 1, fontFamily: 'var(--font-mono)' }}>{line || ' '}</span>

                  {/* Hover + Button */}
                  {hoveredLine === index && commentingLine !== index && (
                    <button 
                      onClick={() => setCommentingLine(index)}
                      style={{
                        position: 'absolute',
                        right: '-10px',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                        zIndex: 5
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  )}

                  {/* Inline Comment Input Box */}
                  {commentingLine === index && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: '0',
                      zIndex: 10,
                      width: '240px',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                    }}>
                      <textarea 
                        autoFocus
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a comment for the AI..."
                        style={{
                          width: '100%',
                          minHeight: '60px',
                          border: '1px solid var(--border-light)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          resize: 'vertical',
                          fontSize: '0.8rem',
                          outline: 'none',
                          marginBottom: '0.5rem'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => setCommentingLine(null)} style={{ padding: '0.3rem 0.6rem', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem' }}>Cancel</button>
                        <button onClick={() => handleAddComment(index)} style={{ padding: '0.3rem 0.6rem', border: 'none', background: 'var(--accent-primary)', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Add Comment</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Right Gutter for Displaying Comments */}
            <div style={{ width: '120px', paddingLeft: '0.5rem', position: 'relative' }}>
              {Object.entries(comments).map(([lineIndexStr, comment]) => {
                const lineIndex = parseInt(lineIndexStr);
                return (
                  <div 
                    key={lineIndex}
                    style={{
                      position: 'absolute',
                      top: `${lineIndex * 24}px`, // Approximate height positioning
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-tertiary)',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      borderLeft: '2px solid var(--accent-primary)',
                      width: 'calc(100% - 0.5rem)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                      zIndex: 2
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      <MessageCircle size={10} /> AI Note
                    </div>
                    {comment}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Styles ----

const navButtonStyle: React.CSSProperties = {
  padding: '0.3rem 0.6rem',
  borderRadius: '4px',
  border: 'none',
  fontSize: '0.75rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  transition: 'all 0.15s ease'
};

const markdownContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '1.25rem',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.9rem',
  lineHeight: '1.7',
  fontFamily: 'var(--font-sans)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
};
