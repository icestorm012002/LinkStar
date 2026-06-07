import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { AuthModal } from './components/AuthModal';
import { CloudSyncService } from './services/CloudSyncService';

function App() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleLoginSuccess = (newToken: string, userId: string, username: string) => {
    localStorage.setItem('claude_token', newToken);
    localStorage.setItem('claude_display_name', username);
    localStorage.setItem('claude_user_id', userId);
    setShowAuthModal(false);
    
    // Auto-reconnect websocket with new token
    setTimeout(() => {
      CloudSyncService.connect();
    }, 100);
  };

  const handleLogout = useCallback(async () => {
    const currentToken = localStorage.getItem('claude_token');
    
    // Call backend to invalidate token (best-effort)
    if (currentToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json',
          },
        });
      } catch {
        // Proceed with local cleanup even if server call fails
      }
    }

    // Disconnect WebSocket
    CloudSyncService.disconnect();

    // Clear all auth-related localStorage entries
    localStorage.removeItem('claude_token');
    localStorage.removeItem('claude_user_id');
    localStorage.removeItem('claude_display_name');

    // Reset state to show AuthModal
    setShowAuthModal(true);
  }, []);

  // Listen for logout events from child components
  useEffect(() => {
    const onLogout = () => handleLogout();
    const onRequireLogin = () => setShowAuthModal(true);
    
    window.addEventListener('claude_logout', onLogout);
    window.addEventListener('claude_require_login', onRequireLogin);
    
    return () => {
      window.removeEventListener('claude_logout', onLogout);
      window.removeEventListener('claude_require_login', onRequireLogin);
    };
  }, [handleLogout]);

  return (
    <>
      {showAuthModal && (
        <AuthModal 
          onSuccess={handleLoginSuccess} 
          onClose={() => setShowAuthModal(false)} 
        />
      )}
      <AppLayout />
    </>
  );
}

export default App;

