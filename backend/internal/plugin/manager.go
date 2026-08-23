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
	ID           string                 `json:"id" binding:"required"`
	Name         string                 `json:"name" binding:"required"`
	Version      string                 `json:"version"`
	Description  string                 `json:"description"`
	Author       string                 `json:"author"`
	Icon         string                 `json:"icon"`
	Type         string                 `json:"type"` // "external_http", "webhook"
	EndpointURL  string                 `json:"endpoint_url" binding:"required"`
	SecretToken  string                 `json:"secret_token"`
	Capabilities []string               `json:"capabilities" binding:"required"`
	Dependencies map[string]string      `json:"dependencies"`
	ConfigSchema *ConfigSchema          `json:"config_schema"`
	Config       map[string]interface{} `json:"config"`
	IsEnabled    bool                   `json:"is_enabled"`
}

// UpdatePluginInput 修改插件开关与配置 (支持级联启停保护)
type UpdatePluginInput struct {
	IsEnabled *bool                  `json:"is_enabled"`
	Config    map[string]interface{} `json:"config"`
	Cascade   bool                   `json:"cascade"` // 是否级联启用前置依赖或级联停用后置依赖
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
	reg.RegisterFactory("acoustid_helper", NewAcoustIDHelperPlugin)
	reg.RegisterFactory("bibtex_exporter", NewBibTeXExporterPlugin)
	reg.RegisterFactory("ai_enrichment", NewAIEnrichmentPlugin)

	m := &Manager{
		db:       db,
		cfg:      cfg,
		registry: reg,
	}

	return m
}

// Initialize 初始化并同步数据库中的插件状态与运行时实例（按拓扑顺序初始化与启动）
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
		schemaBytes, _ := json.Marshal(manifest.ConfigSchema)
		depsBytes, _ := json.Marshal(manifest.Dependencies)
		if manifest.Dependencies == nil {
			depsBytes = []byte("{}")
		}

		if err != nil && err == gorm.ErrRecordNotFound {
			// 初始化新内置插件入库
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
				Dependencies: models.JSONB(depsBytes),
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
			// 更新内置插件基础元数据与依赖声明
			m.db.Model(&dbPlugin).Updates(map[string]interface{}{
				"name":          manifest.Name,
				"version":       manifest.Version,
				"description":   manifest.Description,
				"author":        manifest.Author,
				"icon":          manifest.Icon,
				"capabilities":  pq.StringArray(manifest.Capabilities),
				"dependencies":  models.JSONB(depsBytes),
				"config_schema": models.JSONB(schemaBytes),
				"is_system":     true,
			})
		}
	}

	// 2. 加载全部数据库插件，构建依赖图谱并计算拓扑顺序
	graph, pluginMap, err := m.buildGraphFromDB()
	if err != nil {
		return fmt.Errorf("failed to load system plugins from database: %w", err)
	}

	// 检查循环依赖
	if cycle, err := graph.CheckCycles(); err != nil {
		log.Printf("[PluginKernel] Warning: Circular dependency detected in plugins: %v", cycle)
	}

	topoOrder, err := graph.TopologicalSort()
	if err != nil {
		log.Printf("[PluginKernel] Warning: Topological sort warning (%v), falling back to sequential order", err)
		topoOrder = make([]string, 0, len(pluginMap))
		for id := range pluginMap {
			topoOrder = append(topoOrder, id)
		}
	}

	log.Printf("[PluginKernel] Loading %d plugins in topological order: %s", len(topoOrder), strings.Join(topoOrder, " -> "))

	// 3. 按照拓扑顺序依次实例化并启动已启用的插件
	for _, id := range topoOrder {
		row, exists := pluginMap[id]
		if !exists {
			continue
		}

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
			var deps map[string]string
			_ = json.Unmarshal([]byte(row.Dependencies), &deps)

			manifest := Manifest{
				ID:           row.ID,
				Name:         row.Name,
				Version:      row.Version,
				Description:  row.Description,
				Author:       row.Author,
				Icon:         row.Icon,
				Type:         row.Type,
				Capabilities: []string(row.Capabilities),
				Dependencies: deps,
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

	log.Printf("[PluginKernel] Plugin kernel initialized successfully. Total: %d, Active: %d.", len(pluginMap), len(m.registry.GetAllInstances()))
	return nil
}

// buildGraphFromDB 从数据库插件表构造全局依赖图谱
func (m *Manager) buildGraphFromDB() (*DependencyGraph, map[string]models.SystemPlugin, error) {
	var allDBPlugins []models.SystemPlugin
	if err := m.db.Find(&allDBPlugins).Error; err != nil {
		return nil, nil, err
	}

	pluginMap := make(map[string]models.SystemPlugin)
	graph := NewDependencyGraph()

	for _, p := range allDBPlugins {
		pluginMap[p.ID] = p
		var deps map[string]string
		if len(p.Dependencies) > 0 {
			_ = json.Unmarshal([]byte(p.Dependencies), &deps)
		}
		graph.AddNode(PluginNode{
			ID:           p.ID,
			Version:      p.Version,
			IsEnabled:    p.IsEnabled,
			Dependencies: deps,
		})
	}

	return graph, pluginMap, nil
}

// ListPlugins 列出插件列表（附加依赖状态评估与拓扑加载序号）
func (m *Manager) ListPlugins(ctx context.Context, onlyEnabled bool) ([]PluginDTO, error) {
	var rows []models.SystemPlugin
	dbQuery := m.db
	if onlyEnabled {
		dbQuery = dbQuery.Where("is_enabled = ?", true)
	}
	if err := dbQuery.Order("is_system desc, id asc").Find(&rows).Error; err != nil {
		return nil, err
	}

	graph, _, _ := m.buildGraphFromDB()
	topoOrder, _ := graph.TopologicalSort()
	loadOrderMap := make(map[string]int)
	for idx, id := range topoOrder {
		loadOrderMap[id] = idx + 1
	}

	dtos := make([]PluginDTO, 0, len(rows))
	for _, r := range rows {
		dto := m.toDTOWithGraph(ctx, &r, graph, loadOrderMap[r.ID])
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
	graph, _, _ := m.buildGraphFromDB()
	return m.toDTOWithGraph(ctx, &row, graph, 0), nil
}

// enableSinglePlugin 激活单个插件的底层逻辑
func (m *Manager) enableSinglePlugin(ctx context.Context, row *models.SystemPlugin) {
	row.IsEnabled = true
	row.UpdatedAt = time.Now()
	m.db.Model(row).Update("is_enabled", true)

	var cfgMap map[string]interface{}
	_ = json.Unmarshal([]byte(row.Config), &cfgMap)

	inst, exists := m.registry.GetInstance(row.ID)
	if !exists {
		if row.Type == PluginTypeNative {
			if factory, ok := m.registry.GetFactory(row.ID); ok {
				inst = factory()
			}
		} else {
			var schema ConfigSchema
			_ = json.Unmarshal([]byte(row.ConfigSchema), &schema)
			var deps map[string]string
			_ = json.Unmarshal([]byte(row.Dependencies), &deps)

			manifest := Manifest{
				ID:           row.ID,
				Name:         row.Name,
				Version:      row.Version,
				Description:  row.Description,
				Author:       row.Author,
				Icon:         row.Icon,
				Type:         row.Type,
				Capabilities: []string(row.Capabilities),
				Dependencies: deps,
				ConfigSchema: schema,
			}
			inst = NewExternalHTTPPlugin(manifest, row.EndpointURL, row.SecretToken)
		}
	}
	if inst != nil {
		_ = inst.Init(ctx, cfgMap)
		_ = inst.Start(ctx)
		m.registry.SetInstance(row.ID, inst)
	}
}

// disableSinglePlugin 停用单个插件的底层逻辑
func (m *Manager) disableSinglePlugin(ctx context.Context, row *models.SystemPlugin) {
	row.IsEnabled = false
	row.UpdatedAt = time.Now()
	m.db.Model(row).Update("is_enabled", false)

	if inst, exists := m.registry.GetInstance(row.ID); exists {
		_ = inst.Stop(ctx)
		m.registry.RemoveInstance(row.ID)
	}
}

// UpdatePlugin 更新插件开关及配置（内置依赖校验与级联保护）
func (m *Manager) UpdatePlugin(ctx context.Context, id string, input UpdatePluginInput) (*PluginDTO, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var row models.SystemPlugin
	if err := m.db.Where("id = ?", id).First(&row).Error; err != nil {
		return nil, fmt.Errorf("plugin %s not found: %w", id, err)
	}

	graph, pluginMap, err := m.buildGraphFromDB()
	if err != nil {
		return nil, fmt.Errorf("failed to build plugin dependency graph: %w", err)
	}

	if input.IsEnabled != nil {
		targetState := *input.IsEnabled

		if targetState && !row.IsEnabled {
			// ── 尝试启用插件：前置依赖检查 ──
			eval := graph.EvaluateDependencies(id)
			if len(eval.MissingDependencies) > 0 {
				return nil, fmt.Errorf("cannot enable plugin %q: missing required dependencies: %s", id, strings.Join(eval.MissingDependencies, ", "))
			}
			if len(eval.UnmetVersions) > 0 {
				return nil, fmt.Errorf("cannot enable plugin %q: unmet dependency versions: %s", id, strings.Join(eval.UnmetVersions, ", "))
			}

			if len(eval.InactiveDependencies) > 0 {
				if !input.Cascade {
					return nil, fmt.Errorf("cannot enable plugin %q because required dependencies [%s] are disabled. Please enable them first or specify cascade=true", id, strings.Join(eval.InactiveDependencies, ", "))
				}

				// 级联启用：获取所有传递依赖并按拓扑加载顺序逐一启用
				transitiveDeps := graph.GetTransitiveDependencies(id)
				topoOrder, _ := graph.TopologicalSort()
				for _, depID := range topoOrder {
					for _, targetDep := range transitiveDeps {
						if depID == targetDep {
							depRow, ok := pluginMap[depID]
							if ok && !depRow.IsEnabled {
								m.enableSinglePlugin(ctx, &depRow)
							}
						}
					}
				}
			}

			m.enableSinglePlugin(ctx, &row)
		} else if !targetState && row.IsEnabled {
			// ── 尝试停用插件：后置依赖冲突拦截 ──
			activeDependents := make([]string, 0)
			directDependents := graph.GetDirectDependents(id)
			for _, depID := range directDependents {
				if depRow, ok := pluginMap[depID]; ok && depRow.IsEnabled {
					activeDependents = append(activeDependents, depID)
				}
			}

			if len(activeDependents) > 0 {
				if !input.Cascade {
					return nil, fmt.Errorf("cannot disable plugin %q because active plugin(s) [%s] depend on it. Please disable dependent plugins first or specify cascade=true", id, strings.Join(activeDependents, ", "))
				}

				// 级联停用：获取所有递归被依赖项，按逆拓扑序逐一停用
				transitiveDependents := graph.GetTransitiveDependents(id)
				topoOrder, _ := graph.TopologicalSort()
				for i := len(topoOrder) - 1; i >= 0; i-- {
					depID := topoOrder[i]
					for _, targetDep := range transitiveDependents {
						if depID == targetDep {
							depRow, ok := pluginMap[depID]
							if ok && depRow.IsEnabled {
								m.disableSinglePlugin(ctx, &depRow)
							}
						}
					}
				}
			}

			m.disableSinglePlugin(ctx, &row)
		}
	}

	if input.Config != nil {
		cfgBytes, err := json.Marshal(input.Config)
		if err != nil {
			return nil, fmt.Errorf("invalid config json: %w", err)
		}
		if err := m.db.Model(&row).Update("config", models.JSONB(cfgBytes)).Error; err != nil {
			return nil, fmt.Errorf("failed to update config in db: %w", err)
		}
		row.Config = models.JSONB(cfgBytes)

		// 重新给活跃实例应用新配置
		if row.IsEnabled {
			if inst, ok := m.registry.GetInstance(id); ok {
				_ = inst.Init(ctx, input.Config)
			}
		}
	}

	// 重新构建图谱返回最新状态
	updatedGraph, _, _ := m.buildGraphFromDB()
	return m.toDTOWithGraph(ctx, &row, updatedGraph, 0), nil
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
	if _, err := ParseSemver(version); err != nil {
		return nil, fmt.Errorf("invalid plugin version %q: %w", version, err)
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

	var depsBytes []byte
	if input.Dependencies != nil {
		depsBytes, _ = json.Marshal(input.Dependencies)
	} else {
		depsBytes = []byte(`{}`)
	}

	cfg := input.Config
	if cfg == nil {
		cfg = make(map[string]interface{})
	}
	cfgBytes, _ := json.Marshal(cfg)

	// 循环依赖试探检测
	graph, _, _ := m.buildGraphFromDB()
	graph.AddNode(PluginNode{
		ID:           id,
		Version:      version,
		IsEnabled:    input.IsEnabled,
		Dependencies: input.Dependencies,
	})
	if cycle, err := graph.CheckCycles(); err != nil {
		return nil, fmt.Errorf("cannot register plugin: %w (cycle: %v)", err, cycle)
	}

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
		Dependencies: models.JSONB(depsBytes),
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
			Dependencies: input.Dependencies,
			ConfigSchema: schema,
		}
		inst := NewExternalHTTPPlugin(manifest, row.EndpointURL, row.SecretToken)
		_ = inst.Init(ctx, cfg)
		_ = inst.Start(ctx)
		m.registry.SetInstance(row.ID, inst)
	}

	updatedGraph, _, _ := m.buildGraphFromDB()
	return m.toDTOWithGraph(ctx, &row, updatedGraph, 0), nil
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

	// 检查是否有其他插件依赖此插件
	graph, _, _ := m.buildGraphFromDB()
	directDependents := graph.GetDirectDependents(id)
	if len(directDependents) > 0 {
		return fmt.Errorf("cannot delete plugin %q because plugin(s) [%s] depend on it", id, strings.Join(directDependents, ", "))
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

		var cfgMap map[string]interface{}
		_ = json.Unmarshal([]byte(row.Config), &cfgMap)

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
		if inst != nil {
			_ = inst.Init(ctx, cfgMap)
		}
	}

	if inst == nil {
		return nil, fmt.Errorf("plugin %s cannot be instantiated for health check", id)
	}

	status := inst.HealthCheck(ctx)
	return &status, nil
}

// DetectAndPreview 统一导入探测与预览代理
func (m *Manager) DetectAndPreview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	importers := m.registry.GetImporters()
	if len(importers) == 0 {
		return nil, fmt.Errorf("no importer plugin active in the system")
	}

	// 1. 若前端指定了 Hint，优先匹配 Hint
	if req.Hint != "" {
		for _, imp := range importers {
			for _, src := range imp.SupportedSources() {
				if strings.EqualFold(src, req.Hint) {
					return imp.Preview(ctx, req)
				}
			}
		}
	}

	// 2. 依次由各导入插件进行 DetectSource 探测
	for _, imp := range importers {
		if imp.DetectSource(req.Input, req.Hint) {
			return imp.Preview(ctx, req)
		}
	}

	return nil, fmt.Errorf("no active plugin recognized the provided URL or ID: %s", req.Input)
}

// Notify 广播事件通知至所有已激活的 Notifier 插件 (异步非阻塞)
func (m *Manager) Notify(ctx context.Context, event string, payload map[string]interface{}) {
	notifiers := m.registry.GetNotifiers()
	if len(notifiers) == 0 {
		return
	}

	// 异步并发外发
	go func() {
		var wg sync.WaitGroup
		asyncCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		for _, notif := range notifiers {
			// 检查是否订阅该事件
			supported := false
			for _, e := range notif.SupportedEvents() {
				if e == "*" || e == event || strings.HasPrefix(event, strings.TrimSuffix(e, "*")) {
					supported = true
					break
				}
			}
			if !supported {
				continue
			}

			wg.Add(1)
			go func(p NotifierPlugin) {
				defer wg.Done()
				if err := p.Notify(asyncCtx, event, payload); err != nil {
					log.Printf("[PluginKernel] Warning: Notifier %s failed to dispatch event %s: %v", p.Manifest().ID, event, err)
				}
			}(notif)
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

func (m *Manager) toDTOWithGraph(ctx context.Context, r *models.SystemPlugin, graph *DependencyGraph, loadOrder int) *PluginDTO {
	var schema ConfigSchema
	_ = json.Unmarshal([]byte(r.ConfigSchema), &schema)

	var deps map[string]string
	if len(r.Dependencies) > 0 {
		_ = json.Unmarshal([]byte(r.Dependencies), &deps)
	}
	if deps == nil {
		deps = make(map[string]string)
	}

	var cfgMap map[string]interface{}
	_ = json.Unmarshal([]byte(r.Config), &cfgMap)
	if cfgMap == nil {
		cfgMap = make(map[string]interface{})
	}

	var eval DependencyEvaluation
	var dependents []string
	if graph != nil {
		eval = graph.EvaluateDependencies(r.ID)
		dependents = graph.GetDirectDependents(r.ID)
	}

	var health HealthStatus
	var supportedSources []string
	var supportedFormats []string
	var supportedEvents []string

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
		supportedSources = manifest.SupportedSources
		supportedFormats = manifest.SupportedFormats
		supportedEvents = manifest.SupportedEvents
	} else {
		health = HealthStatus{
			Status:      "warning",
			Message:     "Plugin enabled but not started",
			LatencyMs:   0,
			LastChecked: time.Now(),
		}
	}

	return &PluginDTO{
		ID:                   r.ID,
		Name:                 r.Name,
		Version:              r.Version,
		Description:          r.Description,
		Author:               r.Author,
		Icon:                 r.Icon,
		Type:                 r.Type,
		EndpointURL:          r.EndpointURL,
		Capabilities:         []string(r.Capabilities),
		Dependencies:         deps,
		Dependents:           dependents,
		DependencyStatus:     eval.Status,
		MissingDependencies: eval.MissingDependencies,
		InactiveDependencies: eval.InactiveDependencies,
		LoadOrder:            loadOrder,
		ConfigSchema:         schema,
		Config:               cfgMap,
		IsEnabled:            r.IsEnabled,
		IsSystem:             r.IsSystem,
		Health:               health,
		SupportedSources:     supportedSources,
		SupportedFormats:     supportedFormats,
		SupportedEvents:      supportedEvents,
		CreatedAt:            r.CreatedAt,
		UpdatedAt:            r.UpdatedAt,
	}
}

func (m *Manager) toDTO(ctx context.Context, r *models.SystemPlugin) *PluginDTO {
	graph, _, _ := m.buildGraphFromDB()
	return m.toDTOWithGraph(ctx, r, graph, 0)
}
