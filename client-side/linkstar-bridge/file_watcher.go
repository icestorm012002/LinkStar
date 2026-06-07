package main

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
	Action string
	Path   string
}

type FileWatcher struct {
	workspacePath string
	mu            sync.Mutex
	fileModTimes  map[string]time.Time
	onChangeBatch func(events []WatcherEvent)
	stopChan      chan struct{}
}

func NewFileWatcher(workspacePath string, onChangeBatch func(events []WatcherEvent)) *FileWatcher {
	return &FileWatcher{
		workspacePath: workspacePath,
		fileModTimes:  make(map[string]time.Time),
		onChangeBatch: onChangeBatch,
		stopChan:      make(chan struct{}),
	}
}

func (fw *FileWatcher) Start() error {
	err := fw.scan()
	if err != nil {
		return fmt.Errorf("initial scan failed: %w", err)
	}

	ticker := time.NewTicker(1 * time.Second)
	go func() {
		for {
			select {
			case <-fw.stopChan:
				ticker.Stop()
				return
			case <-ticker.C:
				_ = fw.scan()
			}
		}
	}()

	return nil
}

func (fw *FileWatcher) Stop() {
	close(fw.stopChan)
}

func (fw *FileWatcher) scan() error {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	currentFiles := make(map[string]time.Time)
	var events []WatcherEvent

	err := filepath.WalkDir(fw.workspacePath, func(path string, d fs.DirEntry, err error) error {
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

		oldModTime, exists := fw.fileModTimes[path]
		if !exists {
			events = append(events, WatcherEvent{Action: "CREATE", Path: path})
		} else if modTime.After(oldModTime) {
			events = append(events, WatcherEvent{Action: "WRITE", Path: path})
		}

		return nil
	})

	if err != nil {
		return err
	}

	for path := range fw.fileModTimes {
		if _, exists := currentFiles[path]; !exists {
			events = append(events, WatcherEvent{Action: "REMOVE", Path: path})
		}
	}

	fw.fileModTimes = currentFiles

	if len(events) > 0 {
		fw.onChangeBatch(events)
	}
	return nil
}
