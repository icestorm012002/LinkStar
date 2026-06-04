package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Policy struct {
	AllowedCommands []string `json:"allowed_commands"`
	BlockedPatterns []string `json:"blocked_patterns"`
}

type SecurityError struct {
	Type    string
	Message string
}

func (se *SecurityError) Error() string {
	return se.Message
}

type SafetyFilter struct {
	workspaceRoot  string
	policy         Policy
	dangerousChars *regexp.Regexp
}

func NewSafetyFilter(workspaceRoot string) *SafetyFilter {
	sf := &SafetyFilter{
		workspaceRoot:  workspaceRoot,
		dangerousChars: regexp.MustCompile(`[|;>&` + "`" + `]`),
	}
	sf.loadOrCreatePolicy()
	return sf
}

func (sf *SafetyFilter) loadOrCreatePolicy() {
	policyDir := filepath.Join(sf.workspaceRoot, ".agents")
	policyFile := filepath.Join(policyDir, "policy.json")

	defaultPolicy := Policy{
		AllowedCommands: []string{"git", "npm", "pnpm", "go", "cargo", "python", "pip", "uv"},
		BlockedPatterns: []string{"--global", "rm\\s+-rf", "mkfs", "shutdown", "reboot"},
	}

	if err := os.MkdirAll(policyDir, 0700); err != nil {
		sf.policy = defaultPolicy
		return
	}

	data, err := os.ReadFile(policyFile)
	if err == nil {
		var p Policy
		if err := json.Unmarshal(data, &p); err == nil {
			sf.policy = p
			return
		}
	}

	data, err = json.MarshalIndent(defaultPolicy, "", "  ")
	if err == nil {
		_ = os.WriteFile(policyFile, data, 0600)
	}
	sf.policy = defaultPolicy
}

func (sf *SafetyFilter) ValidateCommand(cmdStr string) error {
	trimmed := strings.TrimSpace(cmdStr)
	if trimmed == "" {
		return fmt.Errorf("command cannot be empty")
	}

	parts := strings.Fields(trimmed)
	cmdName := parts[0]

	// 1. Check dangerous character injection (HARD BLOCKED)
	if sf.dangerousChars.MatchString(trimmed) {
		return &SecurityError{
			Type:    "HARD_BLOCKED",
			Message: "command contains forbidden shell characters (pipes, redirects, backgrounding, or subshells)",
		}
	}

	// 2. Check blocked patterns (HARD BLOCKED)
	for _, pat := range sf.policy.BlockedPatterns {
		re, err := regexp.Compile("(?i)" + pat)
		if err == nil && re.MatchString(trimmed) {
			return &SecurityError{
				Type:    "HARD_BLOCKED",
				Message: fmt.Sprintf("command violates security policy blocklist pattern: %s", pat),
			}
		}
	}

	// 3. Check whitelist (NEEDS CONSENT if not whitelisted)
	allowed := false
	for _, c := range sf.policy.AllowedCommands {
		if cmdName == c {
			allowed = true
			break
		}
	}
	if !allowed {
		return &SecurityError{
			Type:    "NEEDS_CONSENT",
			Message: fmt.Sprintf("command '%s' is not in the whitelist of .agents/policy.json", cmdName),
		}
	}

	return nil
}
