package orchestrator

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

var (
	GlobalConcurrencyLimit = make(chan struct{}, 50)
	userLocks              sync.Map
)

func getUserLock(userID string) *sync.Mutex {
	lock, _ := userLocks.LoadOrStore(userID, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func initUserDir(userID string, workspaceRoot string) (string, error) {
	lock := getUserLock(userID)
	lock.Lock()
	defer lock.Unlock()

	userDir := filepath.Join(workspaceRoot, "users", userID)
	if _, err := os.Stat(userDir); err == nil {
		return userDir, nil
	}
	err := os.MkdirAll(userDir, 0755)
	return userDir, err
}

func RunClaudeTurn(ctx context.Context, sessionID, userID, workspacePath, prompt string, db *DB, envOverrides map[string]string, streamCallback func(string)) error {
	if workspacePath == "" {
		return fmt.Errorf("workspace path cannot be empty")
	}

	// 1. 初始化并获取用户目录
	userDir, err := initUserDir(userID, workspacePath)
	if err != nil {
		return fmt.Errorf("failed to init user dir: %v", err)
	}

	// 2. 用户级文件锁：同一个用户不能同时运行两个请求
	lock := getUserLock(userID)
	lock.Lock()
	defer lock.Unlock()

	// 3. 全局并发控制
	select {
	case GlobalConcurrencyLimit <- struct{}{}:
		defer func() { <-GlobalConcurrencyLimit }()
	case <-ctx.Done():
		return ctx.Err()
	}

	// 4. 改为活跃度监控上下文 (无硬超时)
	cmdCtx, cancelCmd := context.WithCancel(ctx)
	defer cancelCmd()
	
	log.Printf("[Debug] RunClaudeTurn -> userID: %s, workspacePath: %s", userID, workspacePath)
	log.Printf("[Debug] envOverrides for user %s: %+v", userID, envOverrides)

	// 准备传递给 headless-server 的 config JSON
	configMap := map[string]interface{}{
		"prompt":       prompt,
		"sessionDir":   userDir,
		"remoteCwd":    userDir,
		"sessionId":    sessionID,
		"envOverrides": envOverrides,
	}
	configBytes, _ := json.Marshal(configMap)

	claudeCodeDir := os.Getenv("ENGINE_DIR")
	if claudeCodeDir == "" {
		// 动态获取相对路径，兼容 Linux 和 Windows 部署
		claudeCodeDir = "../engine"
	}
	cmd := exec.CommandContext(cmdCtx, "bun", "run", "src/headless-server.ts", string(configBytes))
	cmd.Dir = claudeCodeDir

	// 继承主进程环境变量
	env := os.Environ()
	for k, v := range envOverrides {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	// 5. 防泄漏机制 (兼容 Windows 和 Linux)
	defer func() {
		if cmd.Process != nil {
			// Windows 下强制杀进程树，Linux 下依靠进程组或直接 Kill
			_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", cmd.Process.Pid)).Run()
			_ = cmd.Process.Kill()
		}
	}()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %v", err)
	}
	
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start headless server: %v", err)
	}

	// 活跃度检测机制：5 分钟无任何输出则认为卡死
	lastActivity := time.Now()
	var activityMu sync.Mutex

	go func() {
		for {
			select {
			case <-cmdCtx.Done():
				return
			case <-time.After(30 * time.Second):
				activityMu.Lock()
				idleTime := time.Since(lastActivity)
				activityMu.Unlock()
				if idleTime > 5*time.Minute {
					if cmd.Process != nil {
						_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", cmd.Process.Pid)).Run()
						_ = cmd.Process.Kill()
					}
					return
				}
			}
		}
	}()

	// 记录进程启动时间
	startTime := time.Now()
	var firstTokenOnce sync.Once

	// 6. 流式输出转发
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		const maxCapacity = 10 * 1024 * 1024 // 10MB
		buf := make([]byte, maxCapacity)
		scanner.Buffer(buf, maxCapacity)
		for scanner.Scan() {
			activityMu.Lock()
			lastActivity = time.Now()
			activityMu.Unlock()
			
			firstTokenOnce.Do(func() {
				log.Printf("[Performance] TTFT (Time To First Token) for Session %s (User %s): %v", sessionID, userID, time.Since(startTime))
			})

			line := scanner.Text()
			if streamCallback != nil {
				streamCallback(line)
			}
		}
	}()
	
	// 简单捕获 stderr 记录日志，防止阻塞
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(os.Stderr, stderr)
	}()

	wg.Wait()
	err = cmd.Wait()

	// 7. 错误细分
	if err != nil {
		if cmdCtx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("request timeout (120s limit reached)")
		}
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode := exitError.ExitCode()
			if exitCode == 137 {
				return fmt.Errorf("process was killed (OOM or force kill)")
			}
			return fmt.Errorf("claude process failed with exit code %d", exitCode)
		}
		return fmt.Errorf("command execution failed: %v", err)
	}

	return nil
}
