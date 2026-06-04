package orchestrator

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// User models
type User struct {
	UserID       string    `json:"user_id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"password_hash,omitempty"`
	Email        string    `json:"email"`
	Avatar       string    `json:"avatar"`
	DisplayName  string    `json:"display_name"`
	CreatedAt    time.Time `json:"created_at"`
}

// UserPublic is a safe projection of User without sensitive fields
type UserPublic struct {
	UserID      string    `json:"user_id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	Avatar      string    `json:"avatar"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

// ToPublic strips sensitive fields from User
func (u *User) ToPublic() UserPublic {
	return UserPublic{
		UserID:      u.UserID,
		Username:    u.Username,
		Email:       u.Email,
		Avatar:      u.Avatar,
		DisplayName: u.DisplayName,
		CreatedAt:   u.CreatedAt,
	}
}

type UserDB struct {
	Users  map[string]User   `json:"users"`            // userID -> User
	Tokens map[string]string `json:"tokens"`           // token -> userID
	Names  map[string]string `json:"names_to_user_id"` // username -> userID
}

// GenerateRandomToken generates a 32-byte hex string token
func GenerateRandomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Simple hashing for MVP (in production, use bcrypt)
func hashPassword(password string) string {
	return fmt.Sprintf("hash_%s_salt", password)
}

func (db *DB) loadUserDB() (*UserDB, error) {
	file := filepath.Join(db.tempRoot, "users_db.json")
	data, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &UserDB{
				Users:  make(map[string]User),
				Tokens: make(map[string]string),
				Names:  make(map[string]string),
			}, nil
		}
		return nil, err
	}
	var udb UserDB
	if err := json.Unmarshal(data, &udb); err != nil {
		return nil, err
	}
	if udb.Users == nil {
		udb.Users = make(map[string]User)
	}
	if udb.Tokens == nil {
		udb.Tokens = make(map[string]string)
	}
	if udb.Names == nil {
		udb.Names = make(map[string]string)
	}
	return &udb, nil
}

func (db *DB) saveUserDB(udb *UserDB) error {
	file := filepath.Join(db.tempRoot, "users_db.json")
	data, err := json.MarshalIndent(udb, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(db.tempRoot, 0700); err != nil {
		return err
	}
	return os.WriteFile(file, data, 0600)
}

func (db *DB) RegisterUser(ctx context.Context, username, password, email string) (*User, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	// Do not trim password because users might intentionally use spaces in their passwords.

	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return nil, err
	}

	if _, exists := udb.Names[username]; exists {
		return nil, errors.New("username already exists")
	}

	userID := uuid.New().String()
	user := User{
		UserID:       userID,
		Username:     username,
		PasswordHash: hashPassword(password),
		Email:        email,
		Avatar:       "",
		DisplayName:  username,
		CreatedAt:    time.Now(),
	}

	udb.Users[userID] = user
	udb.Names[username] = userID

	if err := db.saveUserDB(udb); err != nil {
		return nil, err
	}

	return &user, nil
}

func (db *DB) LoginUser(ctx context.Context, username, password string) (string, *User, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	// Do not trim password because passwords can intentionally contain spaces or users might have registered with trailing spaces.

	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return "", nil, err
	}

	userID, exists := udb.Names[username]
	if !exists {
		return "", nil, errors.New("invalid username or password")
	}

	user := udb.Users[userID]
	if user.PasswordHash != hashPassword(password) {
		return "", nil, errors.New("invalid username or password")
	}

	token := "token_" + userID + "_" + GenerateRandomToken()
	udb.Tokens[token] = userID

	if err := db.saveUserDB(udb); err != nil {
		return "", nil, err
	}

	return token, &user, nil
}

func (db *DB) ValidateToken(ctx context.Context, token string) (string, error) {
	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return "", err
	}

	userID, exists := udb.Tokens[token]
	if !exists {
		return "", errors.New("invalid or expired token")
	}

	return userID, nil
}

// GetUserByID returns the public profile of a user by their ID
func (db *DB) GetUserByID(ctx context.Context, userID string) (*UserPublic, error) {
	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return nil, err
	}

	user, exists := udb.Users[userID]
	if !exists {
		return nil, errors.New("user not found")
	}

	pub := user.ToPublic()
	return &pub, nil
}

// UpdateUser updates mutable profile fields (displayName, email, avatar)
func (db *DB) UpdateUser(ctx context.Context, userID, displayName, email, avatar string) (*UserPublic, error) {
	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return nil, err
	}

	user, exists := udb.Users[userID]
	if !exists {
		return nil, errors.New("user not found")
	}

	if displayName != "" {
		user.DisplayName = displayName
	}
	if email != "" {
		user.Email = email
	}
	// Avatar can be set to empty (reset) so always apply if present in request
	user.Avatar = avatar

	udb.Users[userID] = user

	if err := db.saveUserDB(udb); err != nil {
		return nil, err
	}

	pub := user.ToPublic()
	return &pub, nil
}

// ChangePassword validates old password and sets a new one
func (db *DB) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return err
	}

	user, exists := udb.Users[userID]
	if !exists {
		return errors.New("user not found")
	}

	if user.PasswordHash != hashPassword(oldPassword) {
		return errors.New("current password is incorrect")
	}

	if len(newPassword) < 4 {
		return errors.New("new password must be at least 4 characters")
	}

	user.PasswordHash = hashPassword(newPassword)
	udb.Users[userID] = user

	if err := db.saveUserDB(udb); err != nil {
		return err
	}

	return nil
}

// InvalidateToken removes a token from the database (logout)
func (db *DB) InvalidateToken(ctx context.Context, token string) error {
	db.localLock.Lock()
	defer db.localLock.Unlock()

	udb, err := db.loadUserDB()
	if err != nil {
		return err
	}

	if _, exists := udb.Tokens[token]; !exists {
		// Token already gone — idempotent, not an error
		return nil
	}

	delete(udb.Tokens, token)

	return db.saveUserDB(udb)
}
