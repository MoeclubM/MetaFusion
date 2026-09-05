# MetaFusion 插件系统与依赖拓扑架构规范 (Plugin System & DAG Architecture)

本文档面向 MetaFusion 核心开发与系统架构人员，严格基于当前后端代码实现（`backend/internal/plugin/`），阐明 MetaFusion 的**插件系统实现机制**、**12 个原生内置插件矩阵**与 **DAG 依赖拓扑治理规范**。

---

## 1. 架构定位与设计原则

MetaFusion 插件系统遵循**「极简 LRM 实体内核 + 进程内原生插件化 (In-Process Native Plugins)」**设计：
1. **实体内核纯粹性**：核心目录层（`Work` / `Release` / `Medium` / `Track` / `CanonicalEntry`）保持简洁标准，不内嵌任何特定第三方平台的抓取或私有格式导出逻辑；
2. **进程内原生常驻**：当前系统内置的 **12 个核心插件全部以 Go 原生代码实现**，通过工厂注册表（`Registry`）在服务启动时注入，与主服务同进程运行，零进程间网络与 IPC 开销；
3. **DAG 依赖拓扑治理**：引入有向无环图（DAG）调度引擎，支持插件间 Semver 版本依赖声明、DFS 循环依赖拦截、拓扑序启动与级联启停保护；
4. **动态配置与状态持久化**：插件元数据、配置表单架构（`ConfigSchema`）及运行开关持久化于 PostgreSQL `system_plugins` 表，支持管理后台在线配置热更新。

---

## 2. 现有 12 个原生内置插件矩阵 (100% 代码对应)

当前代码库在 `backend/internal/plugin/manager.go` 中通过 `reg.RegisterFactory` 注册了以下 12 个原生内置插件：

```
                              ┌────────────────────────────────────────┐
                              │       MetaFusion LRM 实体核心          │
                              │ (Work / Release / Medium / Track / CE) │
                              └───────────────────┬────────────────────┘
                                                  │ (统一 Plugin 接口)
         ┌──────────────────┬─────────────────────┼────────────────────┬──────────────────┐
         ▼                  ▼                     ▼                    ▼                  ▼
┌─────────────────┐┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐┌─────────────────┐
│ 外部数据抓取导入 ││ 规范与格式导出 │  │ 媒体声学分析    │  │ AI 智能与增强   ││ 全域事件通知   │
│ (Importers)     ││ (Exporters)     │  │ (Media Helper)  │  │ (AI Enrichment) ││ (Notifiers)     │
│                 ││                 │  │                 │  │                 ││                 │
│ • musicbrainz   ││ • picard_exporter│ │ • acoustid_helper│ │ • ai_enrichment ││•webhook_notifier│
│ • tmdb          ││   (依赖 MBID)   │  │   (依赖 MBID)   │  │   (LLM 题名/标签)││ (Discord/飞书/ │
│ • imdb          ││ • jsonld_exporter│ └─────────────────┘  └─────────────────┘│  通用 JSON)    │
│ • bangumi       ││ • bibtex_exporter│                                         └─────────────────┘
│ • vndb          │└─────────────────┘
│ • douban        │
└─────────────────┘
```

### 2.1 外部元数据抓取与导入插件 (Native Importers)
实现 `ImporterPlugin` 与 `MetadataProviderPlugin` 接口（`backend/internal/plugin/native_importers.go`）：

| 插件 ID | 版本 | 能力声明 (`Capabilities`) | 支持数据源 (`SupportedSources`) | 说明 |
| :--- | :---: | :--- | :--- | :--- |
| `musicbrainz` | `1.0.0` | `importer`, `metadata_provider` | `musicbrainz`, `mbid` | 抓取 MusicBrainz 权威音乐实体、Release 发行版、Medium 介质与录音母带，支持 MBID 精确解析 |
| `tmdb` | `1.0.0` | `importer`, `metadata_provider` | `tmdb` | 抓取 The Movie Database 影视作品、海报剧照、季数/分集与演职员演变 |
| `imdb` | `1.0.0` | `importer`, `metadata_provider` | `imdb` | 抓取 IMDb 权威影视元数据、评分与核心演职员关联 |
| `bangumi` | `1.0.0` | `importer`, `metadata_provider` | `bangumi`, `bgm` | 抓取 Bangumi 番组计划动画、分集列表（正片/SP/OVA）、关联条目与轻小说 |
| `vndb` | `1.0.0` | `importer`, `metadata_provider` | `vndb` | 抓取 Visual Novel Database 视觉小说/Galgame、制作公司、角色与标签体系 |
| `douban` | `1.0.0` | `importer`, `metadata_provider` | `douban` | 抓取豆瓣华语电影、剧集、音乐及图书出版信息 |

### 2.2 规范与多格式数据导出插件 (Native Exporters)
实现 `ExportPlugin` 接口（`backend/internal/plugin/native_extensions.go`）：

| 插件 ID | 版本 | 导出格式 | 文件扩展名 | 依赖项 (`Dependencies`) | 说明 |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `picard_exporter` | `1.0.0` | `picard`, `json` | `.picard.json` | `musicbrainz: ">=1.0.0"` | 导出供 MusicBrainz Picard、Foobar2000、Beets 等播放器自动打标的标准音轨元数据包 |
| `jsonld_exporter` | `1.0.0` | `jsonld`, `json` | `.jsonld` | 无 | 将作品、版本、演职员导出为符合 W3C Schema.org 与 IFLA LRM 语义网互操作标准的 JSON-LD |
| `bibtex_exporter` | `1.0.0` | `bibtex`, `ris` | `.bib` | 无 | 将图书、典藏画册与期刊条目导出为学术文献 BibTeX 与 Zotero / EndNote RIS 引用格式 |

### 2.3 媒体处理与声学指纹辅助插件 (Native Media Helper)
实现 `Plugin` 与 `MetadataProviderPlugin` 接口（`backend/internal/plugin/native_extensions.go`）：

| 插件 ID | 版本 | 能力声明 | 依赖项 (`Dependencies`) | 说明 |
| :--- | :---: | :--- | :--- | :--- |
| `acoustid_helper` | `1.0.0` | `transcoder_hook`, `metadata_provider` | `musicbrainz: ">=1.0.0"` | 计算 Chromaprint 音频指纹哈希，并在音频资产入库时与 MusicBrainz 录音库比对对齐 |

### 2.4 AI 智能与多语言增强插件 (Native AI Enrichment)
实现 `Plugin` 接口（`backend/internal/plugin/native_extensions.go`）：

| 插件 ID | 版本 | 能力声明 | 说明 |
| :--- | :---: | :--- | :--- |
| `ai_enrichment` | `1.0.0` | `ai_enrichment` | 基于 LLM 大语言模型端点，针对录入实体推断多语言题名映射（`work_translations`）及本体分类标签 |

### 2.5 全系统事件通知广播插件 (Native Notifiers)
实现 `Plugin` 接口（`backend/internal/plugin/native_extensions.go`）：

| 插件 ID | 版本 | 能力声明 | 支持事件 (`SupportedEvents`) | 说明 |
| :--- | :---: | :--- | :--- | :--- |
| `webhook_notifier` | `1.0.0` | `notification` | `work.created`, `work.updated`, `work.deleted`, `revision.applied`, `review.approved`, `import.completed` | 支持配置多个 Webhook 目标地址与 HMAC-SHA256 签名，内置通用 JSON、Discord 嵌入卡片、飞书机器人卡片渲染 |

---

## 3. DAG 依赖拓扑治理引擎规范

插件内核调度引擎位于 `backend/internal/plugin/dependency.go`。

### 3.1 语义化版本约束 (Semver Constraint)
插件依赖通过 `Dependencies map[string]string` 声明，版本比对引擎（`ParseSemver` 与 `Semver.Matches`）支持：
- 精确匹配：`1.0.0`
- 下限约束：`>=1.0.0`、`>1.0.0`
- 上限约束：`<=2.0.0`、`<2.0.0`
- 语义兼容符：`^1.2.0`（允许非破坏性次版本与补丁升级：`>=1.2.0 <2.0.0`）
- 次版本兼容符：`~1.2.0`（允许补丁升级：`>=1.2.0 <1.3.0`）
- 组合区间：`>=1.0.0 <=2.0.0`

### 3.2 拓扑排序启动流程 (Topological Sort)
系统在引导初始化时，收集已启用的原生插件节点构建有向图（`DependencyGraph`），执行拓扑排序并确定加载序号：

```
[系统引导/启动]
       │
       ▼
[收集已启用插件 Manifest] ───► [构建 DependencyGraph 有向图]
                                         │
                                         ▼
                               [DFS 三色标记环路检测 (CheckCycles)]
                                         │ (检测到环: 报错并阻断启动)
                                         ▼
                               [Kahn/DFS 拓扑排序 (TopologicalSort)]
                                         │
                                         ▼
                 [按拓扑序逐个执行: 基础依赖插件先启动，后置依赖插件后启动]
                 (例: #1 musicbrainz -> #2 picard_exporter / acoustid_helper)
```

### 3.3 循环依赖检测机制 (Cycle Detection)
基于深度优先搜索（DFS）和三色状态标记算法：
- **White (未访问)**：节点尚未遍历；
- **Gray (访问中)**：当前 DFS 递归调用栈上的节点。若在递归深入时再次命中 Gray 节点，即判定存在回路，立即提取回溯栈返回具体循环链（如 `A -> B -> C -> A`）；
- **Black (已完成)**：节点及其所有下游邻接边已完整遍历且无回路。

### 3.4 级联启停保护规则 (Cascade Semantics)

| 操作行为 | 触发前置条件 | 默认行为 (`cascade=false`) | 级联模式 (`cascade=true`) |
| :--- | :--- | :--- | :--- |
| **启用插件 A** | A 所需的前置依赖 B 处于停用状态 | 拒绝启用，提示未激活的前置依赖项列表 | 沿依赖链正拓扑序，先自动启用前置依赖 B，再启用 A |
| **启用插件 A** | A 所需的前置依赖 B 缺失或版本不满足 | 拒绝启用并明确报错 | 拒绝启用并明确报错 |
| **停用插件 B** | 存在处于活跃运行状态的后置依赖项 A | 拒绝停用，告警依赖 B 的所有活跃插件 | 沿被依赖链逆拓扑序，先级联停用后置插件 A，再停用 B |
| **删除插件 B** | 存在声明依赖于 B 的其他插件 | 拒绝删除，保护图拓扑完整性 | 需先解除依赖关系或停用依赖项 |

---

## 4. 数据库持久化与 HTTP 接口

### 4.1 数据模型 (`system_plugins` 表)
定义于 `backend/internal/models/models.go`：
```go
type SystemPlugin struct {
    ID           string         `gorm:"primaryKey;type:varchar(64)" json:"id"`
    Name         string         `gorm:"type:varchar(128);not null" json:"name"`
    Version      string         `gorm:"type:varchar(32);not null" json:"version"`
    Description  string         `gorm:"type:text;not null" json:"description"`
    Author       string         `gorm:"type:varchar(128);not null" json:"author"`
    Icon         string         `gorm:"type:varchar(64);default:'Puzzle';not null" json:"icon"`
    Type         string         `gorm:"type:varchar(32);default:'native';not null" json:"type"`
    EndpointURL  string         `gorm:"type:varchar(512);default:'';not null" json:"endpoint_url"`
    SecretToken  string         `gorm:"type:varchar(255);default:'';not null" json:"secret_token,omitempty"`
    Capabilities pq.StringArray `gorm:"type:text[];not null" json:"capabilities"`
    Dependencies JSONB          `gorm:"type:jsonb;default:'{}'" json:"dependencies"`
    ConfigSchema JSONB          `gorm:"type:jsonb;default:'{}'" json:"config_schema"`
    Config       JSONB          `gorm:"type:jsonb;default:'{}'" json:"config"`
    IsEnabled    bool           `gorm:"default:true;not null" json:"is_enabled"`
    IsSystem     bool           `gorm:"default:false;not null" json:"is_system"`
    CreatedAt    time.Time      `json:"created_at"`
    UpdatedAt    time.Time      `json:"updated_at"`
}
```

### 4.2 API 路由接口清单 (`backend/internal/plugin/handler.go`)
- `GET /api/v1/catalog/plugins`：公开接口，获取当前已启用的插件精简元数据（供前端渲染导入源选择框、导出按钮列表）；
- `GET /api/v1/admin/plugins`：管理员接口，获取全量插件列表（含启停状态、健康检查结果、实时延迟、依赖评估及拓扑序号）；
- `PATCH /api/v1/admin/plugins/:id`：管理员接口，切换插件开关（支持 `cascade=true` 级联生效）或更新配置字段；
- `POST /api/v1/admin/plugins/test-notify`：管理员接口，向已启用的通知类插件广播测试事件验证 Webhook 链路；
- `POST /api/v1/admin/plugins/register`：管理员接口，通过底层抽象驱动（`ExternalHTTPPlugin`）登记第三方自定义 HTTP Webhook 扩展端点。
