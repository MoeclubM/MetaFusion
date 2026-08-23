package plugin

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/metafusion/metafusion-app/internal/models"
)

// ── 1. Webhook Notifier 原生通知插件 ──

type WebhookNotifierPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewWebhookNotifierPlugin() Plugin {
	return &WebhookNotifierPlugin{
		config: make(map[string]interface{}),
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (p *WebhookNotifierPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "webhook_notifier",
		Name:        "Webhook 事件通知广播器",
		Version:     "1.0.0",
		Description: "系统元数据创建、审核合并与馆藏入库事件实时推送，支持 Discord、飞书、企业微信、Telegram 与自定义 Webhook",
		Author:      "MetaFusion Core",
		Icon:        "Bell",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapNotification,
		},
		SupportedEvents: []string{"work.created", "work.updated", "work.deleted", "revision.applied", "review.approved", "import.completed"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "webhook_urls",
					Label:        "Webhook 目标地址 (一行一个或逗号分隔)",
					Type:        "textarea",
					DefaultValue: "",
					Description:  "例如 https://discord.com/api/webhooks/... 或 https://open.feishu.cn/open-apis/bot/v2/hook/...",
					Required:     false,
				},
				{
					Key:          "secret_token",
					Label:        "HMAC 签名秘钥 (Secret Token)",
					Type:        "password",
					DefaultValue: "",
					Description:  "可选。用于在请求头发送 X-MetaFusion-Signature: sha256=... 验签",
					Required:     false,
				},
				{
					Key:          "payload_format",
					Label:        "消息体渲染格式",
					Type:        "select",
					DefaultValue: "generic_json",
					Description:  "通用 JSON / Discord 嵌入卡片 / 飞书富文本卡片",
					Required:     false,
					Options:      []string{"generic_json", "discord", "feishu"},
				},
			},
		},
	}
}

func (p *WebhookNotifierPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *WebhookNotifierPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *WebhookNotifierPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *WebhookNotifierPlugin) getWebhookURLs() []string {
	var list []string
	raw, ok := p.config["webhook_urls"].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return list
	}

	lines := strings.Split(raw, "\n")
	for _, l := range lines {
		for _, part := range strings.Split(l, ",") {
			trimmed := strings.TrimSpace(part)
			if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
				list = append(list, trimmed)
			}
		}
	}
	return list
}

func (p *WebhookNotifierPlugin) HealthCheck(ctx context.Context) HealthStatus {
	urls := p.getWebhookURLs()
	if len(urls) == 0 {
		return HealthStatus{
			Status:      "warning",
			Message:     "No webhook URLs configured",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	}
	return HealthStatus{
		Status:      "healthy",
		Message:     fmt.Sprintf("%d webhook endpoint(s) ready", len(urls)),
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *WebhookNotifierPlugin) SupportedEvents() []string {
	return []string{"work.created", "work.updated", "work.deleted", "revision.applied", "review.approved", "import.completed"}
}

func (p *WebhookNotifierPlugin) Notify(ctx context.Context, event string, payload map[string]interface{}) error {
	urls := p.getWebhookURLs()
	if len(urls) == 0 {
		return nil
	}

	secret, _ := p.config["secret_token"].(string)
	format, _ := p.config["payload_format"].(string)
	if format == "" {
		format = "generic_json"
	}

	for _, webhookURL := range urls {
		var reqBody []byte
		var err error

		if format == "discord" || strings.Contains(webhookURL, "discord.com") {
			// Discord Webhook Payload
			title := fmt.Sprintf("MetaFusion Event: %s", event)
			desc := "An event occurred in the catalog"
			if t, ok := payload["title"].(string); ok && t != "" {
				desc = fmt.Sprintf("Work: **%s**", t)
			}
			discordData := map[string]interface{}{
				"content": fmt.Sprintf("📢 **MetaFusion Catalog Notification** [`%s`]", event),
				"embeds": []map[string]interface{}{
					{
						"title":       title,
						"description": desc,
						"color":       16753920, // amber
						"timestamp":   time.Now().UTC().Format(time.RFC3339),
						"footer": map[string]string{
							"text": "MetaFusion Webhook Plugin",
						},
					},
				},
			}
			reqBody, err = json.Marshal(discordData)
		} else if format == "feishu" || strings.Contains(webhookURL, "feishu.cn") {
			// 飞书机器人 Webhook Payload
			title := fmt.Sprintf("MetaFusion 事件通知: %s", event)
			feishuData := map[string]interface{}{
				"msg_type": "text",
				"content": map[string]string{
					"text": fmt.Sprintf("[%s] %s\n时间: %s", title, event, time.Now().Format("2006-01-02 15:04:05")),
				},
			}
			reqBody, err = json.Marshal(feishuData)
		} else {
			// 通用 JSON Payload
			data := map[string]interface{}{
				"event":     event,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
				"payload":   payload,
			}
			reqBody, err = json.Marshal(data)
		}

		if err != nil {
			continue
		}

		req, err := http.NewRequestWithContext(ctx, "POST", webhookURL, bytes.NewReader(reqBody))
		if err != nil {
			continue
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "MetaFusion-WebhookNotifier/1.0")
		if secret != "" {
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write(reqBody)
			sig := hex.EncodeToString(mac.Sum(nil))
			req.Header.Set("X-MetaFusion-Signature", "sha256="+sig)
		}

		resp, err := p.client.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}

	return nil
}

// ── 2. LRM JSON-LD Exporter 原生导出插件 ──

type JSONLDExporterPlugin struct {
	config map[string]interface{}
}

func NewJSONLDExporterPlugin() Plugin {
	return &JSONLDExporterPlugin{
		config: make(map[string]interface{}),
	}
}

func (p *JSONLDExporterPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "jsonld_exporter",
		Name:        "LRM JSON-LD / RDF 语义网导出器",
		Version:     "1.0.0",
		Description: "将 MetaFusion 母体作品、版本规格与演职员关系导出为 W3C Schema.org 与 IFLA LRM 互操作规范 JSON-LD 格式",
		Author:      "MetaFusion Core",
		Icon:        "Share2",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapExport,
		},
		SupportedFormats: []string{"jsonld", "json"},
	}
}

func (p *JSONLDExporterPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *JSONLDExporterPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *JSONLDExporterPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *JSONLDExporterPlugin) HealthCheck(ctx context.Context) HealthStatus {
	return HealthStatus{
		Status:      "healthy",
		Message:     "JSON-LD LRM Semantic Exporter ready",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *JSONLDExporterPlugin) Format() string {
	return "jsonld"
}

func (p *JSONLDExporterPlugin) MimeType() string {
	return "application/ld+json"
}

func (p *JSONLDExporterPlugin) FileExtension() string {
	return ".jsonld"
}

func (p *JSONLDExporterPlugin) ExportWork(ctx context.Context, work *models.Work, extra map[string]interface{}) ([]byte, error) {
	if work == nil {
		return nil, fmt.Errorf("work is nil")
	}

	doc := map[string]interface{}{
		"@context": map[string]string{
			"@vocab": "https://schema.org/",
			"lrm":    "http://iflastandards.info/ns/lrm/lrmer/",
		},
		"@type":       "CreativeWork",
		"@id":         fmt.Sprintf("urn:metafusion:work:%s", work.ID),
		"name":        work.Title,
		"alternateName": work.OriginalTitle,
		"description": work.Summary,
		"inLanguage":  work.OriginalLanguage,
		"datePublished": work.ReleaseDate,
	}

	if work.CoverImageURL != "" {
		doc["image"] = work.CoverImageURL
	}

	if extra != nil {
		if artists, ok := extra["artists"]; ok {
			doc["author"] = artists
		}
		if releases, ok := extra["releases"]; ok {
			doc["workExample"] = releases
		}
	}

	return json.MarshalIndent(doc, "", "  ")
}

// ── 3. MusicBrainz Picard Exporter 原生导出插件 ──

type PicardExporterPlugin struct {
	config map[string]interface{}
}

func NewPicardExporterPlugin() Plugin {
	return &PicardExporterPlugin{
		config: make(map[string]interface{}),
	}
}

func (p *PicardExporterPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "picard_exporter",
		Name:        "MusicBrainz Picard 音乐元数据导出器",
		Version:     "1.0.0",
		Description: "导出用于 MusicBrainz Picard、Foobar2000、Beets 等数字音乐管理器的专辑和曲目标签 JSON 规范包",
		Author:      "MetaFusion Core",
		Icon:        "Music",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapExport,
		},
		SupportedFormats: []string{"picard", "json"},
	}
}

func (p *PicardExporterPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *PicardExporterPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *PicardExporterPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *PicardExporterPlugin) HealthCheck(ctx context.Context) HealthStatus {
	return HealthStatus{
		Status:      "healthy",
		Message:     "MusicBrainz Picard Metadata Exporter ready",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *PicardExporterPlugin) Format() string {
	return "picard"
}

func (p *PicardExporterPlugin) MimeType() string {
	return "application/json"
}

func (p *PicardExporterPlugin) FileExtension() string {
	return ".picard.json"
}

func (p *PicardExporterPlugin) ExportWork(ctx context.Context, work *models.Work, extra map[string]interface{}) ([]byte, error) {
	if work == nil {
		return nil, fmt.Errorf("work is nil")
	}

	pkg := map[string]interface{}{
		"schema":           "musicbrainz-picard/v1",
		"album":            work.Title,
		"album_original":   work.OriginalTitle,
		"date":             work.ReleaseDate,
		"metafusion_id":    work.ID.String(),
		"discs":            []interface{}{},
	}

	if extra != nil {
		if releases, ok := extra["releases"]; ok {
			pkg["releases"] = releases
		}
	}

	return json.MarshalIndent(pkg, "", "  ")
}
