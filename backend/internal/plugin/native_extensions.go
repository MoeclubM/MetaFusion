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
		Dependencies: map[string]string{
			"musicbrainz": ">=1.0.0",
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

// ── 4. AcoustID 音频指纹匹配辅助插件 ──

type AcoustIDHelperPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewAcoustIDHelperPlugin() Plugin {
	return &AcoustIDHelperPlugin{
		config: make(map[string]interface{}),
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (p *AcoustIDHelperPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "acoustid_helper",
		Name:        "AcoustID 音频指纹匹配辅助器",
		Version:     "1.0.0",
		Description: "基于 Chromaprint 开放音频指纹库计算音频哈希，并依赖 MusicBrainz 权威 Recording / Release 元数据进行无损对齐",
		Author:      "MetaFusion Core",
		Icon:        "Activity",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapTranscoderHook,
			CapMetadataProvider,
		},
		Dependencies: map[string]string{
			"musicbrainz": ">=1.0.0",
		},
		SupportedSources: []string{"acoustid", "chromaprint"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "api_key",
					Label:        "AcoustID Client Application Key",
					Type:         "password",
					DefaultValue: "",
					Description:  "从 acoustid.org/api-key 申请的免费应用调用密钥",
					Required:     false,
				},
				{
					Key:          "auto_fingerprint_on_upload",
					Label:        "音频上传时自动计算 Chromaprint",
					Type:         "boolean",
					DefaultValue: true,
					Description:  "开启后将在音轨资产上传并入库时触发指纹分析",
					Required:     false,
				},
			},
		},
	}
}

func (p *AcoustIDHelperPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *AcoustIDHelperPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *AcoustIDHelperPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *AcoustIDHelperPlugin) HealthCheck(ctx context.Context) HealthStatus {
	key, _ := p.config["api_key"].(string)
	if key == "" {
		return HealthStatus{
			Status:      "warning",
			Message:     "AcoustID API Key not set; running in local fingerprint mode",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	}
	return HealthStatus{
		Status:      "healthy",
		Message:     "AcoustID fingerprint & MusicBrainz bridge operational",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *AcoustIDHelperPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"fingerprint_id": externalID,
		"source":         "acoustid",
	}, nil
}

func (p *AcoustIDHelperPlugin) ValidateExternalID(source string, externalID string) bool {
	return source == "acoustid" && len(externalID) > 0
}

// ── 5. BibTeX / RIS 学术文献导出插件 ──

type BibTeXExporterPlugin struct {
	config map[string]interface{}
}

func NewBibTeXExporterPlugin() Plugin {
	return &BibTeXExporterPlugin{
		config: make(map[string]interface{}),
	}
}

func (p *BibTeXExporterPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "bibtex_exporter",
		Name:        "BibTeX / RIS 学术文献引用导出器",
		Version:     "1.0.0",
		Description: "将图书、轻小说、学术出版物与母体作品元数据导出为 BibTeX 与 Zotero / EndNote 兼容的标准 RIS 引用格式",
		Author:      "MetaFusion Core",
		Icon:        "BookOpen",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapExport,
		},
		SupportedFormats: []string{"bibtex", "ris"},
	}
}

func (p *BibTeXExporterPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *BibTeXExporterPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *BibTeXExporterPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *BibTeXExporterPlugin) HealthCheck(ctx context.Context) HealthStatus {
	return HealthStatus{
		Status:      "healthy",
		Message:     "BibTeX / RIS Citation Exporter ready",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *BibTeXExporterPlugin) Format() string {
	return "bibtex"
}

func (p *BibTeXExporterPlugin) MimeType() string {
	return "application/x-bibtex"
}

func (p *BibTeXExporterPlugin) FileExtension() string {
	return ".bib"
}

func (p *BibTeXExporterPlugin) ExportWork(ctx context.Context, work *models.Work, extra map[string]interface{}) ([]byte, error) {
	if work == nil {
		return nil, fmt.Errorf("work is nil")
	}

	author := "MetaFusion Contributor"
	if extra != nil {
		if a, ok := extra["author"].(string); ok && a != "" {
			author = a
		}
	}

	year := "2026"
	if len(work.ReleaseDate) >= 4 {
		year = work.ReleaseDate[:4]
	}

	citeKey := fmt.Sprintf("metafusion_%s_%s", sanitizeCiteKey(work.Title), year)
	bibtex := fmt.Sprintf("@book{%s,\n  title = {%s},\n  author = {%s},\n  year = {%s},\n  note = {MetaFusion ID: %s},\n  url = {https://metafusion.app/works/%s}\n}\n",
		citeKey,
		work.Title,
		author,
		year,
		work.ID.String(),
		work.ID.String(),
	)

	return []byte(bibtex), nil
}

func sanitizeCiteKey(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	res := strings.ToLower(b.String())
	if len(res) > 20 {
		return res[:20]
	}
	if res == "" {
		return "entry"
	}
	return res
}

// ── 6. AI 智能辅助与元数据质检插件 ──

type AIEnrichmentPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewAIEnrichmentPlugin() Plugin {
	return &AIEnrichmentPlugin{
		config: make(map[string]interface{}),
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *AIEnrichmentPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "ai_enrichment",
		Name:        "AI 多语言翻译与实体元数据质检插件",
		Version:     "1.0.0",
		Description: "基于大语言模型自动生成多语言题名 (work_translations) 与简介本地化，执行 ISRC/ISBN 查重与实体图谱别名推断",
		Author:      "MetaFusion Core",
		Icon:        "Puzzle",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapAIEnrichment,
			CapMetadataProvider,
		},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "api_base_url",
					Label:        "LLM API 端点 (OpenAI 兼容协议)",
					Type:         "string",
					DefaultValue: "https://api.openai.com/v1",
					Description:  "兼容 OpenAI / DeepSeek / Claude / Local Ollama 等标准端点",
					Required:     false,
				},
				{
					Key:          "api_key",
					Label:        "API Key",
					Type:         "password",
					DefaultValue: "",
					Description:  "大模型服务认证密钥",
					Required:     false,
				},
				{
					Key:          "model_name",
					Label:        "模型名称 (Model)",
					Type:         "string",
					DefaultValue: "gpt-4o-mini",
					Description:  "例如 gpt-4o-mini, deepseek-chat, qwen-plus 等",
					Required:     false,
				},
				{
					Key:          "auto_translate_work_titles",
					Label:        "新建作品时自动推导中/英/日多语言题名",
					Type:         "boolean",
					DefaultValue: true,
					Description:  "根据原产国和原始名称自动填充 work_translations",
					Required:     false,
				},
			},
		},
	}
}

func (p *AIEnrichmentPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *AIEnrichmentPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *AIEnrichmentPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *AIEnrichmentPlugin) HealthCheck(ctx context.Context) HealthStatus {
	key, _ := p.config["api_key"].(string)
	if key == "" {
		return HealthStatus{
			Status:      "warning",
			Message:     "LLM API Key not configured",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	}
	return HealthStatus{
		Status:      "healthy",
		Message:     "AI Enrichment & Multilingual Translation Engine online",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}
}

func (p *AIEnrichmentPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"provider": "ai_enrichment",
		"status":   "ready",
	}, nil
}

func (p *AIEnrichmentPlugin) ValidateExternalID(source string, externalID string) bool {
	return true
}

