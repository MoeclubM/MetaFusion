# MetaFusion 核心系统解耦与插件化演进蓝图 (Plugin Architecture & Decoupling Blueprint)

本文档面向 MetaFusion 架构师、全栈开发团队与编目系统专家，详细阐明 MetaFusion 的**插件依赖关系治理架构**，以及**主系统功能向可扩展插件解耦迁移的演进清单与蓝图**。

---

## 核心架构问题回答

### 问题一："插件依赖关系做了吗？"
**已全面落地并上线生产级依赖治理拓扑引擎**。

在 MetaFusion 插件系统内核（`backend/internal/plugin/`）中，构建了完整的有向无环图（DAG）依赖拓扑分析与调度机制：
1. **语义化依赖声明 (`Dependencies`)**：每个插件在 `Manifest` 与数据库实体中通过 `map[string]string` 声明前置依赖插件 ID 与 Semver 版本约束（如 `{"musicbrainz": ">=1.0.0"}`），支持精确匹配、`>=`、`<=`、`^`（语义兼顾）、`~`（次版本兼顾）与组合范围；
2. **拓扑排序启动机制 (Topological Loading & Startup Order)**：系统在初始化与服务引导时，自动执行有向图拓扑排序，确保**前置依赖插件先于后置插件初始化与启动**（依赖插件 -> 被依赖插件），停用时逆序执行；
3. **循环依赖冲突检测 (Cycle Detection)**：基于 DFS 着色检测（White-Gray-Black 状态标记），在注册外部插件或初始化时若存在回路（如 `A -> B -> C -> A`），立即拦截并返回具体回路追踪链；
4. **级联启停安全保护 (Cascade Enable / Disable Protection)**：
   - **启用保护**：当启用某插件而其前置依赖未就绪时，拦截并提示未激活依赖项，支持 `cascade=true` 按拓扑序一键级联拉起前置依赖链；
   - **停用保护**：当停用某核心插件（如 `musicbrainz`）时，若存在运行中的被依赖项（如 `picard_exporter`、`acoustid_helper`），系统将拦截危险操作，支持 `cascade=true` 一键逆序级联停用所有后置插件；
5. **前端可视化依赖拓扑**：在管理后台插件中心实时展示「前置依赖」与「被依赖」标签、依赖满足状态指示灯及加载拓扑序号（`#1`, `#2`）。

---

### 问题二："目前有哪些功能可以从主系统解耦挪到插件？"

经过对 MetaFusion 核心主系统（`backend/` 与 `frontend/`）的深度架构梳理，确立了**「极简 LRM 实体内核 + 边缘业务全插件化」**的演进方针。以下 6 大业务领域与核心实体存储弱相关、演化频繁、具有高度多样性，已定义为可解耦插件化模块：

```
                             ┌───────────────────────────────────────┐
                             │       MetaFusion LRM 实体内核         │
                             │ (Work / Release / Medium / Track DAG) │
                             └──────────────────┬────────────────────┘
                                                │
         ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
         ▼                  ▼                   ▼                   ▼                  ▼
┌─────────────────┐┌─────────────────┐┌─────────────────┐┌─────────────────┐┌─────────────────┐
│ 外部数据抓取导入 ││ 多格式数据导出 ││ 通知与协同外发 ││ 媒体分析/转码   ││ AI 增强与质检   │
│ (Importers)     ││ (Exporters)     ││ (Notifiers)     ││ (Transcoders)   ││ (Enrichment)    │
│                 ││                 ││                 ││                 ││                 │
│ • MusicBrainz   ││ • Picard Tags   ││ • Webhook 广播  ││ • AcoustID 指纹 ││ • AI 多语言翻译 │
│ • TMDB / IMDb   ││ • LRM JSON-LD   ││ • Discord 机器人││ • 歌词/字幕提取││ • ISRC/ISBN 查重│
│ • Bangumi / VNDB││ • BibTeX / RIS  ││ • 飞书 / 企微   ││ • 封面调色盘    ││ • 实体别名推断  │
│ • 豆瓣 / 读书   ││ • CSV / Excel   ││ • Telegram Bot  ││ • FFmpeg 扩展   ││ • 自动分类打标  │
└─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘
```

#### 1. 外部元数据抓取与数据源导入 (Metadata Importers & Ingestion)
- **解耦现状与收益**：各垂直领域的第三方 API 频繁调整反爬策略、数据格式和鉴权方式。剥离为主系统外部插件后，单个数据源变动无需重新发布 MetaFusion 核心服务端，且支持社区以独立微服务形式编写新数据源。
- **解耦清单**：
  - `importer_musicbrainz`：MBID 音乐实体与介质音轨解析；
  - `importer_tmdb`：影视元数据、演职员表与剧集季数映射；
  - `importer_bangumi`：ACG 动画、轻小说与条目关联导入；
  - `importer_vndb`：视觉小说、开发商与角色标签导入；
  - `importer_douban`：书籍与华语影视图文抓取；
  - `importer_goodreads` / `importer_spotify` / `importer_steam`：未来社区扩展源。

#### 2. 多格式数据导出与知识图谱外发 (Data Exporters & Semantic Formats)
- **解耦现状与收益**：用户对数据消费格式各异（本地播放器打标、学术引用、知识图谱共享）。导出逻辑依赖主模型只读快照，解耦为插件后可动态增删支持格式，前端导出菜单自动根据已启用插件刷新。
- **解耦清单**：
  - `picard_exporter`：MusicBrainz Picard / Foobar2000 / Beets 音乐标签规范 JSON 导出；
  - `jsonld_exporter`：W3C Schema.org 与 IFLA LRM 语义网 RDF 知识图谱导出；
  - `bibtex_exporter`：图书文献 BibTeX 与 Zotero / EndNote RIS 引用格式导出；
  - `csv_exporter`：馆藏实体与资产批量表格导出。

#### 3. 通知与第三方协作推送 (Notifications & Webhooks)
- **解耦现状与收益**：新条目入库、合并评审、版本快照发布需要向不同通讯平台广播。主系统仅负责触发通用 Domain Event，由各通知插件异步处理排版、鉴权与重试。
- **解耦清单**：
  - `webhook_notifier`：通用 HMAC 签名 Webhook 广播；
  - `discord_bot`：Discord 频道富文本嵌入卡片推送；
  - `feishu_notifier`：飞书群机器人互动卡片推送；
  - `telegram_notifier`：Telegram 频道与管理员群播报；
  - `slack_notifier` / `wecom_notifier`：企业办公平台接入。

#### 4. 媒体处理与辅助转码钩子 (Transcoding & Media Fingerprinting)
- **解耦现状与收益**：音视频特征提取通常依赖重型 C++ 绑定或外部二进制库（如 Chromaprint、libass）。插件化后可在轻量容器中按需启动或委托给边缘 Worker。
- **解耦清单**：
  - `acoustid_helper`：计算 Chromaprint 音频指纹并联动 MusicBrainz 录音库对齐；
  - `lyrics_subtitle_extractor`：从 FLAC/MP4 内嵌流或外部文件提取 LRC/SRT/ASS 并生成时间轴注记；
  - `palette_extractor`：从作品封面提取 Vibrant 主色调与主题渐变。

#### 5. AI 智能辅助与元数据质检 (AI & LLM Enrichment / QA Plugins)
- **解耦现状与收益**：大模型翻译、智能打标、题名本地化易随 Prompt 和模型升级而迭代，解耦为独立插件可自由配置 OpenAI、DeepSeek、Claude 或本地 Ollama 端点。
- **解耦清单**：
  - `ai_enrichment`：基于 LLM 自动推断多语言题名 (`work_translations`) 与简介；
  - `deduplication_qa`：基于 ISRC / ISBN / 跨语言标题编辑距离执行实体查重审查；
  - `tag_auto_classifier`：依据主题与流派自动建议本体论标签（Ontology Tags）。

#### 6. 开放认证与第三方登录 (OAuth Providers)
- **解耦现状与收益**：各平台 OAuth2 / OIDC 流程标准化，将其插件化后管理员可在后台一键开启特定登录渠道（如 Linux.do、Discord、GitHub、Google），动态扩展企业单点登录（SSO/SAML）。

---

## 插件依赖治理体系技术规范

### 1. 依赖声明格式 (Manifest)

```go
type Manifest struct {
    ID           string            `json:"id"`
    Name         string            `json:"name"`
    Version      string            `json:"version"`
    Type         string            `json:"type"` // "native", "external_http", "webhook"
    Capabilities []string          `json:"capabilities"`
    // 显式声明前置依赖插件及语义版本范围
    Dependencies map[string]string `json:"dependencies,omitempty"`
}
```

示例：
```json
{
  "id": "picard_exporter",
  "name": "MusicBrainz Picard 音乐元数据导出器",
  "version": "1.0.0",
  "capabilities": ["export"],
  "dependencies": {
    "musicbrainz": ">=1.0.0"
  }
}
```

### 2. 拓扑调度生命周期 (DAG Lifecycle)

```
[系统引导/重载]
       │
       ▼
[收集所有插件 Manifest] ───► [构建全局有向图 DependencyGraph]
                                      │
                                      ▼
                             [DFS 环形检测 (CheckCycles)]
                                      │ (若有环: 报错并阻断)
                                      ▼
                             [Kahn/DFS 拓扑排序 (TopologicalSort)]
                                      │
                                      ▼
                      [顺序启动: 依赖项 #1 -> 依赖项 #2 -> 被依赖项 #3]
```

### 3. 级联启停规则 (Cascade Semantics)

| 操作类型 | 场景条件 | 默认行为 (`cascade=false`) | 级联模式 (`cascade=true`) |
| :--- | :--- | :--- | :--- |
| **启用插件 A** | A 依赖的插件 B 处于停用状态 | 拦截请求，返回未激活依赖项提示 | 沿依赖链拓扑正序，自动一键拉起前置依赖 B，再启用 A |
| **启用插件 A** | A 依赖的插件 B 缺失或版本不兼容 | 拒绝请求并提示缺失项 | 拒绝请求并提示缺失项 |
| **停用插件 B** | 存在处于活跃运行状态的依赖项 A | 拦截请求，告警依赖于 B 的活跃插件 | 沿被依赖链逆拓扑序，先停用后置插件 A，再停用 B |
| **删除插件 B** | 存在声明依赖于 B 的其他插件 | 拒绝删除，保护系统完整性 | 需先卸载后置插件或解除依赖关系 |

---

## 前端可视化与多语言保障

1. **依赖徽章呈现**：
   - 绿色徽章：依赖插件已安装且正在运行；
   - 黄色徽章：依赖插件已安装但处于停用状态；
   - 红色徽章：依赖插件未安装或版本约束不满足。
2. **零硬编码国际化规范**：
   - 所有插件中心 UI 文本、弹窗说明与提示信息统一收敛至 `frontend/src/messages/{zh-CN,en-US}.json` 下的 `admin.plugins.*` 字典空间；
   - 严格遵循 `i18n-localization-strict.mdc` 规则，严禁任何硬编码文案。

---

## 结论与演进路线

通过引入依赖拓扑图治理、语义化版本约束以及 6 大解耦清单，MetaFusion 实现了**底层实体核心高度纯粹、外围生态无限扩展**的现代架构基石。未来新增的抓取源、格式转换器与 AI 工作流均可作为自包含插件无缝接入。
