import React, { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';

interface AuthModalProps {
  onSuccess: (token: string, userId: string, username: string) => void;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailCode, setEmailCode] = useState('1234');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = isLogin 
        ? { username, password } 
        : { username, password, emailCode };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // If registration, switch to login or auto-login
      if (!isLogin) {
        setIsLogin(true);
        setError('Registration successful! Please log in.');
        setLoading(false);
        setPassword('');
        return;
      }

      // Login success
      onSuccess(data.token, data.user.user_id, data.user.username);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              transition: 'background 0.2s, color 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <X size={20} />
          </button>
        )}
        <div style={styles.header}>
          <h2 style={{ margin: 0 }}>LinkStar OS</h2>
          <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary)' }}>
            Welcome back, Developer.
          </p>
        </div>

        <div style={styles.tabs}>
          <button
            style={isLogin ? styles.activeTab : styles.tab}
            onClick={() => { setIsLogin(true); setError(''); }}
            type="button"
          >
            Login
          </button>
          <button
            style={!isLogin ? styles.activeTab : styles.tab}
            onClick={() => { setIsLogin(false); setError(''); }}
            type="button"
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Username</label>
            <input
              style={styles.input}
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Neo"
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                style={{ ...styles.input, paddingRight: '40px', width: '100%' }}
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {!isLogin && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Code</label>
              <input
                style={styles.input}
                type="text"
                required
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder="1234"
              />
            </div>
          )}

          {error && (
            <div style={{
              color: error.includes('successful') ? 'var(--diff-add-text)' : 'var(--diff-del-text)',
              fontSize: '0.85rem',
              marginBottom: '10px'
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Processing...' : isLogin ? 'Access System' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    position: 'relative',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-light)',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '30px 30px 20px',
    textAlign: 'center',
    borderBottom: '1px solid var(--border-light)',
    background: 'var(--bg-secondary)'
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border-light)',
  },
  tab: {
    flex: 1,
    padding: '15px 0',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.95rem',
    transition: 'all 0.2s'
  },
  activeTab: {
    flex: 1,
    padding: '15px 0',
    background: 'var(--bg-primary)',
    border: 'none',
    borderBottom: '2px solid var(--accent-color)',
    color: 'var(--accent-color)',
    cursor: 'default',
    fontWeight: 600,
    fontSize: '0.95rem',
  },
  form: {
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  input: {
    padding: '12px 16px',
    borderRadius: '6px',
    border: '1px solid var(--border-light)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  submitBtn: {
    marginTop: '10px',
    padding: '14px',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--accent-color)',
    color: '#FFF',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.1s, opacity 0.2s',
  }
};
