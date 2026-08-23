package plugin

import (
	"context"
	"time"

	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/models"
)

// Capability 能力声明常量
const (
	CapImporter         = "importer"
	CapMetadataProvider = "metadata_provider"
	CapExport           = "export"
	CapNotification     = "notification"
	CapTranscoderHook   = "transcoder_hook"
)

// PluginType 插件类型
const (
	PluginTypeNative       = "native"
	PluginTypeExternalHTTP = "external_http"
	PluginTypeWebhook      = "webhook"
)

// ConfigField 配置表单项声明
type ConfigField struct {
	Key          string      `json:"key"`
	Label        string      `json:"label"`
	Type         string      `json:"type"` // "string", "password", "number", "boolean", "select", "textarea"
	DefaultValue interface{} `json:"default_value,omitempty"`
	Description  string      `json:"description,omitempty"`
	Required     bool        `json:"required"`
	Options      []string    `json:"options,omitempty"`
}

// ConfigSchema 插件配置架构
type ConfigSchema struct {
	Fields []ConfigField `json:"fields"`
}

// Manifest 插件元数据与能力声明
type Manifest struct {
	ID               string       `json:"id"`
	Name             string       `json:"name"`
	Version          string       `json:"version"`
	Description      string       `json:"description"`
	Author           string       `json:"author"`
	Icon             string       `json:"icon"`
	Type             string       `json:"type"` // "native", "external_http", "webhook"
	Capabilities     []string     `json:"capabilities"`
	ConfigSchema     ConfigSchema `json:"config_schema"`
	SupportedSources []string     `json:"supported_sources,omitempty"`
	SupportedFormats []string     `json:"supported_formats,omitempty"`
	SupportedEvents  []string     `json:"supported_events,omitempty"`
}

// HealthStatus 插件健康检查状态
type HealthStatus struct {
	Status      string    `json:"status"` // "healthy", "warning", "unhealthy", "disabled"
	Message     string    `json:"message"`
	LatencyMs   int64     `json:"latency_ms"`
	LastChecked time.Time `json:"last_checked"`
}

// Plugin 核心插件通用生命周期接口
type Plugin interface {
	Manifest() Manifest
	Init(ctx context.Context, config map[string]interface{}) error
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	HealthCheck(ctx context.Context) HealthStatus
}

// ImporterPlugin 外部数据源导入扩展接口
type ImporterPlugin interface {
	Plugin
	SupportedSources() []string
	DetectSource(input string, hint string) bool
	Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error)
}

// MetadataProviderPlugin 外部权威元数据关联与提取接口
type MetadataProviderPlugin interface {
	Plugin
	GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error)
	ValidateExternalID(source string, externalID string) bool
}

// ExportPlugin 数据格式导出插件接口 (如 LRM JSON-LD, MusicBrainz Picard, BibTeX, CSV)
type ExportPlugin interface {
	Plugin
	Format() string
	MimeType() string
	FileExtension() string
	ExportWork(ctx context.Context, work *models.Work, extra map[string]interface{}) ([]byte, error)
}

// NotifierPlugin 事件通知插件接口 (如 Discord / Telegram / Feishu / Slack / Webhook)
type NotifierPlugin interface {
	Plugin
	SupportedEvents() []string
	Notify(ctx context.Context, event string, payload map[string]interface{}) error
}

// PluginDTO 面向前端展示与管理的插件数据传输对象
type PluginDTO struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	Version          string                 `json:"version"`
	Description      string                 `json:"description"`
	Author           string                 `json:"author"`
	Icon             string                 `json:"icon"`
	Type             string                 `json:"type"`
	EndpointURL      string                 `json:"endpoint_url,omitempty"`
	Capabilities     []string               `json:"capabilities"`
	ConfigSchema     ConfigSchema           `json:"config_schema"`
	Config           map[string]interface{} `json:"config"`
	IsEnabled        bool                   `json:"is_enabled"`
	IsSystem         bool                   `json:"is_system"`
	Health           HealthStatus           `json:"health"`
	SupportedSources []string               `json:"supported_sources,omitempty"`
	SupportedFormats []string               `json:"supported_formats,omitempty"`
	SupportedEvents  []string               `json:"supported_events,omitempty"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
}
