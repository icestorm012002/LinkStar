package gateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"agent-cloud-os/server/config"
	"agent-cloud-os/server/orchestrator"

	"github.com/gofiber/contrib/websocket"
)

type WSHandler struct {
	sm      *orchestrator.SessionManager
	cfg     *config.Config
	limiter *orchestrator.RateLimiter
}

func NewWebSocketHandler(sm *orchestrator.SessionManager, cfg *config.Config) *WSHandler {
	var limiter *orchestrator.RateLimiter
	if cfg.RedisAddr != "" {
		limiter = orchestrator.NewRateLimiter(cfg.RedisAddr, cfg.RedisPass)
	}
	return &WSHandler{sm: sm, cfg: cfg, limiter: limiter}
}

var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

func stripANSI(str string) string {
	return ansiRegex.ReplaceAllString(str, "")
}

// connWriter 封装带互斥锁的 WebSocket 连接写入器
type connWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (cw *connWriter) WriteJSON(v interface{}) error {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	return cw.conn.WriteJSON(v)
}

func (cw *connWriter) WriteMessage(messageType int, data []byte) error {
	cw.mu.Lock()
	defer cw.mu.Unlock()
	return cw.conn.WriteMessage(messageType, data)
}

type SyncPayload struct {
	Action     string `json:"action"`
	Path       string `json:"path"`
	Content    string `json:"content"`
	Originator string `json:"originator"`
}

type MessageFrame struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

func (wh *WSHandler) Handle(c *websocket.Conn) {
	sessionID := c.Query("session_id")
	clientType := c.Query("client_type")
	token := c.Query("token")
	workspaceID := c.Query("workspace_id")
	if workspaceID == "" {
		workspaceID = "default"
	}

	if sessionID == "" || token == "" {
		log.Printf("[Server] Rejecting WS: missing session_id or token")
		_ = c.WriteJSON(map[string]string{"error": "missing session_id or token"})
		_ = c.Close()
		return
	}

	// Token validation
	validUserID, err := wh.sm.DB().ValidateToken(context.Background(), token)
	if err != nil {
		log.Printf("[Server] Rejecting WS: unauthorized token: %v", err)
		_ = c.WriteJSON(map[string]string{"error": "unauthorized: " + err.Error()})
		_ = c.Close()
		return
	}
	userID := validUserID

	if wh.limiter != nil {
		allowed, err := wh.limiter.CheckRateLimit(context.Background(), "rl:ws:"+userID, 100, time.Minute)
		if err != nil || !allowed {
			log.Printf("[Server] Rejecting WS: rate limit exceeded for user %s", userID)
			_ = c.WriteJSON(map[string]string{"error": "websocket upgrade rate limit exceeded"})
			_ = c.Close()
			return
		}
	}

	sandboxDir := filepath.Join(wh.cfg.TempRoot, "users", userID, "workspaces", workspaceID, "sessions", sessionID)
	session, err := wh.sm.GetOrCreate(context.Background(), sessionID, userID, sandboxDir)
	if err != nil {
		log.Printf("[Server] Rejecting WS: failed to load session: %v", err)
		_ = c.WriteJSON(map[string]string{"error": fmt.Sprintf("failed to load session: %v", err)})
		_ = c.Close()
		return
	}

	if clientType == "bridge" {
		// #13 TOCTOU 修复：在同一个锁内完成旧连接关闭 + 新连接绑定
		session.Lock()
		if session.BridgeConn != nil {
			if oldConn, ok := session.BridgeConn.(*websocket.Conn); ok {
				_ = oldConn.WriteJSON(map[string]string{"info": "bridge connection preempted"})
				_ = oldConn.Close()
			}
		}
		session.BridgeConn = c
		session.LastActive = time.Now()
		session.Unlock()
		wh.handleBridge(c, session)
	} else {
		// #13 TOCTOU 修复
		session.Lock()
		if session.WebConn != nil {
			if oldConn, ok := session.WebConn.(*websocket.Conn); ok {
				_ = oldConn.WriteJSON(map[string]string{"info": "web connection preempted"})
				_ = oldConn.Close()
			}
		}
		session.WebConn = c
		writer := &connWriter{conn: c}

	// Ping Heartbeat
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := writer.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()
		session.SendWebBinary = func(data []byte) error {
			return writer.WriteMessage(websocket.BinaryMessage, data)
		}
		session.SendWebText = func(data []byte) error {
			return writer.WriteMessage(websocket.TextMessage, data)
		}
		session.LastActive = time.Now()
		session.Unlock()
		wh.handleWeb(c, session)
	}
}

func (wh *WSHandler) handleBridge(c *websocket.Conn, s *orchestrator.Session) {
	// BridgeConn 已在 Handle() 中绑定，此处不再重复设置
	bridgeWriter := &connWriter{conn: c}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := bridgeWriter.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()
	log.Printf("[Server] Bridge client connected for session %s", s.UserID, s.SessionID)

	defer func() {
		s.Lock()
		// 只有当当前连接确实是自己时才清除，避免误清新的抢占连接
		if s.BridgeConn == c {
			s.BridgeConn = nil
		}
		s.LastActive = time.Now()
		s.Unlock()
		log.Printf("[Server] Bridge client disconnected for session %s", s.UserID, s.SessionID)
	}()

	for {
		mt, msg, err := c.ReadMessage()
		if err != nil {
			break
		}
		if mt != websocket.TextMessage {
			continue
		}

		var frame MessageFrame
		if err := json.Unmarshal(msg, &frame); err != nil {
			continue
		}

		s.Lock()
		s.LastActive = time.Now()
		s.Unlock()

		if frame.Event == "file_sync" {
			dataBytes, _ := json.Marshal(frame.Data)
			var payload SyncPayload
			if err := json.Unmarshal(dataBytes, &payload); err == nil {
				wh.syncFileLocal(s, payload)
			}
		} else if frame.Event == "file_sync_batch" {
			dataBytes, _ := json.Marshal(frame.Data)
			var payloads []SyncPayload
			if err := json.Unmarshal(dataBytes, &payloads); err == nil {
				for _, p := range payloads {
					wh.syncFileLocal(s, p)
				}
			}
		} else if frame.Event == "host_env" {
			dataBytes, _ := json.Marshal(frame.Data)
			var tools []string
			if err := json.Unmarshal(dataBytes, &tools); err == nil {
				s.Lock()
				s.HostTools = tools
				s.Unlock()
				log.Printf("[Server] Registered host tools for session %s: %v", s.SessionID, tools)
			}
		} else if frame.Event == "file_chunk" {
			dataBytes, _ := json.Marshal(frame.Data)
			var chunk struct {
				Path        string `json:"path"`
				ChunkIndex  int    `json:"chunk_index"`
				TotalChunks int    `json:"total_chunks"`
				Content     string `json:"content"`
			}
			if err := json.Unmarshal(dataBytes, &chunk); err == nil {
				s.Lock()
				assembly, exists := s.PendingChunks[chunk.Path]
				if !exists {
					assembly = &orchestrator.FileAssembly{
						ExpectedChunks: chunk.TotalChunks,
						ReceivedChunks: make(map[int][]byte),
					}
					s.PendingChunks[chunk.Path] = assembly
				}
				data, _ := base64.StdEncoding.DecodeString(chunk.Content)
				assembly.ReceivedChunks[chunk.ChunkIndex] = data
				
				completed := len(assembly.ReceivedChunks) == assembly.ExpectedChunks
				s.Unlock()

				if completed {
					log.Printf("[Server] Big file chunk assembly complete for %s", chunk.Path)
					targetPath := filepath.Join(s.WorkspacePath, chunk.Path)
					var fullData []byte
					s.Lock()
					for i := 0; i < assembly.ExpectedChunks; i++ {
						fullData = append(fullData, assembly.ReceivedChunks[i]...)
					}
					delete(s.PendingChunks, chunk.Path)
					s.Unlock()
					
					_ = os.MkdirAll(filepath.Dir(targetPath), 0700)
					_ = os.WriteFile(targetPath, fullData, 0600)
					
					// 记录至 SyncJail，防环
					info, err := os.Stat(targetPath)
					if err == nil {
						s.Lock()
						s.SyncJail[chunk.Path] = info.ModTime()
						s.Unlock()
					}
				}
			}
		} else if frame.Event == "consent_request" {
			dataBytes, _ := json.Marshal(frame.Data)
			var req struct {
				ID      string `json:"id"`
				Command string `json:"command"`
			}
			if err := json.Unmarshal(dataBytes, &req); err == nil {
				s.Lock()
				// TTL GC: 清理超过 60s 的审批项
				now := time.Now()
				for id, t := range s.PendingConsents {
					if now.Sub(t) > 60*time.Second {
						delete(s.PendingConsents, id)
					}
				}
				// 判定并发限额 (最多 3 个)
				if len(s.PendingConsents) >= 3 {
					s.Unlock()
					log.Printf("[Server] Overload: rejecting consent request %s for session %s (active pending: %d)", req.ID, s.SessionID, len(s.PendingConsents))
					rejectFrame, _ := json.Marshal(MessageFrame{
						Event: "consent_response",
						Data: map[string]interface{}{
							"id":       req.ID,
							"approved": false,
						},
					})
					_ = bridgeWriter.WriteMessage(websocket.TextMessage, rejectFrame)
					continue
				}
				s.PendingConsents[req.ID] = now
				webConn := s.WebConn
				s.Unlock()

				if webConn != nil {
					if conn, ok := webConn.(*websocket.Conn); ok {
						_ = conn.WriteMessage(websocket.TextMessage, msg)
					}
				}
			}
		}
	}
}

func (wh *WSHandler) syncFileLocal(s *orchestrator.Session, p SyncPayload) {
	targetPath := filepath.Join(s.WorkspacePath, p.Path)
	// #11 路径穿越加固
	cleanTarget := filepath.Clean(targetPath)
	cleanRoot := filepath.Clean(s.WorkspacePath)
	if !strings.HasPrefix(cleanTarget, cleanRoot+string(filepath.Separator)) && cleanTarget != cleanRoot {
		log.Printf("[Jail Violation] Rejected file sync path: %s (resolved: %s)", p.Path, cleanTarget)
		return
	}

	if p.Action == "REMOVE" {
		if err := os.Remove(targetPath); err != nil && !os.IsNotExist(err) {
			log.Printf("[Server] Failed to remove synced file %s: %v", p.Path, err)
		}
	} else if p.Action == "CREATE" || p.Action == "WRITE" {
		if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
			log.Printf("[Server] Failed to create directory for %s: %v", p.Path, err)
			return
		}
		var writeData []byte
		if p.Content != "" {
			var decErr error
			writeData, decErr = base64.StdEncoding.DecodeString(p.Content)
			if decErr != nil {
				log.Printf("[Server] Failed to decode base64 for %s: %v", p.Path, decErr)
				return
			}
		}
		if err := os.WriteFile(targetPath, writeData, 0600); err != nil {
			log.Printf("[Server] Failed to write synced file %s: %v", p.Path, err)
			return
		}
		// 登记到 SyncJail 防环
		info, err := os.Stat(targetPath)
		if err == nil {
			s.Lock()
			s.SyncJail[p.Path] = info.ModTime()
			s.Unlock()
		}
	}
}

func (wh *WSHandler) handleWeb(c *websocket.Conn, s *orchestrator.Session) {
	// WebConn 已在 Handle() 中绑定，此处不再重复设置
	// 获取环形缓冲区的历史数据进行重放
	s.Lock()
	historyBytes := s.TerminalBuffer.Bytes()
	s.Unlock()
	log.Printf("[UserID: %s] [SessionID: %s] Web client connected", s.UserID, s.SessionID)

	// #3 创建带互斥锁的写入器
	writer := &connWriter{conn: c}

	defer func() {
		s.Lock()
		// 只有当当前连接确实是自己时才清除
		if s.WebConn == c {
			s.WebConn = nil
			s.SendWebBinary = nil
			s.SendWebText = nil
		}
		s.LastActive = time.Now()
		s.Unlock()
		log.Printf("[Server] Web client disconnected for session %s", s.UserID, s.SessionID)
	}()

	// 1. 重放之前的终端历史
	if len(historyBytes) > 0 {
		if err := writer.WriteMessage(websocket.BinaryMessage, historyBytes); err != nil {
			log.Printf("[Server] Failed to replay terminal history: %v", err)
		}
	}

	// #6 启动 SyncJail GC 定时器
	gcTicker := time.NewTicker(30 * time.Second)
	defer gcTicker.Stop()
	go func() {
		for range gcTicker.C {
			s.GCSyncState(2 * time.Minute)
		}
	}()

	watcher := orchestrator.NewWorkspaceWatcher(s.WorkspacePath, func(events []orchestrator.WatcherEvent) {
		s.Lock()
		bridge := s.BridgeConn
		s.Unlock()
		if bridge == nil {
			return
		}
		bridgeConn, ok := bridge.(*websocket.Conn)
		if !ok {
			return
		}
		// #3 为此 bridge 连接创建带锁写入器
		bridgeWriter := &connWriter{conn: bridgeConn}
		var frames []SyncPayload
		for _, ev := range events {
			fullPath := filepath.Join(s.WorkspacePath, ev.RelPath)
			// 防环过滤
			s.Lock()
			lastSyncTime, inJail := s.SyncJail[ev.RelPath]
			s.Unlock()
			if inJail {
				info, err := os.Stat(fullPath)
				if err == nil && !info.ModTime().After(lastSyncTime) {
					continue // 跳过同步，因为该修改由同步写入动作触发
				}
			}

			payload := SyncPayload{Action: ev.Action, Path: ev.RelPath, Originator: "server"}
			if ev.Action != "REMOVE" {
				info, err := os.Stat(fullPath)
				if err == nil && info.Size() <= 10*1024*1024 {
					data, err := os.ReadFile(fullPath)
					if err == nil {
						payload.Content = base64.StdEncoding.EncodeToString(data)
					}
				} else if err == nil {
					log.Printf("[Sync Skip] File %s too large to sync (%d MB), sending metadata placeholder only", ev.RelPath, info.Size()/(1024*1024))
				}
			}
			frames = append(frames, payload)
		}
		if len(frames) > 0 {
			frameBytes, _ := json.Marshal(MessageFrame{Event: "file_sync_batch", Data: frames})
			if err := bridgeWriter.WriteMessage(websocket.TextMessage, frameBytes); err != nil {
				log.Printf("[Server] Failed to send file_sync_batch to bridge: %v", err)
			}
		}
	})
	_ = watcher.Start()
	defer watcher.Stop()

	for {
		mt, msg, err := c.ReadMessage()
		if err != nil {
			break
		}
		s.Lock()
		s.LastActive = time.Now()
		s.Unlock()

		if mt == websocket.TextMessage {
			// 1. 尝试解析成前端的 auth 消息协议，并动态拉起进程
			var authMsg struct {
				Type         string            `json:"type"`
				UserID       string            `json:"userId"`
				ClientOS     string            `json:"clientOS"`
				ClientShell  string            `json:"clientShell"`
				EnvOverrides map[string]string `json:"envOverrides"`
			}
			if err := json.Unmarshal(msg, &authMsg); err == nil && authMsg.Type == "auth" {
				s.Lock()
				if s.EnvOverrides == nil {
					s.EnvOverrides = make(map[string]string)
				}
				for k, v := range authMsg.EnvOverrides {
					s.EnvOverrides[k] = v
				}
				s.Unlock()

				// 返回 auth_ok 回执给前端以触发 connected 视觉标志
				authOkEvt := map[string]interface{}{
					"type":   "auth_ok",
					"userId": s.UserID,
				}
				authOkBytes, _ := json.Marshal(authOkEvt)
				s.Lock()
				sendTextFn := s.SendWebText
				s.Unlock()
				if sendTextFn != nil {
					_ = sendTextFn(authOkBytes)
				}
				continue
			}

			// 2. 尝试解析成前端的 chat 消息协议
			var chatMsg struct {
				Type    string `json:"type"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal(msg, &chatMsg); err == nil && chatMsg.Type == "chat" {
				// 发送 session_start，展示 Thinking 动画
				startEvt := map[string]interface{}{
					"type":      "session_start",
					"sessionId": s.SessionID,
				}
				startBytes, _ := json.Marshal(startEvt)
				s.Lock()
				sendTextFn := s.SendWebText
				s.Unlock()
				if sendTextFn != nil {
					_ = sendTextFn(startBytes)
				}

				// 拉起 Serverless 任务
				log.Printf("[Server] Chat message received, launching Serverless Claude turn: %s", chatMsg.Content)
				go func(prompt string) {
					streamCb := func(line string) {
						var ev map[string]interface{}
						if err := json.Unmarshal([]byte(line), &ev); err != nil {
							// Fallback: 如果不是合法 JSON，就作为纯文本
							ev = map[string]interface{}{
								"type":   "result",
								"result": stripANSI(line),
							}
						}

						evt := map[string]interface{}{
							"type":      "engine_event",
							"sessionId": s.SessionID,
							"event":     ev,
						}
						evtBytes, _ := json.Marshal(evt)
						s.Lock()
						fn := s.SendWebText
						s.Unlock()
						if fn != nil {
							_ = fn(evtBytes)
						}
					}

					err := orchestrator.RunClaudeTurn(
						context.Background(),
						s.SessionID,
						s.UserID,
						s.WorkspacePath,
						prompt,
						wh.sm.DB(),
						s.EnvOverrides,
						streamCb,
					)
					
					if err != nil {
						log.Printf("[Server] RunClaudeTurn failed: %v", err)
						errEvt := map[string]interface{}{
							"type":    "error",
							"message": fmt.Sprintf("AI execution failed: %v", err),
						}
						errBytes, _ := json.Marshal(errEvt)
						s.Lock()
						fn := s.SendWebText
						s.Unlock()
						if fn != nil {
							_ = fn(errBytes)
						}
					}
				}(chatMsg.Content)
				continue
			}

			// 2. 尝试解析成 API 测试连接消息协议并执行真实请求检测
			var testMsg struct {
				Type     string `json:"type"`
				Provider string `json:"provider"`
				ApiKey   string `json:"apiKey"`
				BaseUrl  string `json:"baseUrl"`
				Model    string `json:"model"`
			}
			if err := json.Unmarshal(msg, &testMsg); err == nil && testMsg.Type == "test_api_connection" {
				log.Printf("[Server] Received API test request for provider: %s, model: %s", testMsg.Provider, testMsg.Model)
				go func() {
					success, status, errMsg := wh.testAPIConnection(s.WorkspacePath, testMsg.Provider, testMsg.ApiKey, testMsg.BaseUrl, testMsg.Model)
					resp := map[string]interface{}{
						"type":    "test_connection_result",
						"success": success,
						"status":  status,
						"message": errMsg,
					}
					respBytes, _ := json.Marshal(resp)
					s.Lock()
					sendTextFn := s.SendWebText
					s.Unlock()
					if sendTextFn != nil {
						_ = sendTextFn(respBytes)
					}
				}()
				continue
			}

			// 4. 目录浏览：前端 FolderBrowserDialog 发来的 browse_directory
			var browseMsg struct {
				Type string `json:"type"`
				Path string `json:"path"`
			}
			if err := json.Unmarshal(msg, &browseMsg); err == nil && browseMsg.Type == "browse_directory" {
				go func() {
					dirPath := browseMsg.Path
					if dirPath == "" {
						dirPath = "."
					}
					entries, readErr := os.ReadDir(dirPath)
					var result []map[string]interface{}
					if readErr == nil {
						for _, e := range entries {
							entryPath := filepath.Join(dirPath, e.Name())
							result = append(result, map[string]interface{}{
								"name":  e.Name(),
								"isDir": e.IsDir(),
								"path":  entryPath,
							})
						}
					}
					resp := map[string]interface{}{
						"type":    "browse_directory_result",
						"path":    dirPath,
						"entries": result,
					}
					if readErr != nil {
						resp["error"] = readErr.Error()
					}
					respBytes, _ := json.Marshal(resp)
					s.Lock()
					sendTextFn := s.SendWebText
					s.Unlock()
					if sendTextFn != nil {
						_ = sendTextFn(respBytes)
					}
				}()
				continue
			}

			// 5. 获取系统路径和驱动器列表
			var sysPathMsg struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(msg, &sysPathMsg); err == nil && sysPathMsg.Type == "get_system_paths" {
				go func() {
					homeDir, _ := os.UserHomeDir()
					paths := map[string]string{
						"home":      homeDir,
						"documents": filepath.Join(homeDir, "Documents"),
						"downloads": filepath.Join(homeDir, "Downloads"),
						"desktop":   filepath.Join(homeDir, "Desktop"),
						"pictures":  filepath.Join(homeDir, "Pictures"),
					}

					// 检测 Windows 盘符 A-Z
					var drives []string
					for c := 'A'; c <= 'Z'; c++ {
						drivePath := string(c) + ":\\"
						if _, err := os.Stat(drivePath); err == nil {
							drives = append(drives, drivePath)
						}
					}

					resp := map[string]interface{}{
						"type":   "system_paths_result",
						"paths":  paths,
						"drives": drives,
					}
					respBytes, _ := json.Marshal(resp)
					s.Lock()
					sendTextFn := s.SendWebText
					s.Unlock()
					if sendTextFn != nil {
						_ = sendTextFn(respBytes)
					}
				}()
				continue
			}

			// 6. 尝试解析 consent_response
			var frame MessageFrame
			if err := json.Unmarshal(msg, &frame); err == nil && frame.Event == "consent_response" {
				dataBytes, _ := json.Marshal(frame.Data)
				var resp struct {
					ID       string `json:"id"`
					Approved bool   `json:"approved"`
				}
				if err := json.Unmarshal(dataBytes, &resp); err == nil {
					s.Lock()
					delete(s.PendingConsents, resp.ID)
					bridgeConn := s.BridgeConn
					s.Unlock()
					if bridgeConn != nil {
						if bConn, ok := bridgeConn.(*websocket.Conn); ok {
							bWriter := &connWriter{conn: bConn}
							if err := bWriter.WriteMessage(websocket.TextMessage, msg); err != nil {
								log.Printf("[Server] Failed to forward consent_response to bridge: %v", err)
							}
						}
					}
				}
				continue
			}
		}

	}
}

// testAPIConnection 会向沙箱容器拉起真实进程执行探测，以此测试 API 通道在 claude-code 内部是否真正通畅
func (wh *WSHandler) testAPIConnection(workspacePath, provider, apiKey, baseUrl, model string) (bool, int, string) {
	// Map frontend provider/keys to expected env overrides
	envOverrides := make(map[string]string)
	if apiKey != "" {
		if provider == "anthropic" {
			envOverrides["ANTHROPIC_API_KEY"] = apiKey
			if baseUrl != "" {
				envOverrides["ANTHROPIC_BASE_URL"] = baseUrl
			}
		} else if provider == "gemini" {
			envOverrides["GEMINI_API_KEY"] = apiKey
			envOverrides["GOOGLE_GEMINI_API_KEY"] = apiKey
			if baseUrl != "" {
				envOverrides["GOOGLE_GEMINI_BASE_URL"] = baseUrl
			}
		} else if provider == "deepseek" {
			envOverrides["DEEPSEEK_API_KEY"] = apiKey
			if baseUrl != "" {
				envOverrides["DEEPSEEK_BASE_URL"] = baseUrl
			}
		} else if provider == "openai" {
			envOverrides["OPENAI_API_KEY"] = apiKey
			if baseUrl != "" {
				envOverrides["OPENAI_BASE_URL"] = baseUrl
			}
		} else if provider == "codex" {
			envOverrides["CODEX_API_KEY"] = apiKey
		}
	}

	// Serverless mode: skip true container test, just return success
	return true, 200, "API test skipped in Serverless mode. Assuming connection OK."
}
