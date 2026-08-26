package plugin

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/security"
)

// ExternalHTTPPlugin 外部独立进程 / 微服务 / Webhook 驱动插件
type ExternalHTTPPlugin struct {
	manifest    Manifest
	endpointURL string
	secretToken string
	config      map[string]interface{}
	client      *http.Client
}

// NewExternalHTTPPlugin 实例化外部 HTTP 插件
func NewExternalHTTPPlugin(manifest Manifest, endpointURL string, secretToken string) *ExternalHTTPPlugin {
	return &ExternalHTTPPlugin{
		manifest:    manifest,
		endpointURL: strings.TrimRight(endpointURL, "/"),
		secretToken: secretToken,
		config:      make(map[string]interface{}),
		client:      security.NewSafeHTTPClient(30 * time.Second),
	}
}

func (p *ExternalHTTPPlugin) Manifest() Manifest {
	return p.manifest
}

func (p *ExternalHTTPPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *ExternalHTTPPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *ExternalHTTPPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *ExternalHTTPPlugin) sendRequest(ctx context.Context, path string, payload interface{}, out interface{}) error {
	if p.endpointURL == "" {
		return fmt.Errorf("plugin %s endpoint url is not configured", p.manifest.ID)
	}

	url := p.endpointURL + path
	var bodyReader io.Reader
	var rawBody []byte
	var err error

	if payload != nil {
		rawBody, err = json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal request payload: %w", err)
		}
		bodyReader = bytes.NewReader(rawBody)
	}

	method := "POST"
	if payload == nil {
		method = "GET"
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "MetaFusion-PluginKernel/1.0 ("+p.manifest.ID+")")
	req.Header.Set("X-MetaFusion-Plugin-ID", p.manifest.ID)

	if p.secretToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.secretToken)
		if len(rawBody) > 0 {
			mac := hmac.New(sha256.New, []byte(p.secretToken))
			mac.Write(rawBody)
			sig := hex.EncodeToString(mac.Sum(nil))
			req.Header.Set("X-MetaFusion-Signature", "sha256="+sig)
		}
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("external plugin returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if out != nil {
		if byteOut, ok := out.(*[]byte); ok {
			*byteOut, err = io.ReadAll(resp.Body)
			return err
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}

	return nil
}

func (p *ExternalHTTPPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	var remoteHealth struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}

	err := p.sendRequest(ctx, "/health", nil, &remoteHealth)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		return HealthStatus{
			Status:      "unhealthy",
			Message:     err.Error(),
			LatencyMs:   latency,
			LastChecked: time.Now(),
		}
	}

	st := remoteHealth.Status
	if st == "" {
		st = "healthy"
	}
	msg := remoteHealth.Message
	if msg == "" {
		msg = "External plugin responding normally"
	}

	return HealthStatus{
		Status:      st,
		Message:     msg,
		LatencyMs:   latency,
		LastChecked: time.Now(),
	}
}

// ImporterPlugin implementation
func (p *ExternalHTTPPlugin) SupportedSources() []string {
	return p.manifest.SupportedSources
}

func (p *ExternalHTTPPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	for _, src := range p.manifest.SupportedSources {
		if strings.Contains(clean, strings.ToLower(src)) {
			return true
		}
	}
	return false
}

func (p *ExternalHTTPPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	var resp importer.PreviewResponse
	err := p.sendRequest(ctx, "/preview", req, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// MetadataProviderPlugin implementation
func (p *ExternalHTTPPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	var resp map[string]interface{}
	payload := map[string]string{
		"source":      source,
		"external_id": externalID,
	}
	err := p.sendRequest(ctx, "/metadata", payload, &resp)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (p *ExternalHTTPPlugin) ValidateExternalID(source string, externalID string) bool {
	return strings.TrimSpace(externalID) != ""
}

// ExportPlugin implementation
func (p *ExternalHTTPPlugin) Format() string {
	if len(p.manifest.SupportedFormats) > 0 {
		return p.manifest.SupportedFormats[0]
	}
	return "custom"
}

func (p *ExternalHTTPPlugin) MimeType() string {
	return "application/json"
}

func (p *ExternalHTTPPlugin) FileExtension() string {
	return ".json"
}

func (p *ExternalHTTPPlugin) ExportWork(ctx context.Context, work *models.Work, extra map[string]interface{}) ([]byte, error) {
	payload := map[string]interface{}{
		"work":  work,
		"extra": extra,
	}
	var outBytes []byte
	err := p.sendRequest(ctx, "/export", payload, &outBytes)
	if err != nil {
		return nil, err
	}
	return outBytes, nil
}

// NotifierPlugin implementation
func (p *ExternalHTTPPlugin) SupportedEvents() []string {
	if len(p.manifest.SupportedEvents) > 0 {
		return p.manifest.SupportedEvents
	}
	return []string{"*"}
}

func (p *ExternalHTTPPlugin) Notify(ctx context.Context, event string, payload map[string]interface{}) error {
	data := map[string]interface{}{
		"event":     event,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"payload":   payload,
	}
	return p.sendRequest(ctx, "/notify", data, nil)
}
