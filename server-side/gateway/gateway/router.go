package gateway

import (
	"time"

	"agent-cloud-os/server/orchestrator"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type ImageGenRequest struct {
	Prompt string `json:"prompt"`
	Size   string `json:"size"`
}

type ImageEditRequest struct {
	Image  string `json:"image"`
	Prompt string `json:"prompt"`
}

type VideoGenRequest struct {
	Prompt   string `json:"prompt"`
	Duration int    `json:"duration"`
}

func SetupRoutes(app *fiber.App, wh *WSHandler, ma *orchestrator.MediaAdapter) {
	app.Use(logger.New())
	app.Use(recover.New())

	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws", websocket.New(wh.Handle))

	checkRateLimit := func(c *fiber.Ctx, key string, limit int) error {
		if wh.limiter != nil {
			allowed, err := wh.limiter.CheckRateLimit(c.UserContext(), key, limit, time.Minute)
			if err != nil || !allowed {
				return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "API rate limit exceeded"})
			}
		}
		return nil
	}

	validateBearerAuth := func(c *fiber.Ctx) (string, error) {
		authHeader := c.Get("Authorization")
		if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			return "", c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing or invalid authorization header"})
		}
		token := authHeader[7:]
		
		userID, err := wh.sm.DB().ValidateToken(c.UserContext(), token)
		if err != nil {
			return "", c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid session token signature: " + err.Error()})
		}
		
		return userID, nil
	}

	enforceQuota := func(c *fiber.Ctx, userID string) error {
		count, err := wh.sm.DB().IncrementUserQuota(c.UserContext(), userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to verify user quota"})
		}
		if count > 50 {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Daily media generation quota (50) exceeded"})
		}
		return nil
	}

	// Media Engine REST endpoints
	app.Post("/api/media/image/generate", func(c *fiber.Ctx) error {
		userID, err := validateBearerAuth(c)
		if err != nil {
			return err
		}
		if err := checkRateLimit(c, "rl:media:image_gen:"+userID, 10); err != nil {
			return err
		}
		if err := enforceQuota(c, userID); err != nil {
			return err
		}

		var req ImageGenRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON request body"})
		}
		if req.Prompt == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "prompt field is required"})
		}
		data, err := ma.GenerateImage(c.UserContext(), req.Prompt, req.Size)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		c.Set("Content-Type", "application/octet-stream")
		return c.Send(data)
	})

	app.Post("/api/media/image/edit", func(c *fiber.Ctx) error {
		userID, err := validateBearerAuth(c)
		if err != nil {
			return err
		}
		if err := checkRateLimit(c, "rl:media:image_edit:"+userID, 10); err != nil {
			return err
		}
		if err := enforceQuota(c, userID); err != nil {
			return err
		}

		var req ImageEditRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON request body"})
		}
		if req.Image == "" || req.Prompt == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "image and prompt fields are required"})
		}
		data, err := ma.EditImage(c.UserContext(), req.Image, req.Prompt)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		c.Set("Content-Type", "application/octet-stream")
		return c.Send(data)
	})

	app.Post("/api/media/video/generate", func(c *fiber.Ctx) error {
		userID, err := validateBearerAuth(c)
		if err != nil {
			return err
		}
		if err := checkRateLimit(c, "rl:media:video_gen:"+userID, 5); err != nil {
			return err
		}
		if err := enforceQuota(c, userID); err != nil {
			return err
		}

		var req VideoGenRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON request body"})
		}
		if req.Prompt == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "prompt field is required"})
		}
		if req.Duration == 0 {
			req.Duration = 5
		}
		data, err := ma.GenerateVideo(c.UserContext(), req.Prompt, req.Duration)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		c.Set("Content-Type", "application/octet-stream")
		return c.Send(data)
	})

	// Schema API for Dynamic Frontend Rendering
	app.Get("/api/media/schema", func(c *fiber.Ctx) error {
		// Public schema fetching or add validateBearerAuth if needed
		schema := orchestrator.GetSchema()
		return c.JSON(schema)
	})

	app.Post("/api/media/workflow/generate", func(c *fiber.Ctx) error {
		userID, err := validateBearerAuth(c)
		if err != nil {
			return err
		}
		if err := checkRateLimit(c, "rl:media:workflow_gen:"+userID, 5); err != nil {
			return err
		}
		if err := enforceQuota(c, userID); err != nil {
			return err
		}

		var req orchestrator.WorkflowRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON request body"})
		}
		if req.Script == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "script field is required"})
		}

		result, err := ma.ExecuteOneClickWorkflow(c.UserContext(), req)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(result)
	})

	// Mount auth routes
	SetupAuthRoutes(app, wh.sm.DB())
}
