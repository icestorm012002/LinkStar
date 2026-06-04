package gateway

import (
	"agent-cloud-os/server/orchestrator"
	"github.com/gofiber/fiber/v2"
)

type RegisterRequest struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	EmailCode string `json:"emailCode"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type UpdateProfileRequest struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Avatar      string `json:"avatar"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

// extractBearerToken pulls the token from the Authorization header
func extractBearerToken(c *fiber.Ctx) string {
	authHeader := c.Get("Authorization")
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}
	return ""
}

func SetupAuthRoutes(app *fiber.App, db *orchestrator.DB) {
	authGroup := app.Group("/api/auth")

	// ---------- Registration ----------
	authGroup.Post("/register", func(c *fiber.Ctx) error {
		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Username == "" || req.Password == "" || req.EmailCode == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
		}

		// Fake email verification check
		if req.EmailCode != "1234" && len(req.EmailCode) < 4 {
			// Allow dummy codes for testing purposes
		}

		user, err := db.RegisterUser(c.UserContext(), req.Username, req.Password, "fake_email@test.com")
		if err != nil {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{
			"message": "Registration successful",
			"user":    user.ToPublic(),
		})
	})

	// ---------- Login ----------
	authGroup.Post("/login", func(c *fiber.Ctx) error {
		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Username == "" || req.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing username or password"})
		}

		token, user, err := db.LoginUser(c.UserContext(), req.Username, req.Password)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{
			"message": "Login successful",
			"token":   token,
			"user":    user.ToPublic(),
		})
	})

	// ---------- Get Profile ----------
	authGroup.Get("/profile", func(c *fiber.Ctx) error {
		token := extractBearerToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing authorization token"})
		}

		userID, err := db.ValidateToken(c.UserContext(), token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token: " + err.Error()})
		}

		profile, err := db.GetUserByID(c.UserContext(), userID)
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{"user": profile})
	})

	// ---------- Update Profile ----------
	authGroup.Put("/profile", func(c *fiber.Ctx) error {
		token := extractBearerToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing authorization token"})
		}

		userID, err := db.ValidateToken(c.UserContext(), token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token: " + err.Error()})
		}

		var req UpdateProfileRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		updated, err := db.UpdateUser(c.UserContext(), userID, req.DisplayName, req.Email, req.Avatar)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{"message": "Profile updated", "user": updated})
	})

	// ---------- Change Password ----------
	authGroup.Put("/password", func(c *fiber.Ctx) error {
		token := extractBearerToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing authorization token"})
		}

		userID, err := db.ValidateToken(c.UserContext(), token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token: " + err.Error()})
		}

		var req ChangePasswordRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.OldPassword == "" || req.NewPassword == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Both old and new passwords are required"})
		}

		if err := db.ChangePassword(c.UserContext(), userID, req.OldPassword, req.NewPassword); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{"message": "Password changed successfully"})
	})

	// ---------- Logout ----------
	authGroup.Post("/logout", func(c *fiber.Ctx) error {
		token := extractBearerToken(c)
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing authorization token"})
		}

		if err := db.InvalidateToken(c.UserContext(), token); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{"message": "Logged out successfully"})
	})
}

