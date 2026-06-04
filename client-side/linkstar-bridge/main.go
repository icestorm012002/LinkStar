package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type SyncFrame struct {
	Action     string `json:"action"`
	Path       string `json:"path"`
	Content    string `json:"content"`
	Originator string `json:"originator"`
}

var syncJail = make(map[string]time.Time)
var syncJailMu sync.Mutex

// connMu 保护 WebSocket 连接的并发写操作
var connMu sync.Mutex

// safeWriteJSON 线程安全地向 WebSocket 发送 JSON 消息
func safeWriteJSON(conn *websocket.Conn, v interface{}) error {
	connMu.Lock()
	defer connMu.Unlock()
	return conn.WriteJSON(v)
}

// safeWriteMessage 线程安全地向 WebSocket 发送原始消息
func safeWriteMessage(conn *websocket.Conn, messageType int, data []byte) error {
	connMu.Lock()
	defer connMu.Unlock()
	return conn.WriteMessage(messageType, data)
}

type MsgFrame struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

type ConsentRequest struct {
	ResponseChan chan bool
}

type ConsentManager struct {
	mu      sync.Mutex
	pending map[string]*ConsentRequest
}

func NewConsentManager() *ConsentManager {
	return &ConsentManager{pending: make(map[string]*ConsentRequest)}
}

func (cm *ConsentManager) Register(id string) chan bool {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	ch := make(chan bool, 1)
	cm.pending[id] = &ConsentRequest{ResponseChan: ch}
	return ch
}

func (cm *ConsentManager) Resolve(id string, approved bool) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	req, exists := cm.pending[id]
	if exists {
		req.ResponseChan <- approved
		delete(cm.pending, id)
	}
}

func main() {
	serverAddr := flag.String("server", "localhost:8080", "Agent Cloud OS server address")
	workspace := flag.String("workspace", "", "Path to local workspace directory")
	sessionID := flag.String("session", "", "Session ID")
	userID := flag.String("user", "", "User ID")
	flag.Parse()

	if *workspace == "" || *sessionID == "" || *userID == "" {
		log.Fatal("Missing required flags: -workspace, -session, -user")
	}

	absWorkspace, err := filepath.Abs(*workspace)
	if err != nil {
		log.Fatalf("Invalid workspace path: %v", err)
	}

	// Find repo root and write logs to <repoRoot>/logs
	cwd, _ := os.Getwd()
	repoRoot := findRepoRoot(cwd)
	if repoRoot == cwd {
		repoRoot = findRepoRoot(absWorkspace)
	}
	logsDir := filepath.Join(repoRoot, "logs")
	_ = os.MkdirAll(logsDir, 0755)
	logFile, logErr := os.OpenFile(filepath.Join(logsDir, "bridge.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if logErr == nil {
		mw := io.MultiWriter(os.Stdout, logFile)
		log.SetOutput(mw)
		defer logFile.Close()
	}

	log.Printf("[Bridge] Starting local daemon for workspace: %s", absWorkspace)
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt, syscall.SIGTERM)

	token := fmt.Sprintf("token_%s_%s", *userID, *sessionID)
	u := url.URL{Scheme: "ws", Host: *serverAddr, Path: "/ws", RawQuery: "session_id=" + *sessionID + "&user_id=" + *userID + "&token=" + token + "&workspace_path=" + absWorkspace + "&client_type=bridge"}
	log.Printf("[Bridge] Connecting to server: %s", u.String())

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatalf("Connection failed: %v", err)
	}
	defer conn.Close()

	// 自动探测并上报本地宿主机开发工具环境
	availableTools := discoverHostEnv()
	log.Printf("[Bridge] Host tools detected: %v", availableTools)
	if err := safeWriteJSON(conn, MsgFrame{Event: "host_env", Data: availableTools}); err != nil {
		log.Printf("[Bridge] Failed to send host_env: %v", err)
	}

	safetyFilter := NewSafetyFilter(absWorkspace)
	consentMgr := NewConsentManager()

	watcher := NewFileWatcher(absWorkspace, func(events []WatcherEvent) {
		var frames []SyncFrame
		for _, e := range events {
			relPath, _ := filepath.Rel(absWorkspace, e.Path)

			// 防环防抖白名单过滤
			syncJailMu.Lock()
			lastSyncTime, inJail := syncJail[e.Path]
			syncJailMu.Unlock()
			if inJail {
				info, err := os.Stat(e.Path)
				if err == nil && !info.ModTime().After(lastSyncTime) {
					continue // 跳过本变更，因其由同步写入本身触发
				}
			}

			content := ""
			if e.Action != "REMOVE" {
				info, err := os.Stat(e.Path)
				if err == nil && info.Size() <= 10*1024*1024 {
					data, err := os.ReadFile(e.Path)
					if err == nil {
						content = base64.StdEncoding.EncodeToString(data)
					}
				} else if err == nil {
					log.Printf("[Sync Skip] File %s too large (%d MB), sending metadata placeholder only", relPath, info.Size()/(1024*1024))
				}
			}
			frames = append(frames, SyncFrame{Action: e.Action, Path: relPath, Content: content, Originator: "bridge"})
		}
		if len(frames) > 0 {
			if err := safeWriteJSON(conn, MsgFrame{Event: "file_sync_batch", Data: frames}); err != nil {
				log.Printf("[Bridge] Failed to send file_sync_batch: %v", err)
			}
		}
	})
	_ = watcher.Start()
	defer watcher.Stop()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				log.Printf("[Bridge] Connection closed: %v", err)
				return
			}
			var frame MsgFrame
			if err := json.Unmarshal(message, &frame); err != nil {
				continue
			}
			if frame.Event == "file_sync" {
				dataBytes, _ := json.Marshal(frame.Data)
				var syncPayload SyncFrame
				if err := json.Unmarshal(dataBytes, &syncPayload); err == nil {
					whWriteFile(absWorkspace, syncPayload)
				}
			} else if frame.Event == "file_sync_batch" {
				dataBytes, _ := json.Marshal(frame.Data)
				var syncPayloads []SyncFrame
				if err := json.Unmarshal(dataBytes, &syncPayloads); err == nil {
					for _, p := range syncPayloads {
						whWriteFile(absWorkspace, p)
					}
				}
			} else if frame.Event == "pull_file_req" {
				dataBytes, _ := json.Marshal(frame.Data)
				var req struct {
					Path string `json:"path"`
				}
				if err := json.Unmarshal(dataBytes, &req); err == nil {
					log.Printf("[Bridge] Received pull request for big file: %s", req.Path)
					go streamFileChunks(conn, absWorkspace, req.Path)
				}
			} else if frame.Event == "exec_cmd" {
				cmdString, ok := frame.Data.(string)
				if ok {
					whExecCmd(conn, absWorkspace, cmdString, safetyFilter, consentMgr)
				}
			} else if frame.Event == "consent_response" {
				dataBytes, _ := json.Marshal(frame.Data)
				var resp struct {
					ID       string `json:"id"`
					Approved bool   `json:"approved"`
				}
				if err := json.Unmarshal(dataBytes, &resp); err == nil {
					consentMgr.Resolve(resp.ID, resp.Approved)
				}
			}
		}
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			err := conn.WriteMessage(websocket.PingMessage, nil)
			if err != nil {
				return
			}
		case <-interrupt:
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			return
		}
	}
}

func whWriteFile(root string, p SyncFrame) {
	target := filepath.Join(root, p.Path)
	// #11 加固路径穿越检查：使用 Clean+HasPrefix 代替字符串前缀
	cleanTarget := filepath.Clean(target)
	cleanRoot := filepath.Clean(root)
	if !strings.HasPrefix(cleanTarget, cleanRoot+string(filepath.Separator)) && cleanTarget != cleanRoot {
		log.Printf("[Jail Violation] Rejected bridge file sync path: %s (resolved: %s)", p.Path, cleanTarget)
		return
	}
	if p.Action == "REMOVE" {
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			log.Printf("[Bridge] Failed to remove synced file %s: %v", p.Path, err)
		}
	} else {
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			log.Printf("[Bridge] Failed to create directory for %s: %v", p.Path, err)
			return
		}
		var writeData []byte
		if p.Content != "" {
			var decErr error
			writeData, decErr = base64.StdEncoding.DecodeString(p.Content)
			if decErr != nil {
				log.Printf("[Bridge] Failed to decode base64 content for %s: %v", p.Path, decErr)
				return
			}
		}
		if err := os.WriteFile(target, writeData, 0600); err != nil {
			log.Printf("[Bridge] Failed to write synced file %s: %v", p.Path, err)
			return
		}
		// #1 防环：写入 syncJail，阻止 FileWatcher 将此次写入再次发回 Server
		info, err := os.Stat(target)
		if err == nil {
			syncJailMu.Lock()
			syncJail[target] = info.ModTime()
			syncJailMu.Unlock()
		}
	}
}

func whExecCmd(conn *websocket.Conn, root, cmdString string, filter *SafetyFilter, cm *ConsentManager) {
	log.Printf("[Bridge] Validating command: %s", cmdString)
	if err := filter.ValidateCommand(cmdString); err != nil {
		secErr, ok := err.(*SecurityError)
		if ok && secErr.Type == "NEEDS_CONSENT" {
			reqID := fmt.Sprintf("req-%d", time.Now().UnixNano())
			log.Printf("[Bridge] Command needs consent, requesting ID: %s", reqID)
			if err := safeWriteJSON(conn, MsgFrame{Event: "consent_request", Data: map[string]string{"id": reqID, "command": cmdString}}); err != nil {
				log.Printf("[Bridge] Failed to send consent_request: %v", err)
				return
			}
			responseChan := cm.Register(reqID)
			select {
			case approved := <-responseChan:
				if !approved {
					_ = safeWriteJSON(conn, MsgFrame{Event: "cmd_output", Data: "Safety Error: Command rejected by user\n"})
					return
				}
			case <-time.After(60 * time.Second):
				_ = safeWriteJSON(conn, MsgFrame{Event: "cmd_output", Data: "Safety Error: Command approval timed out\n"})
				return
			}
		} else {
			_ = safeWriteJSON(conn, MsgFrame{Event: "cmd_output", Data: fmt.Sprintf("Safety Error: %v\n", err)})
			return
		}
	}
	// #9 跨平台命令执行
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", cmdString)
	} else {
		cmd = exec.Command("sh", "-c", cmdString)
	}
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		_ = safeWriteJSON(conn, MsgFrame{Event: "cmd_output", Data: fmt.Sprintf("Execution Error: %v\nOutput: %s", err, string(output))})
		return
	}
	_ = safeWriteJSON(conn, MsgFrame{Event: "cmd_output", Data: string(output)})
}

func discoverHostEnv() []string {
	var available []string
	tools := []struct {
		name string
		arg  string
	}{
		{"go", "version"},
		{"node", "--version"},
		{"npm", "--version"},
		{"python", "--version"},
		{"pip", "--version"},
		{"git", "--version"},
		{"docker", "--version"},
		{"rustc", "--version"},
	}
	for _, t := range tools {
		cmd := exec.Command(t.name, t.arg)
		if err := cmd.Run(); err == nil {
			available = append(available, t.name)
		}
	}
	return available
}

// #2 实现 streamFileChunks — 大文件按需分块流式传输
func streamFileChunks(conn *websocket.Conn, root, relPath string) {
	fullPath := filepath.Join(root, relPath)
	// 安全校验：防止路径穿越
	cleanPath := filepath.Clean(fullPath)
	cleanRoot := filepath.Clean(root)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		log.Printf("[Bridge] streamFileChunks: path traversal rejected: %s", relPath)
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		log.Printf("[Bridge] streamFileChunks: failed to open %s: %v", relPath, err)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		log.Printf("[Bridge] streamFileChunks: failed to stat %s: %v", relPath, err)
		return
	}

	const chunkSize = 1024 * 1024 // 1MB
	total := int((info.Size() + chunkSize - 1) / chunkSize)
	if total == 0 {
		total = 1
	}

	log.Printf("[Bridge] Streaming %s (%d bytes, %d chunks)", relPath, info.Size(), total)
	buf := make([]byte, chunkSize)
	for i := 0; i < total; i++ {
		n, readErr := file.Read(buf)
		if readErr != nil && readErr != io.EOF {
			log.Printf("[Bridge] streamFileChunks: read error at chunk %d: %v", i, readErr)
			break
		}
		content := ""
		if n > 0 {
			content = base64.StdEncoding.EncodeToString(buf[:n])
		}
		if err := safeWriteJSON(conn, MsgFrame{
			Event: "file_chunk",
			Data: map[string]interface{}{
				"path":         relPath,
				"chunk_index":  i,
				"total_chunks": total,
				"content":      content,
			},
		}); err != nil {
			log.Printf("[Bridge] streamFileChunks: write error at chunk %d: %v", i, err)
			break
		}
		if readErr == io.EOF {
			break
		}
	}
	log.Printf("[Bridge] Finished streaming %s", relPath)
}

func findRepoRoot(startDir string) string {
	dir := startDir
	for {
		appsPath := filepath.Join(dir, "apps")
		packagesPath := filepath.Join(dir, "packages")

		fi1, err1 := os.Stat(appsPath)
		fi2, err2 := os.Stat(packagesPath)
		if err1 == nil && fi1.IsDir() && err2 == nil && fi2.IsDir() {
			return dir
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return startDir
}
