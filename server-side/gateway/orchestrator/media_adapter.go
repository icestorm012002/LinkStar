package orchestrator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type MediaAdapter struct {
	Client *http.Client
}

func NewMediaAdapter() *MediaAdapter {
	return &MediaAdapter{
		Client: &http.Client{
			Timeout: 180 * time.Second,
		},
	}
}

// GenerateImage calls the configured text-to-image API.
func (ma *MediaAdapter) GenerateImage(ctx context.Context, prompt, size string) ([]byte, error) {
	apiURL := os.Getenv("IMAGE_GEN_URL")
	apiKey := os.Getenv("IMAGE_GEN_KEY")
	if apiURL == "" || apiKey == "" {
		return nil, fmt.Errorf("IMAGE_GEN_URL or IMAGE_GEN_KEY environment variable is not configured")
	}

	payload := map[string]interface{}{
		"prompt":      prompt,
		"size":        size,
		"num_outputs": 1,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return ma.sendRequest(ctx, apiURL, apiKey, body)
}

// EditImage calls the configured image editing API.
func (ma *MediaAdapter) EditImage(ctx context.Context, originalImageBase64, prompt string) ([]byte, error) {
	apiURL := os.Getenv("IMAGE_EDIT_URL")
	apiKey := os.Getenv("IMAGE_EDIT_KEY")
	if apiURL == "" || apiKey == "" {
		return nil, fmt.Errorf("IMAGE_EDIT_URL or IMAGE_EDIT_KEY environment variable is not configured")
	}

	payload := map[string]interface{}{
		"image":  originalImageBase64,
		"prompt": prompt,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return ma.sendRequest(ctx, apiURL, apiKey, body)
}

// GenerateVideo calls the configured text-to-video API.
func (ma *MediaAdapter) GenerateVideo(ctx context.Context, prompt string, durationSec int) ([]byte, error) {
	apiURL := os.Getenv("VIDEO_GEN_URL")
	apiKey := os.Getenv("VIDEO_GEN_KEY")
	if apiURL == "" || apiKey == "" {
		return nil, fmt.Errorf("VIDEO_GEN_URL or VIDEO_GEN_KEY environment variable is not configured")
	}

	payload := map[string]interface{}{
		"prompt":       prompt,
		"duration_sec": durationSec,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return ma.sendRequest(ctx, apiURL, apiKey, body)
}

func (ma *MediaAdapter) sendRequest(ctx context.Context, endpoint, apiKey string, requestBody []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(requestBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))

	resp, err := ma.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("model api returned non-ok status: %d, body: %s", resp.StatusCode, string(errBody))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return data, nil
}
