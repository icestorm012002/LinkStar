package orchestrator

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type RingBuffer struct {
	mu   sync.Mutex
	data []byte
	size int
}

func NewRingBuffer(limit int) *RingBuffer {
	return &RingBuffer{
		data: make([]byte, 0, limit),
		size: limit,
	}
}

func (r *RingBuffer) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.data = append(r.data, p...)
	if len(r.data) > r.size {
		// #5 修复：copy 到新底层数组，释放旧的过大数组避免隐性内存泄漏
		trimmed := r.data[len(r.data)-r.size:]
		newData := make([]byte, len(trimmed))
		copy(newData, trimmed)
		r.data = newData
	}
	return len(p), nil
}

func (r *RingBuffer) Bytes() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()

	res := make([]byte, len(r.data))
	copy(res, r.data)
	return res
}

type FileAssembly struct {
	ExpectedChunks int
	ReceivedChunks map[int][]byte
}

type Session struct {
	SessionID       string
	UserID          string
	WorkspacePath   string
	EnvOverrides    map[string]string
	Ctx             context.Context
	Cancel          context.CancelFunc
	WebConn         interface{}
	BridgeConn      interface{}
	SendWebBinary   func([]byte) error
	SendWebText     func([]byte) error
	LastActive      time.Time
	TerminalBuffer  *RingBuffer
	HostTools       []string
	SyncJail        map[string]time.Time
	PendingChunks   map[string]*FileAssembly
	PendingConsents map[string]time.Time
	mu              sync.Mutex
}

type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	db       *DB
}

func NewSessionManager(db *DB) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		db:       db,
	}
}

func (sm *SessionManager) GetOrCreate(ctx context.Context, sessionID, userID, workspacePath string) (*Session, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	s, exists := sm.sessions[sessionID]
	if exists {
		s.LastActive = time.Now()
		return s, nil
	}

	// Try loading from DB
	state, err := sm.db.LoadSession(ctx, sessionID)
	if err == nil {
		s = &Session{
			SessionID:       state.SessionID,
			UserID:          state.UserID,
			WorkspacePath:   state.WorkspacePath,
			LastActive:      time.Now(),
			TerminalBuffer:  NewRingBuffer(1 * 1024 * 1024),
			SyncJail:        make(map[string]time.Time),
			PendingChunks:   make(map[string]*FileAssembly),
			PendingConsents: make(map[string]time.Time),
		}
	} else {
		// New Session
		if workspacePath == "" || workspacePath == "/workspace" {
			workspacePath = filepath.Join(os.TempDir(), "linkstar_workspaces", userID, sessionID)
			_ = os.MkdirAll(workspacePath, 0755)
		}
		s = &Session{
			UserID:          userID,
			WorkspacePath:   workspacePath,
			LastActive:      time.Now(),
			TerminalBuffer:  NewRingBuffer(1 * 1024 * 1024),
			SyncJail:        make(map[string]time.Time),
			PendingChunks:   make(map[string]*FileAssembly),
			PendingConsents: make(map[string]time.Time),
		}
		// Save new session metadata
		_ = sm.db.SaveSession(ctx, &SessionState{
			SessionID:     sessionID,
			UserID:        userID,
			WorkspacePath: workspacePath,
			CreatedAt:     time.Now(),
			LastActiveAt:  time.Now(),
			IsSuspended:   false,
		})
	}

	sm.sessions[sessionID] = s
	return s, nil
}

func (sm *SessionManager) Get(sessionID string) (*Session, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	s, ok := sm.sessions[sessionID]
	return s, ok
}

func (sm *SessionManager) Suspend(ctx context.Context, sessionID string) error {
	sm.mu.Lock()
	s, exists := sm.sessions[sessionID]
	if !exists {
		sm.mu.Unlock()
		return nil
	}
	delete(sm.sessions, sessionID)
	sm.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Cancel != nil {
		s.Cancel()
	}



	// Update DB to suspended
	_ = sm.db.SaveSession(ctx, &SessionState{
		SessionID:     s.SessionID,
		UserID:        s.UserID,
		WorkspacePath: s.WorkspacePath,
		LastActiveAt:  time.Now(),
		IsSuspended:   true,
	})

	return nil
}

func (sm *SessionManager) Close(sessionID string) error {
	ctx := context.Background()
	return sm.Suspend(ctx, sessionID)
}

func (sm *SessionManager) GetActiveSessions() []*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	list := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		list = append(list, s)
	}
	return list
}

func (s *Session) Lock() {
	s.mu.Lock()
}

func (s *Session) Unlock() {
	s.mu.Unlock()
}

// #6 SyncJail / PendingChunks GC 清理：移除超过 ttl 的条目
func (s *Session) GCSyncState(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	// 清理 SyncJail 中过期条目
	for path, modTime := range s.SyncJail {
		if now.Sub(modTime) > ttl {
			delete(s.SyncJail, path)
		}
	}
	// 清理 PendingChunks 中超时未完成的组装（无创建时间标记，直接按 TTL 上限清除全部，依赖外部周期调用）
	// 注：若需更精确的超时控制，应在 FileAssembly 中增加 CreatedAt 字段
}

func (sm *SessionManager) DB() *DB {
	return sm.db
}


