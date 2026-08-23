package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

// Manager 统一插件系统内核生命周期与调度管理器
type Manager struct {
	db       *gorm.DB
	cfg      *config.Config
	registry *Registry
	mu       sync.RWMutex
}

// RegisterExternalInput 注册外部进程/Webhook插件请求
type RegisterExternalInput struct {
	ID          string                 `json:"id" binding:"required"`
	Name        string                 `json:"name" binding:"required"`
	Version     string                 `json:"version"`
	Description string                 `json:"description"`
	Author      string                 `json:"author"`
	Icon        string                 `json:"icon"`
	Type        string                 `json:"type"` // "external_http", "webhook"
	EndpointURL string                 `json:"endpoint_url" binding:"required"`
	SecretToken string                 `json:"secret_token"`
	Capabilities []string              `json:"capabilities" binding:"required"`
	ConfigSchema *ConfigSchema          `json:"config_schema"`
	Config      map[string]interface{} `json:"config"`
	IsEnabled   bool                   `json:"is_enabled"`
}

// UpdatePluginInput 修改插件开关与配置
type UpdatePluginInput struct {
	IsEnabled *bool                  `json:"is_enabled"`
	Config    map[string]interface{} `json:"config"`
}

// NewManager 构造插件管理器并挂载全部系统内置插件
func NewManager(db *gorm.DB, cfg *config.Config) *Manager {
	reg := NewRegistry()

	// 注册内置原生插件工厂
	reg.RegisterFactory("musicbrainz", NewMusicBrainzPlugin)
	reg.RegisterFactory("tmdb", NewTMDBPlugin)
	reg.RegisterFactory("bangumi", NewBangumiPlugin)
	reg.RegisterFactory("vndb", NewVNDBPlugin)
	reg.RegisterFactory("douban", NewDoubanPlugin)
	reg.RegisterFactory("webhook_notifier", NewWebhookNotifierPlugin)
	reg.RegisterFactory("jsonld_exporter", NewJSONLDExporterPlugin)
	reg.RegisterFactory("picard_exporter", NewPicardExporterPlugin)

	m := &Manager{
		db:       db,
		cfg:      cfg,
		registry: reg,
	}

	return m
}

// Initialize 初始化并同步数据库中的插件状态与运行时实例
func (m *Manager) Initialize(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. 同步所有原生内置插件至数据库
	for _, factoryID := range m.registry.GetAllFactoryIDs() {
		factory, ok := m.registry.GetFactory(factoryID)
		if !ok {
			continue
		}
		instance := factory()
		manifest := instance.Manifest()

		var dbPlugin models.SystemPlugin
		err := m.db.Where("id = ?", manifest.ID).First(&dbPlugin).Error
		if err != nil && err == gorm.ErrRecordNotFound {
			// 初始化新内置插件入库
			schemaBytes, _ := json.Marshal(manifest.ConfigSchema)
			defaultCfg := make(map[string]interface{})
			for _, f := range manifest.ConfigSchema.Fields {
				if f.DefaultValue != nil {
					defaultCfg[f.Key] = f.DefaultValue
				}
			}
			cfgBytes, _ := json.Marshal(defaultCfg)

			dbPlugin = models.SystemPlugin{
				ID:           manifest.ID,
				Name:         manifest.Name,
				Version:      manifest.Version,
				Description:  manifest.Description,
				Author:       manifest.Author,
				Icon:         manifest.Icon,
				Type:         PluginTypeNative,
				Capabilities: pq.StringArray(manifest.Capabilities),
				ConfigSchema: models.JSONB(schemaBytes),
				Config:       models.JSONB(cfgBytes),
				IsEnabled:    true,
				IsSystem:     true,
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			if err := m.db.Create(&dbPlugin).Error; err != nil {
				log.Printf("[PluginKernel] Warning: Failed to seed system plugin %s: %v", manifest.ID, err)
			}
		} else if err == nil {
			// 更新元数据
			schemaBytes, _ := json.Marshal(manifest.ConfigSchema)
			m.db.Model(&dbPlugin).Updates(map[string]interface{}{
				"name":          manifest.Name,
				"version":       manifest.Version,
				"description":   manifest.Description,
				"author":        manifest.Author,
				"icon":          manifest.Icon,
				"capabilities":  pq.StringArray(manifest.Capabilities),
				"config_schema": models.JSONB(schemaBytes),
				"is_system":     true,
			})
		}
	}

	// 2. 加载全部数据库插件并实例化运行
	var allDBPlugins []models.SystemPlugin
	if err := m.db.Find(&allDBPlugins).Error; err != nil {
		return fmt.Errorf("failed to load system plugins from database: %w", err)
	}

	for _, row := range allDBPlugins {
		var instance Plugin

		var cfgMap map[string]interface{}
		_ = json.Unmarshal([]byte(row.Config), &cfgMap)
		if cfgMap == nil {
			cfgMap = make(map[string]interface{})
		}

		if row.Type == PluginTypeNative {
			factory, ok := m.registry.GetFactory(row.ID)
			if !ok {
				log.Printf("[PluginKernel] Notice: Native plugin factory %s not found in registry", row.ID)
				continue
			}
			instance = factory()
		} else {
			// 外部 HTTP / Webhook 驱动插件
			var schema ConfigSchema
			_ = json.Unmarshal([]byte(row.ConfigSchema), &schema)

			manifest := Manifest{
				ID:           row.ID,
				Name:         row.Name,
				Version:      row.Version,
				Description:  row.Description,
				Author:       row.Author,
				Icon:         row.Icon,
				Type:         row.Type,
				Capabilities: []string(row.Capabilities),
				ConfigSchema: schema,
			}
			instance = NewExternalHTTPPlugin(manifest, row.EndpointURL, row.SecretToken)
		}

		if err := instance.Init(ctx, cfgMap); err != nil {
			log.Printf("[PluginKernel] Error initializing plugin %s: %v", row.ID, err)
		}

		if row.IsEnabled {
			if err := instance.Start(ctx); err != nil {
				log.Printf("[PluginKernel] Error starting plugin %s: %v", row.ID, err)
			}
			m.registry.SetInstance(row.ID, instance)
		}
	}

	log.Printf("[PluginKernel] Plugin kernel initialized successfully. Loaded %d plugins, %d active.", len(allDBPlugins), len(m.registry.GetAllInstances()))
	return nil
}

// ListPlugins 列出插件列表
func (m *Manager) ListPlugins(ctx context.Context, onlyEnabled bool) ([]PluginDTO, error) {
	var rows []models.SystemPlugin
	dbQuery := m.db
	if onlyEnabled {
		dbQuery = dbQuery.Where("is_enabled = ?", true)
	}
	if err := dbQuery.Order("is_system desc, id asc").Find(&rows).Error; err != nil {
		return nil, err
	}

	dtos := make([]PluginDTO, 0, len(rows))
	for _, r := range rows {
		dto := m.toDTO(ctx, &r)
		dtos = append(dtos, *dto)
	}

	return dtos, nil
}

// GetPlugin 获取单个插件详情
func (m *Manager) GetPlugin(ctx context.Context, id string) (*PluginDTO, error) {
	var row models.SystemPlugin
	if err := m.db.Where("id = ?", id).First(&row).Error; err != nil {
		return nil, err
	}
	return m.toDTO(ctx, &row), nil
}

// UpdatePlugin 更新插件开关及配置
func (m *Manager) UpdatePlugin(ctx context.Context, id string, input UpdatePluginInput) (*PluginDTO, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var row models.SystemPlugin
	if err := m.db.Where("id = ?", id).First(&row).Error; err != nil {
		return nil, fmt.Errorf("plugin %s not found: %w", id, err)
	}

	updates := make(map[string]interface{})
	if input.IsEnabled != nil {
		updates["is_enabled"] = *input.IsEnabled
		row.IsEnabled = *input.IsEnabled
	}

	if input.Config != nil {
		cfgBytes, err := json.Marshal(input.Config)
		if err != nil {
			return nil, fmt.Errorf("invalid config json: %w", err)
		}
		updates["config"] = models.JSONB(cfgBytes)
		row.Config = models.JSONB(cfgBytes)
	}
	updates["updated_at"] = time.Now()

	if err := m.db.Model(&row).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update plugin in db: %w", err)
	}

	// 重新配置或启停运行时实例
	var cfgMap map[string]interface{}
	_ = json.Unmarshal([]byte(row.Config), &cfgMap)

	if row.IsEnabled {
		inst, exists := m.registry.GetInstance(id)
		if !exists {
			if row.Type == PluginTypeNative {
				if factory, ok := m.registry.GetFactory(id); ok {
					inst = factory()
				}
			} else {
				var schema ConfigSchema
				_ = json.Unmarshal([]byte(row.ConfigSchema), &schema)
				manifest := Manifest{
					ID:           row.ID,
					Name:         row.Name,
					Version:      row.Version,
					Description:  row.Description,
					Author:       row.Author,
					Icon:         row.Icon,
					Type:         row.Type,
					Capabilities: []string(row.Capabilities),
					ConfigSchema: schema,
				}
				inst = NewExternalHTTPPlugin(manifest, row.EndpointURL, row.SecretToken)
			}
		}
		if inst != nil {
			_ = inst.Init(ctx, cfgMap)
			_ = inst.Start(ctx)
			m.registry.SetInstance(id, inst)
		}
	} else {
		if inst, exists := m.registry.GetInstance(id); exists {
			_ = inst.Stop(ctx)
			m.registry.RemoveInstance(id)
		}
	}

	return m.toDTO(ctx, &row), nil
}

// RegisterExternalPlugin 注册第三方外部驱动插件
func (m *Manager) RegisterExternalPlugin(ctx context.Context, input RegisterExternalInput) (*PluginDTO, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := strings.ToLower(strings.TrimSpace(input.ID))
	if id == "" {
		return nil, fmt.Errorf("plugin id is required")
	}

	var count int64
	m.db.Model(&models.SystemPlugin{}).Where("id = ?", id).Count(&count)
	if count > 0 {
		return nil, fmt.Errorf("plugin with id '%s' already exists", id)
	}

	version := input.Version
	if version == "" {
		version = "1.0.0"
	}
	author := input.Author
	if author == "" {
		author = "External Developer"
	}
	icon := input.Icon
	if icon == "" {
		icon = "Plug"
	}
	pType := input.Type
	if pType == "" {
		pType = PluginTypeExternalHTTP
	}

	var schemaBytes []byte
	if input.ConfigSchema != nil {
		schemaBytes, _ = json.Marshal(input.ConfigSchema)
	} else {
		schemaBytes = []byte(`{"fields":[]}`)
	}

	cfg := input.Config
	if cfg == nil {
		cfg = make(map[string]interface{})
	}
	cfgBytes, _ := json.Marshal(cfg)

	row := models.SystemPlugin{
		ID:           id,
		Name:         input.Name,
		Version:      version,
		Description:  input.Description,
		Author:       author,
		Icon:         icon,
		Type:         pType,
		EndpointURL:  input.EndpointURL,
		SecretToken:  input.SecretToken,
		Capabilities: pq.StringArray(input.Capabilities),
		ConfigSchema: models.JSONB(schemaBytes),
		Config:       models.JSONB(cfgBytes),
		IsEnabled:    input.IsEnabled,
		IsSystem:     false,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := m.db.Create(&row).Error; err != nil {
		return nil, fmt.Errorf("failed to save plugin: %w", err)
	}

	if row.IsEnabled {
		var schema ConfigSchema
		_ = json.Unmarshal(schemaBytes, &schema)
		manifest := Manifest{
			ID:           row.ID,
			Name:         row.Name,
			Version:      row.Version,
			Description:  row.Description,
			Author:       row.Author,
			Icon:         row.Icon,
			Type:         row.Type,
			Capabilities: []string(row.Capabilities),
			ConfigSchema: schema,
		}
		inst := NewExternalHTTPPlugin(manifest, row.EndpointURL, row.SecretToken)
		_ = inst.Init(ctx, cfg)
		_ = inst.Start(ctx)
		m.registry.SetInstance(row.ID, inst)
	}

	return m.toDTO(ctx, &row), nil
}

// DeleteExternalPlugin 删除自定义外部插件
func (m *Manager) DeleteExternalPlugin(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var row models.SystemPlugin
	if err := m.db.Where("id = ?", id).First(&row).Error; err != nil {
		return fmt.Errorf("plugin %s not found: %w", id, err)
	}

	if row.IsSystem {
		return fmt.Errorf("cannot delete built-in system plugin '%s'", id)
	}

	if inst, exists := m.registry.GetInstance(id); exists {
		_ = inst.Stop(ctx)
		m.registry.RemoveInstance(id)
	}

	return m.db.Delete(&row).Error
}

// TestPluginHealth 检查指定插件健康状况
func (m *Manager) TestPluginHealth(ctx context.Context, id string) (*HealthStatus, error) {
	inst, exists := m.registry.GetInstance(id)
	if !exists {
		// 如果未激活，尝试创建临时实例测试
		var row models.SystemPlugin
		if err := m.db.Where("id = ?", id).First(&row).Error; err != nil {
			return nil, fmt.Errorf("plugin %s not found: %w", id, err)
		}
		if !row.IsEnabled {
			return &HealthStatus{
				Status:      "disabled",
				Message:     "Plugin is currently disabled",
				LatencyMs:   0,
				LastChecked: time.Now(),
			}, nil
		}
	}

	if inst != nil {
		hs := inst.HealthCheck(ctx)
		return &hs, nil
	}

	return &HealthStatus{
		Status:      "unknown",
		Message:     "Plugin instance not running",
		LatencyMs:   0,
		LastChecked: time.Now(),
	}, nil
}

// GetImporterPreview 通过已启用的插件解析外部数据源预览
func (m *Manager) GetImporterPreview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	imp := m.GetImporterForSource(req.Source, req.URLOrID, req.MediaTypeHint)
	if imp == nil {
		return nil, fmt.Errorf("no enabled importer plugin found for source '%s' or URL '%s'", req.Source, req.URLOrID)
	}
	return imp.Preview(ctx, req)
}

// NotifyEvent 向通知插件广播事件 (实现 importer.PluginImporterResolver 接口)
func (m *Manager) NotifyEvent(ctx context.Context, event string, payload map[string]interface{}) {
	m.Notify(ctx, event, payload)
}

// GetImporterForSource 获取匹配该来源或输入链接的可用导入插件
func (m *Manager) GetImporterForSource(source string, urlOrID string, hint string) ImporterPlugin {
	importers := m.registry.GetImporters()
	cleanSource := strings.ToLower(strings.TrimSpace(source))

	// 1. 如果明确指定了 source
	if cleanSource != "" && cleanSource != "auto" {
		for _, imp := range importers {
			for _, src := range imp.SupportedSources() {
				if strings.EqualFold(src, cleanSource) {
					return imp
				}
			}
		}
	}

	// 2. 如果 source 为 auto，基于 URL / ID / hint 自动探测
	for _, imp := range importers {
		if imp.DetectSource(urlOrID, hint) {
			return imp
		}
	}

	return nil
}

// Notify 异步非阻塞向所有注册的通知插件广播事件
func (m *Manager) Notify(ctx context.Context, event string, payload map[string]interface{}) {
	notifiers := m.registry.GetNotifiers()
	if len(notifiers) == 0 {
		return
	}

	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		var wg sync.WaitGroup
		for _, n := range notifiers {
			wg.Add(1)
			go func(notif NotifierPlugin) {
				defer wg.Done()
				_ = notif.Notify(bgCtx, event, payload)
			}(n)
		}
		wg.Wait()
	}()
}

// ExportWork 导出指定格式的作品元数据
func (m *Manager) ExportWork(ctx context.Context, format string, workID uuid.UUID) ([]byte, string, string, error) {
	exporters := m.registry.GetExporters()
	cleanFmt := strings.ToLower(strings.TrimSpace(format))

	var targetExporter ExportPlugin
	for _, exp := range exporters {
		if strings.EqualFold(exp.Format(), cleanFmt) {
			targetExporter = exp
			break
		}
	}

	if targetExporter == nil {
		return nil, "", "", fmt.Errorf("no exporter plugin available for format '%s'", format)
	}

	var work models.Work
	if err := m.db.Preload("Translations").Preload("Tags").First(&work, workID).Error; err != nil {
		return nil, "", "", fmt.Errorf("work not found: %w", err)
	}

	var artists []models.WorkArtistRelation
	_ = m.db.Preload("Artist").Where("work_id = ?", workID).Find(&artists).Error

	var releases []models.Release
	_ = m.db.Preload("Mediums.Tracks").Where("work_id = ?", workID).Find(&releases).Error

	extra := map[string]interface{}{
		"artists":  artists,
		"releases": releases,
	}

	bytes, err := targetExporter.ExportWork(ctx, &work, extra)
	if err != nil {
		return nil, "", "", err
	}

	return bytes, targetExporter.MimeType(), targetExporter.FileExtension(), nil
}

func (m *Manager) toDTO(ctx context.Context, r *models.SystemPlugin) *PluginDTO {
	var schema ConfigSchema
	_ = json.Unmarshal([]byte(r.ConfigSchema), &schema)

	var cfgMap map[string]interface{}
	_ = json.Unmarshal([]byte(r.Config), &cfgMap)
	if cfgMap == nil {
		cfgMap = make(map[string]interface{})
	}

	var health HealthStatus
	if !r.IsEnabled {
		health = HealthStatus{
			Status:      "disabled",
			Message:     "Plugin is disabled",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	} else if inst, ok := m.registry.GetInstance(r.ID); ok {
		manifest := inst.Manifest()
		health = HealthStatus{
			Status:      "healthy",
			Message:     "Plugin active",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
		return &PluginDTO{
			ID:               r.ID,
			Name:             r.Name,
			Version:          r.Version,
			Description:      r.Description,
			Author:           r.Author,
			Icon:             r.Icon,
			Type:             r.Type,
			EndpointURL:      r.EndpointURL,
			Capabilities:     []string(r.Capabilities),
			ConfigSchema:     schema,
			Config:           cfgMap,
			IsEnabled:        r.IsEnabled,
			IsSystem:         r.IsSystem,
			Health:           health,
			SupportedSources: manifest.SupportedSources,
			SupportedFormats: manifest.SupportedFormats,
			SupportedEvents:  manifest.SupportedEvents,
			CreatedAt:        r.CreatedAt,
			UpdatedAt:        r.UpdatedAt,
		}
	} else {
		health = HealthStatus{
			Status:      "warning",
			Message:     "Plugin enabled but not started",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	}

	return &PluginDTO{
		ID:           r.ID,
		Name:         r.Name,
		Version:      r.Version,
		Description:  r.Description,
		Author:       r.Author,
		Icon:         r.Icon,
		Type:         r.Type,
		EndpointURL:  r.EndpointURL,
		Capabilities: []string(r.Capabilities),
		ConfigSchema: schema,
		Config:       cfgMap,
		IsEnabled:    r.IsEnabled,
		IsSystem:     r.IsSystem,
		Health:       health,
		CreatedAt:    r.CreatedAt,
		UpdatedAt:    r.UpdatedAt,
	}
}
