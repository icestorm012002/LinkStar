package orchestrator

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	rdb       *redis.Client
	mu        sync.Mutex
	inMemHits map[string][]time.Time
}

func NewRateLimiter(addr, password string) *RateLimiter {
	var rdb *redis.Client
	if addr != "" {
		rdb = redis.NewClient(&redis.Options{
			Addr:     addr,
			Password: password,
			DB:       0,
		})
	}
	return &RateLimiter{
		rdb:       rdb,
		inMemHits: make(map[string][]time.Time),
	}
}

func (rl *RateLimiter) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if rl.rdb != nil {
		pipe := rl.rdb.TxPipeline()
		incr := pipe.Incr(ctx, key)
		pipe.Expire(ctx, key, window)

		_, err := pipe.Exec(ctx)
		if err == nil {
			currentCount, err := incr.Result()
			if err == nil {
				return currentCount <= int64(limit), nil
			}
		}
	}

	// Local Thread-safe In-memory sliding window fallback
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-window)

	var activeHits []time.Time
	for _, hitTime := range rl.inMemHits[key] {
		if hitTime.After(cutoff) {
			activeHits = append(activeHits, hitTime)
		}
	}

	if len(activeHits) >= limit {
		rl.inMemHits[key] = activeHits
		return false, nil
	}

	activeHits = append(activeHits, now)
	rl.inMemHits[key] = activeHits
	return true, nil
}
