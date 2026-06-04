package main

import (
	"context"
	"log"
	"time"

	"agent-cloud-os/server/config"
	"agent-cloud-os/server/gateway"
	"agent-cloud-os/server/orchestrator"

	"github.com/gofiber/fiber/v2"
)

func main() {
	cfg := config.LoadConfig()

	db := orchestrator.NewDB(cfg.RedisAddr, cfg.RedisPass, cfg.TempRoot)
	sm := orchestrator.NewSessionManager(db)
	ma := orchestrator.NewMediaAdapter()

	wh := gateway.NewWebSocketHandler(sm, cfg)

	// Clean up idle sessions (WS disconnected for > 5 mins) to save memory
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		for range ticker.C {
			ctx := context.Background()
			for _, s := range sm.GetActiveSessions() {
				s.Lock()
				// Suspend if no active UI/Bridge connections and inactive for 5 minutes
				if s.WebConn == nil && s.BridgeConn == nil && time.Since(s.LastActive) > 5*time.Minute {
					s.Unlock()
					log.Printf("[Cleaner] Suspending idle session %s to reclaim memory", s.SessionID)
					_ = sm.Suspend(ctx, s.SessionID)
				} else {
					s.Unlock()
				}
			}
		}
	}()

	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
	})

	gateway.SetupRoutes(app, wh, ma)

	log.Printf("[Server] Starting Agent Cloud OS backend on port %s", cfg.Port)
	log.Fatal(app.Listen(":" + cfg.Port))
}
