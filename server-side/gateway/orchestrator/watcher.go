package orchestrator

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"sync"
	"time"
)

var ignoredDirs = map[string]bool{
	"node_modules": true,
	"vendor":       true,
	"target":       true,
	"build":        true,
	"dist":         true,
	"bin":          true,
	"obj":          true,
	".git":         true,
	".claude_home": true,
	".scratch":     true,
	".agents":      true,
}

type WatcherEvent struct {
	Action  string
	RelPath string
}

type WorkspaceWatcher struct {
	dirPath       string
	mu            sync.Mutex
	fileModTimes  map[string]time.Time
	onChangeBatch func(events []WatcherEvent)
	stopChan      chan struct{}
}

func NewWorkspaceWatcher(dirPath string, onChangeBatch func(events []WatcherEvent)) *WorkspaceWatcher {
	return &WorkspaceWatcher{
		dirPath:       dirPath,
		fileModTimes:  make(map[string]time.Time),
		onChangeBatch: onChangeBatch,
		stopChan:      make(chan struct{}),
	}
}

func (ww *WorkspaceWatcher) Start() error {
	err := ww.scan()
	if err != nil {
		return fmt.Errorf("initial scan failed: %w", err)
	}

	ticker := time.NewTicker(1 * time.Second)
	go func() {
		for {
			select {
			case <-ww.stopChan:
				ticker.Stop()
				return
			case <-ticker.C:
				_ = ww.scan()
			}
		}
	}()

	return nil
}

func (ww *WorkspaceWatcher) Stop() {
	close(ww.stopChan)
}

func (ww *WorkspaceWatcher) scan() error {
	ww.mu.Lock()
	defer ww.mu.Unlock()

	currentFiles := make(map[string]time.Time)
	var events []WatcherEvent

	err := filepath.WalkDir(ww.dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if (name != "." && name != "" && name[0] == '.') || ignoredDirs[name] {
				return filepath.SkipDir
			}
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}

		modTime := info.ModTime()
		currentFiles[path] = modTime

		relPath, err := filepath.Rel(ww.dirPath, path)
		if err != nil {
			return nil
		}

		oldModTime, exists := ww.fileModTimes[path]
		if !exists {
			events = append(events, WatcherEvent{Action: "CREATE", RelPath: relPath})
		} else if modTime.After(oldModTime) {
			events = append(events, WatcherEvent{Action: "WRITE", RelPath: relPath})
		}

		return nil
	})

	if err != nil {
		return err
	}

	for path := range ww.fileModTimes {
		if _, exists := currentFiles[path]; !exists {
			relPath, err := filepath.Rel(ww.dirPath, path)
			if err == nil {
				events = append(events, WatcherEvent{Action: "REMOVE", RelPath: relPath})
			}
		}
	}

	ww.fileModTimes = currentFiles

	if len(events) > 0 {
		ww.onChangeBatch(events)
	}
	return nil
}
