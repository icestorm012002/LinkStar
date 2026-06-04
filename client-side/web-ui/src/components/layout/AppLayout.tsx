import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Sidebar } from '../sidebar/Sidebar';
import { ChatArea } from '../chat/ChatArea';
import { ContextPanel } from '../context/ContextPanel';
import { MediaWorkspace } from '../media/MediaWorkspace';

export function AppLayout() {
  const theme = useAppStore((state) => state.theme);
  const activeModule = useAppStore((state) => state.activeModule);

  useEffect(() => {
    // Map our semantic themes to the data-theme attribute
    // If 'yellow', we just remove the attribute to use the default root vars
    if (theme === 'yellow') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  return (
    <div className="layout-container" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* 1. Left Sidebar */}
      <Sidebar />
      
      {/* Main Content Area Routing */}
      {activeModule === 'media' ? (
        <MediaWorkspace />
      ) : (
        <>
          {/* 2. Middle Chat Area */}
          <ChatArea />
    
          {/* 3. Right Context Panel */}
          <ContextPanel />
        </>
      )}
    </div>
  );
}
