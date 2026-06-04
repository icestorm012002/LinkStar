package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type SessionState struct {
	SessionID     string    `json:"session_id"`
	UserID        string    `json:"user_id"`
	WorkspacePath string    `json:"workspace_path"`
	HomeDir       string    `json:"home_dir"`
	CreatedAt     time.Time `json:"created_at"`
	LastActiveAt  time.Time `json:"last_active_at"`
	IsSuspended   bool      `json:"is_suspended"`
}

type DB struct {
	rdb       *redis.Client
	tempRoot  string
	localLock sync.Mutex
}

func NewDB(redisAddr, redisPass, tempRoot string) *DB {
	var rdb *redis.Client
	if redisAddr != "" {
		rdb = redis.NewClient(&redis.Options{
			Addr:     redisAddr,
			Password: redisPass,
			DB:       1, // Use DB 1 for session storage
		})
	}
	return &DB{
		rdb:      rdb,
		tempRoot: tempRoot,
	}
}

func (db *DB) SaveSession(ctx context.Context, state *SessionState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("failed to marshal session state: %w", err)
	}

	// Try Redis first if available
	if db.rdb != nil {
		err = db.rdb.Set(ctx, "session:"+state.SessionID, data, 0).Err()
		if err == nil {
			return nil
		}
	}

	// Fallback to local file persistence
	db.localLock.Lock()
	defer db.localLock.Unlock()

	dir := filepath.Join(db.tempRoot, "sessions")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create sessions dir: %w", err)
	}

	file := filepath.Join(dir, state.SessionID+".json")
	if err := os.WriteFile(file, data, 0600); err != nil {
		return fmt.Errorf("failed to write local session state: %w", err)
	}

	return nil
}

func (db *DB) LoadSession(ctx context.Context, sessionID string) (*SessionState, error) {
	// Try Redis first
	if db.rdb != nil {
		val, err := db.rdb.Get(ctx, "session:"+sessionID).Result()
		if err == nil {
			var state SessionState
			if err := json.Unmarshal([]byte(val), &state); err == nil {
				return &state, nil
			}
		}
	}

	// Fallback to local file persistence
	db.localLock.Lock()
	defer db.localLock.Unlock()

	file := filepath.Join(db.tempRoot, "sessions", sessionID+".json")
	data, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("session not found")
		}
		return nil, fmt.Errorf("failed to read local session state: %w", err)
	}

	var state SessionState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to unmarshal local session state: %w", err)
	}

	return &state, nil
}

func (db *DB) DeleteSession(ctx context.Context, sessionID string) error {
	if db.rdb != nil {
		_ = db.rdb.Del(ctx, "session:"+sessionID).Err()
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	file := filepath.Join(db.tempRoot, "sessions", sessionID+".json")
	_ = os.Remove(file)
	return nil
}

func (db *DB) IncrementUserQuota(ctx context.Context, userID string) (int, error) {
	dateStr := time.Now().Format("2006-01-02")
	redisKey := fmt.Sprintf("quota:media:%s:%s", userID, dateStr)

	if db.rdb != nil {
		pipe := db.rdb.TxPipeline()
		incr := pipe.Incr(ctx, redisKey)
		pipe.Expire(ctx, redisKey, 24*time.Hour)
		_, err := pipe.Exec(ctx)
		if err == nil {
			val, _ := incr.Result()
			return int(val), nil
		}
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	dir := filepath.Join(db.tempRoot, "quotas")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return 0, err
	}

	file := filepath.Join(dir, fmt.Sprintf("%s_%s.json", userID, dateStr))
	count := 0
	data, err := os.ReadFile(file)
	if err == nil {
		_ = json.Unmarshal(data, &count)
	}

	count++
	newData, _ := json.Marshal(count)
	_ = os.WriteFile(file, newData, 0600)

	return count, nil
}

func (db *DB) SaveSessionTranscript(ctx context.Context, sessionID string, content []byte) error {
	if db.rdb != nil {
		err := db.rdb.Set(ctx, "session:history:jsonl:"+sessionID, content, 0).Err()
		if err == nil {
			return nil
		}
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	dir := filepath.Join(db.tempRoot, "sessions", sessionID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "transcript.jsonl"), content, 0600)
}

func (db *DB) LoadSessionTranscript(ctx context.Context, sessionID string) ([]byte, error) {
	if db.rdb != nil {
		val, err := db.rdb.Get(ctx, "session:history:jsonl:"+sessionID).Bytes()
		if err == nil {
			return val, nil
		}
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	file := filepath.Join(db.tempRoot, "sessions", sessionID, "transcript.jsonl")
	data, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}

func (db *DB) SaveGlobalHistory(ctx context.Context, userID string, content []byte) error {
	if db.rdb != nil {
		err := db.rdb.Set(ctx, "session:global_history:jsonl:"+userID, content, 0).Err()
		if err == nil {
			return nil
		}
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	dir := filepath.Join(db.tempRoot, "users", userID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "history.jsonl"), content, 0600)
}

func (db *DB) LoadGlobalHistory(ctx context.Context, userID string) ([]byte, error) {
	if db.rdb != nil {
		val, err := db.rdb.Get(ctx, "session:global_history:jsonl:"+userID).Bytes()
		if err == nil {
			return val, nil
		}
	}

	db.localLock.Lock()
	defer db.localLock.Unlock()

	file := filepath.Join(db.tempRoot, "users", userID, "history.jsonl")
	data, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}


