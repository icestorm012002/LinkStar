import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { FileCode, FileText } from 'lucide-react';
import { DiffEditor } from '@monaco-editor/react';
import { DocumentViewer } from './DocumentViewer';

export function ContextPanel() {
  const { activeTab, setActiveTab, documents, theme, activeDocument } = useAppStore();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  const isCode = activeDocument?.language && activeDocument.language !== 'markdown' && activeDocument.language !== 'plaintext';

  return (
    <aside style={{
      width: '450px',
      backgroundColor: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
    }}>
      {/* Tabs (Global Header) */}
      <div style={{ height: '48px', display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--header-bg)' }}>
        <TabButton 
          active={activeTab === 'overview'} 
          onClick={() => setActiveTab('overview')}
          label="Overview"
          icon={<FileText size={14} />}
        />
        <TabButton 
          active={activeTab === 'review'} 
          onClick={() => setActiveTab('review')}
          label="Review"
          icon={<FileCode size={14} />}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem' }}>
            {/* Artifacts Header & List */}
            <div>
              <div style={{ 
                fontSize: '0.75rem', 
                fontWeight: 700, 
                color: 'var(--text-tertiary)', 
                marginBottom: '0.8rem', 
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span>Artifacts & Code Notebooks</span>
                {selectedDoc && (
                  <button 
                    onClick={() => setSelectedDoc(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Show Catalog
                  </button>
                )}
              </div>

              {/* Dynamic Catalog layout */}
              {!selectedDoc ? (
                /* Grid / Detailed Card List when no doc is selected */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {documents.map(doc => {
                    const isMd = doc.filename.endsWith('.md') || doc.filename.includes('Plan') || doc.filename.includes('Walkthrough');
                    return (
                      <div 
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc.id)}
                        style={{
                          padding: '1rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.8rem',
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.1)';
                          e.currentTarget.style.borderColor = 'var(--accent-primary)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                        }}
                      >
                        <div style={{
                          padding: '0.5rem',
                          borderRadius: '6px',
                          backgroundColor: isMd ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                          color: isMd ? '#3b82f6' : '#10b981',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {isMd ? <FileText size={18} /> : <FileCode size={18} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {doc.filename}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                            {isMd ? 'Interactive Markdown Document' : 'Editable Source Code Notebook'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Compact Top Tab bar when a doc is active */
                <div style={{ 
                  display: 'flex', 
                  gap: '0.4rem', 
                  padding: '4px',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  border: '1px solid var(--border-light)'
                }}>
                  {documents.map(doc => {
                    const active = selectedDoc === doc.id;
                    const isMd = doc.filename.endsWith('.md') || doc.filename.includes('Plan') || doc.filename.includes('Walkthrough');
                    return (
                      <button
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc.id)}
                        style={{
                          padding: '0.4rem 0.8rem',
                          borderRadius: '6px',
                          border: 'none',
                          background: active ? 'var(--bg-secondary)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontSize: '0.8rem',
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.2s ease',
                          boxShadow: active ? '0 2px 4px rgba(0,0,0,0.06)' : 'none'
                        }}
                      >
                        {isMd ? <FileText size={12} style={{ color: '#3b82f6' }} /> : <FileCode size={12} style={{ color: '#10b981' }} />}
                        {doc.filename}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Document Preview (expanded to fill remaining space) */}
            {activeDocument ? (
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column',
                borderTop: '1px solid var(--border-light)',
                paddingTop: '1rem',
                minHeight: 0
              }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {isCode ? <FileCode size={16} color="#10b981" /> : <FileText size={16} color="#3b82f6" />}
                  {activeDocument.title}
                </div>
                <div style={{ flex: 1, border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                  {isCode ? (
                    <DiffEditor
                      height="100%"
                      language={activeDocument.language}
                      theme={theme === 'dark' ? 'vs-dark' : 'light'}
                      original={activeDocument.content}
                      modified={activeDocument.content}
                      options={{
                        renderSideBySide: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        readOnly: true
                      }}
                    />
                  ) : (
                    <div style={{ padding: '1rem', overflowY: 'auto', height: '100%', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                      {activeDocument.content}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedDoc && (
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                flexDirection: 'column',
                borderTop: '1px solid var(--border-light)',
                paddingTop: '1rem',
                minHeight: 0
              }}>
                <DocumentViewer doc={documents.find(d => d.id === selectedDoc)!} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'review' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Pending Changes (Monaco Diff Viewer)
            </div>
            <div style={{ flex: 1, border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
              <DiffEditor
                height="100%"
                language="typescript"
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                original={`function sayHello() {\n  console.log("Hello");\n}`}
                modified={`function sayHello() {\n  console.log("Hello LINKSTAR");\n}`}
                options={{
                  renderSideBySide: false, // Use inline diff for small sidebars, or set to true for split view
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12
                }}
              />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button style={{ flex: 1, padding: '0.5rem', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Apply Changes</button>
              <button style={{ flex: 1, padding: '0.5rem', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>Reject</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function TabButton({ active, onClick, label, icon }: { active: boolean, onClick: () => void, label: string, icon: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      style={{
        flex: 1,
        padding: '0.75rem 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
        color: active ? 'var(--header-text)' : 'rgba(255, 255, 255, 0.6)',
        fontSize: '0.85rem',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {icon}
      {label}
    </button>
  );
}
