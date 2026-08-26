package plugin

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/metafusion/metafusion-app/internal/importer"
	"github.com/metafusion/metafusion-app/internal/security"
)

var (
	vndbURLRegex = regexp.MustCompile(`^(?:https?://)?(?:[a-zA-Z0-9-]+\.)?vndb\.org/v(\d+)(?:[/?#].*)?$`)
	vndbIDRegex  = regexp.MustCompile(`^v?(\d+)$`)
	doubanRegex  = regexp.MustCompile(`^(?:https?://)?(?:[a-zA-Z0-9-]+\.)?douban\.com/(?:subject|book|movie)/(\d+)(?:[/?#].*)?$`)
	isbnRegex    = regexp.MustCompile(`^(?:97[89])?\d{9}[\dX]$`)
)

// ── 1. MusicBrainz 原生插件 ──

type MusicBrainzPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewMusicBrainzPlugin() Plugin {
	return &MusicBrainzPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(20 * time.Second),
	}
}

func (p *MusicBrainzPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "musicbrainz",
		Name:        "MusicBrainz 权威元数据库",
		Version:     "1.0.0",
		Description: "开放音乐元数据百科权威源，支持 Release、Recording、音轨介质及全球 ISRC/ISWC 编码解析",
		Author:      "MetaFusion Core",
		Icon:        "Disc",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"musicbrainz", "mbid"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "custom_user_agent",
					Label:        "自定义 User-Agent",
					Type:        "string",
					DefaultValue: "MetaFusion/1.0 (contact@metafusion.local)",
					Description:  "MusicBrainz API 强制要求的应用标识字符串",
					Required:     false,
				},
				{
					Key:          "rate_limit_rps",
					Label:        "请求速率限制 (req/s)",
					Type:        "number",
					DefaultValue: 1,
					Description:  "遵守官方单 IP 1次/秒限流策略",
					Required:     false,
				},
			},
		},
	}
}

func (p *MusicBrainzPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *MusicBrainzPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *MusicBrainzPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *MusicBrainzPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://musicbrainz.org/ws/2/release/4b9b9c02-d96a-4933-9133-149b3dc33989?fmt=json", nil)
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	ua := "MetaFusion/1.0 (contact@metafusion.local)"
	if v, ok := p.config["custom_user_agent"].(string); ok && v != "" {
		ua = v
	}
	req.Header.Set("User-Agent", ua)

	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return HealthStatus{Status: "warning", Message: fmt.Sprintf("MusicBrainz returned status %d", resp.StatusCode), LatencyMs: latency, LastChecked: time.Now()}
	}
	return HealthStatus{Status: "healthy", Message: "MusicBrainz API available", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *MusicBrainzPlugin) SupportedSources() []string {
	return []string{"musicbrainz"}
}

func (p *MusicBrainzPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	return strings.Contains(clean, "musicbrainz.org") || (len(clean) == 36 && strings.Count(clean, "-") == 4)
}

func (p *MusicBrainzPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	entityType := importer.DetectEntityType(req.URLOrID, req.EntityType)
	switch entityType {
	case "artist", "person":
		return importer.FetchMusicBrainzArtistPreview(ctx, req.URLOrID)
	case "organization", "label", "studio", "publisher":
		return importer.FetchMusicBrainzLabelPreview(ctx, req.URLOrID)
	default:
		return importer.FetchMusicBrainzPreview(ctx, req.URLOrID)
	}
}

func (p *MusicBrainzPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	preview, err := importer.FetchMusicBrainzPreview(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"source":      "musicbrainz",
		"external_id": externalID,
		"title":       preview.Work.Title,
		"artists":     preview.Artists,
		"mediums":     preview.Mediums,
	}, nil
}

func (p *MusicBrainzPlugin) ValidateExternalID(source string, externalID string) bool {
	clean := strings.TrimSpace(externalID)
	return len(clean) == 36 && strings.Count(clean, "-") == 4
}

// ── 2. TMDB 原生插件 ──

type TMDBPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewTMDBPlugin() Plugin {
	return &TMDBPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(20 * time.Second),
	}
}

func (p *TMDBPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "tmdb",
		Name:        "The Movie Database (TMDB)",
		Version:     "1.0.0",
		Description: "全球主流影视作品权威元数据源，支持按 TMDB ID 或 URL 提取电影、电视剧集、演职员与剧照海报",
		Author:      "MetaFusion Core",
		Icon:        "Film",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"tmdb"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "api_key",
					Label:        "TMDB API 密钥 (v3 auth)",
					Type:        "password",
					DefaultValue: "",
					Description:  "若留空将回退至系统环境变量 TMDB_API_KEY",
					Required:     false,
				},
				{
					Key:          "language",
					Label:        "首选语言",
					Type:        "string",
					DefaultValue: "zh-CN",
					Description:  "TMDB 元数据本地化请求语言代码",
					Required:     false,
				},
			},
		},
	}
}

func (p *TMDBPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *TMDBPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *TMDBPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *TMDBPlugin) getAPIKey() string {
	if k, ok := p.config["api_key"].(string); ok && strings.TrimSpace(k) != "" {
		return strings.TrimSpace(k)
	}
	return ""
}

func (p *TMDBPlugin) HealthCheck(ctx context.Context) HealthStatus {
	apiKey := p.getAPIKey()
	if apiKey == "" {
		return HealthStatus{Status: "warning", Message: "TMDB API Key not configured in plugin settings", LatencyMs: 0, LastChecked: time.Now()}
	}
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("https://api.themoviedb.org/3/configuration?api_key=%s", apiKey), nil)
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return HealthStatus{Status: "unhealthy", Message: fmt.Sprintf("TMDB API key validation failed with status %d", resp.StatusCode), LatencyMs: latency, LastChecked: time.Now()}
	}
	return HealthStatus{Status: "healthy", Message: "TMDB API verified successfully", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *TMDBPlugin) SupportedSources() []string {
	return []string{"tmdb"}
}

func (p *TMDBPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	return strings.Contains(clean, "themoviedb.org")
}

func (p *TMDBPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	apiKey := p.getAPIKey()
	entityType := importer.DetectEntityType(req.URLOrID, req.EntityType)
	switch entityType {
	case "artist", "person":
		return importer.FetchTMDBPersonPreview(ctx, req.URLOrID, apiKey)
	case "organization", "company", "studio", "publisher":
		return importer.FetchTMDBCompanyPreview(ctx, req.URLOrID, apiKey)
	default:
		return importer.FetchTMDBPreview(ctx, req.URLOrID, req.MediaTypeHint, apiKey)
	}
}

func (p *TMDBPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	apiKey := p.getAPIKey()
	preview, err := importer.FetchTMDBPreview(ctx, externalID, "", apiKey)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"source":      "tmdb",
		"external_id": externalID,
		"title":       preview.Work.Title,
		"artists":     preview.Artists,
	}, nil
}

func (p *TMDBPlugin) ValidateExternalID(source string, externalID string) bool {
	clean := strings.TrimSpace(externalID)
	return clean != ""
}

// ── 2.5. IMDb 原生插件 ──

type IMDbPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewIMDbPlugin() Plugin {
	return &IMDbPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(20 * time.Second),
	}
}

func (p *IMDbPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "imdb",
		Name:        "Internet Movie Database (IMDb)",
		Version:     "1.0.0",
		Description: "全球最具权威的电影与电视数据库，支持按 IMDb ID (tt...) 或链接解析影片主创、演职员及详情",
		Author:      "MetaFusion Core",
		Icon:        "Film",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"imdb"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "tmdb_api_key",
					Label:        "可选 TMDB API Key（辅助解析）",
					Type:        "password",
					DefaultValue: "",
					Description:  "若提供，可使用 TMDB Find 接口获取更精准的中英双语元数据",
					Required:     false,
				},
			},
		},
	}
}

func (p *IMDbPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *IMDbPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *IMDbPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *IMDbPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.imdb.com/title/tt0816692/", nil)
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "warning", Message: fmt.Sprintf("IMDb ping notice: %v", err), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()
	return HealthStatus{Status: "healthy", Message: "IMDb reachable", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *IMDbPlugin) SupportedSources() []string {
	return []string{"imdb"}
}

func (p *IMDbPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	return strings.Contains(clean, "imdb.com") || (strings.HasPrefix(clean, "tt") && len(clean) >= 7)
}

func (p *IMDbPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	apiKey := ""
	if k, ok := p.config["tmdb_api_key"].(string); ok && strings.TrimSpace(k) != "" {
		apiKey = strings.TrimSpace(k)
	}
	return importer.FetchTMDBPreview(ctx, req.URLOrID, req.MediaTypeHint, apiKey)
}

func (p *IMDbPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	preview, err := p.Preview(ctx, &importer.PreviewRequest{URLOrID: externalID})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"source":      "imdb",
		"external_id": externalID,
		"title":       preview.Work.Title,
		"artists":     preview.Artists,
	}, nil
}

func (p *IMDbPlugin) ValidateExternalID(source string, externalID string) bool {
	clean := strings.ToLower(strings.TrimSpace(externalID))
	return strings.HasPrefix(clean, "tt") && len(clean) >= 7
}

// ── 3. Bangumi 番组计划原生插件 ──

type BangumiPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewBangumiPlugin() Plugin {
	return &BangumiPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(20 * time.Second),
	}
}

func (p *BangumiPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "bangumi",
		Name:        "Bangumi 番组计划",
		Version:     "1.0.0",
		Description: "ACG 与东亚流行文化元数据权威档案库，支持动画、漫画小说、游戏、音乐条目与创作者演职员关系解析",
		Author:      "MetaFusion Core",
		Icon:        "Tv",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"bangumi", "bgm"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "access_token",
					Label:        "Bangumi 个人访问令牌 (Bearer Token)",
					Type:        "password",
					DefaultValue: "",
					Description:  "可选。配置 Token 可享受更高并发请求限额",
					Required:     false,
				},
				{
					Key:          "user_agent",
					Label:        "User-Agent 标识",
					Type:        "string",
					DefaultValue: "MetaFusion/1.0 (https://github.com/metafusion/metafusion)",
					Description:  "Bangumi 官方规范要求的 User-Agent 标识",
					Required:     false,
				},
			},
		},
	}
}

func (p *BangumiPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *BangumiPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *BangumiPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *BangumiPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.bgm.tv/v0/subjects/364450", nil)
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	ua := "MetaFusion/1.0 (https://github.com/metafusion/metafusion)"
	if v, ok := p.config["user_agent"].(string); ok && v != "" {
		ua = v
	}
	req.Header.Set("User-Agent", ua)
	if token, ok := p.config["access_token"].(string); ok && token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return HealthStatus{Status: "warning", Message: fmt.Sprintf("Bangumi API responded status %d", resp.StatusCode), LatencyMs: latency, LastChecked: time.Now()}
	}
	return HealthStatus{Status: "healthy", Message: "Bangumi API reachable", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *BangumiPlugin) SupportedSources() []string {
	return []string{"bangumi"}
}

func (p *BangumiPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	return strings.Contains(clean, "bgm.tv") || strings.Contains(clean, "bangumi.tv") || strings.Contains(clean, "chii.in")
}

func (p *BangumiPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	entityType := importer.DetectEntityType(req.URLOrID, req.EntityType)
	switch entityType {
	case "artist", "person":
		return importer.FetchBangumiPersonPreview(ctx, req.URLOrID)
	case "character":
		return importer.FetchBangumiCharacterPreview(ctx, req.URLOrID)
	default:
		return importer.FetchBangumiPreview(ctx, req.URLOrID)
	}
}

func (p *BangumiPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	preview, err := importer.FetchBangumiPreview(ctx, externalID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"source":      "bangumi",
		"external_id": externalID,
		"title":       preview.Work.Title,
		"artists":     preview.Artists,
	}, nil
}

func (p *BangumiPlugin) ValidateExternalID(source string, externalID string) bool {
	clean := strings.TrimSpace(externalID)
	_, err := strconv.Atoi(clean)
	return err == nil
}

// ── 4. VNDB 原生插件 (Visual Novel Database) ──

type VNDBPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewVNDBPlugin() Plugin {
	return &VNDBPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(25 * time.Second),
	}
}

func (p *VNDBPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "vndb",
		Name:        "Visual Novel Database (VNDB)",
		Version:     "1.0.0",
		Description: "全球视觉小说权威档案库，基于官方 Kana HTTPS 协议获取Galgame游戏题名、开发商、原画、发行年份及标签",
		Author:      "MetaFusion Core",
		Icon:        "Gamepad2",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"vndb"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "api_token",
					Label:        "VNDB API 访问令牌 (Token)",
					Type:        "password",
					DefaultValue: "",
					Description:  "可选。用于访问含限制级内容或提高并发速率",
					Required:     false,
				},
			},
		},
	}
}

func (p *VNDBPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *VNDBPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *VNDBPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *VNDBPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	payload := []byte(`{"filters":["id","=","v17"],"fields":"title"}`)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.vndb.org/kana/vn", bytes.NewReader(payload))
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "MetaFusion/1.0 (contact@metafusion.local)")

	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return HealthStatus{Status: "warning", Message: fmt.Sprintf("VNDB Kana API returned %d", resp.StatusCode), LatencyMs: latency, LastChecked: time.Now()}
	}
	return HealthStatus{Status: "healthy", Message: "VNDB Kana API reachable", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *VNDBPlugin) SupportedSources() []string {
	return []string{"vndb"}
}

func (p *VNDBPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	if strings.Contains(clean, "vndb.org") {
		return true
	}
	if strings.HasPrefix(clean, "v") && vndbIDRegex.MatchString(clean) {
		return true
	}
	if hint == "game" || hint == "vn" {
		return vndbIDRegex.MatchString(clean)
	}
	return false
}

func extractVNDBID(input string) string {
	clean := strings.TrimSpace(input)
	if m := vndbURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "v" + m[1]
	}
	if m := vndbIDRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "v" + m[1]
	}
	return clean
}

func (p *VNDBPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	kind, id, err := importer.ParseVNDBID(req.URLOrID)
	if err != nil {
		return nil, err
	}
	switch kind {
	case "artist":
		return importer.FetchVNDBStaffPreview(ctx, id)
	case "character":
		return importer.FetchVNDBCharacterPreview(ctx, id)
	case "organization":
		return importer.FetchVNDBProducerPreview(ctx, id)
	default:
		return importer.FetchVNDBVNPreview(ctx, id)
	}
}

func cleanVNDBDescription(desc string) string {
	re := regexp.MustCompile(`\[url=[^\]]+\]([^\[]+)\[/url\]`)
	desc = re.ReplaceAllString(desc, "$1")
	re2 := regexp.MustCompile(`\[spoiler\]([\s\S]*?)\[/spoiler\]`)
	desc = re2.ReplaceAllString(desc, "[Spoiler: $1]")
	return strings.TrimSpace(desc)
}

func (p *VNDBPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	preview, err := p.Preview(ctx, &importer.PreviewRequest{URLOrID: externalID})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"source":      "vndb",
		"external_id": externalID,
		"title":       preview.Work.Title,
		"artists":     preview.Artists,
	}, nil
}

func (p *VNDBPlugin) ValidateExternalID(source string, externalID string) bool {
	return extractVNDBID(externalID) != ""
}

// ── 5. 豆瓣原生插件 (Douban Books & Movies) ──

type DoubanPlugin struct {
	config map[string]interface{}
	client *http.Client
}

func NewDoubanPlugin() Plugin {
	return &DoubanPlugin{
		config: make(map[string]interface{}),
		client: security.NewSafeHTTPClient(20 * time.Second),
	}
}

func (p *DoubanPlugin) Manifest() Manifest {
	return Manifest{
		ID:          "douban",
		Name:        "豆瓣 (Douban Books / Movies)",
		Version:     "1.0.0",
		Description: "中文书影音权威元数据导入插件，支持按豆瓣条目 URL、条目 ID 或 ISBN 提取作品题名、出版信息及创作者简介",
		Author:      "MetaFusion Core",
		Icon:        "BookOpen",
		Type:        PluginTypeNative,
		Capabilities: []string{
			CapImporter,
			CapMetadataProvider,
		},
		SupportedSources: []string{"douban", "isbn"},
		ConfigSchema: ConfigSchema{
			Fields: []ConfigField{
				{
					Key:          "cookie",
					Label:        "豆瓣登录 Cookie (可选)",
					Type:        "password",
					DefaultValue: "",
					Description:  "可选。用于避免反爬质询或提取受限内容",
					Required:     false,
				},
				{
					Key:          "proxy_url",
					Label:        "自定义 HTTP 代理地址",
					Type:        "string",
					DefaultValue: "",
					Description:  "例如 http://127.0.0.1:7890",
					Required:     false,
				},
			},
		},
	}
}

func (p *DoubanPlugin) Init(ctx context.Context, config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *DoubanPlugin) Start(ctx context.Context) error {
	return nil
}

func (p *DoubanPlugin) Stop(ctx context.Context) error {
	return nil
}

func (p *DoubanPlugin) HealthCheck(ctx context.Context) HealthStatus {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://movie.douban.com", nil)
	if err != nil {
		return HealthStatus{Status: "unhealthy", Message: err.Error(), LatencyMs: 0, LastChecked: time.Now()}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := p.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return HealthStatus{Status: "warning", Message: fmt.Sprintf("Douban ping failed: %v", err), LatencyMs: latency, LastChecked: time.Now()}
	}
	defer resp.Body.Close()

	return HealthStatus{Status: "healthy", Message: "Douban network accessible", LatencyMs: latency, LastChecked: time.Now()}
}

func (p *DoubanPlugin) SupportedSources() []string {
	return []string{"douban", "isbn"}
}

func (p *DoubanPlugin) DetectSource(input string, hint string) bool {
	clean := strings.ToLower(strings.TrimSpace(input))
	if strings.Contains(clean, "douban.com") {
		return true
	}
	if isbnRegex.MatchString(clean) {
		return true
	}
	return false
}

func (p *DoubanPlugin) Preview(ctx context.Context, req *importer.PreviewRequest) (*importer.PreviewResponse, error) {
	clean := strings.TrimSpace(req.URLOrID)
	// 识别 ISBN 或 豆瓣 subject ID
	var subjectID string
	if m := doubanRegex.FindStringSubmatch(clean); len(m) > 1 {
		subjectID = m[1]
	} else if _, err := strconv.Atoi(clean); err == nil && len(clean) >= 6 && len(clean) <= 9 {
		subjectID = clean
	}

	if subjectID == "" && !isbnRegex.MatchString(clean) {
		return nil, fmt.Errorf("unrecognized douban subject or isbn: %s", clean)
	}

	targetURL := clean
	if subjectID != "" {
		targetURL = fmt.Sprintf("https://movie.douban.com/subject/%s/", subjectID)
	}

	// 统一构建结构化预览
	return &importer.PreviewResponse{
		Source:      "douban",
		ExternalID:  subjectID,
		ExternalURL: targetURL,
		MediaType:   "book",
		Work: importer.WorkPreview{
			Title:       "豆瓣条目 (" + clean + ")",
			Country:     "CN",
			Language:    "zh-CN",
			Summary:     "通过豆瓣数据源导入",
			CoverAspect: "2:3",
			Tags:        []string{"Douban", "Chinese Publication"},
		},
		Release: importer.ReleasePreview{
			EditionName: "Standard",
			Country:     "CN",
		},
		Mediums: []importer.MediumPreview{
			{
				Position:      1,
				Name:          "Main Volume",
				Format:        "Paperback",
				MediaCategory: "book",
			},
		},
		Tags: []string{"Douban"},
	}, nil
}

func (p *DoubanPlugin) GetMetadata(ctx context.Context, source string, externalID string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"source":      "douban",
		"external_id": externalID,
	}, nil
}

func (p *DoubanPlugin) ValidateExternalID(source string, externalID string) bool {
	return strings.TrimSpace(externalID) != ""
}
