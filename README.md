# <img src="frontend/public/mark.svg" width="28" height="28" alt="MetaFusion"/> MetaFusion

<p align="center">
  <strong>为收藏家而生的多媒介典藏与流媒体平台</strong><br/>
  电影 · 剧集 · 动漫 · 音乐 · 有声书 · 图书 · 漫画 · 画册 — 一处归档，处处可播
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-black?style=flat-square" alt="License"/></a>
  <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"/>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs"/>
  <img src="https://img.shields.io/badge/i18n-中文%20%7C%20English-blue?style=flat-square" alt="i18n"/>
</p>

<p align="center">
  <a href="#-为什么选择-metafusion">为什么选择</a> •
  <a href="#-核心能力">核心能力</a> •
  <a href="#-三步启动">三步启动</a> •
  <a href="docs/requirements.md">产品文档</a>
</p>

---

> **一句话介绍**  
> MetaFusion 把 “图书管理员的严谨” 与 “流媒体的爽快” 装进同一个产品：用图书馆级的编目体系整理你的每一份收藏，用影院级的播放体验随时重温。无论是 4K 原盘、黑胶转录，还是绝版漫画与设定画集，都能在同一个知识网络中被精确描述、互相勾连、一键播放。

---

### 预览

<p align="center">
  <img src="docs/assets/hero-explore.png" width="800" alt="探索页-货架与分类" onerror="this.style.display='none'"/>
  <br/><em>探索页 · 货架是活的筛选器，不是死文件夹 — 风格、年代、规格随点随得</em>
</p>

<p align="center">
  <img src="docs/assets/hero-player.png" width="800" alt="播放与详情" onerror="this.style.display='none'"/>
  <br/><em>详情页 · 作品—版本—载体—条目—文件五级结构，关联创作者与版本沿革一目了然</em>
</p>

> 图片占位，首次启动后访问 `http://localhost/explore` 与 `http://localhost/works/[id]` 即可看到同款界面。

---

### ✨ 为什么选择 MetaFusion

| 痛点 | 常见方案 | MetaFusion 的做法 | 你得到什么 |
|---|---|---|---|
| 文件一多就乱，版本分不清 | 文件夹 + 表格 | **FRBR 五级模型**：作品只描述“是什么”，版本描述“哪一次出版”，载体/条目/文件描述“怎么存的” | 同一部电影的 2 种剪辑、3 种碟片、12 条音轨不再互相覆盖 |
| 信息孤岛，搜不到 | 文件名搜索 | **编目即知识图谱**：创作者、厂牌、关联作品、关系类型可无限扩展，支持时态（任职 1996–2007） | 从“作曲是谁”一路点到“同期录音的另一张专辑” |
| 原盘太大，预览太慢 | 下载后本地播 | **秒传 + 预签名直传 + 异步转码**：SHA-256 秒传命中即关联，浏览器直传至对象存储，转码后 HLS/320k/WebP 预览 | 上传不经过业务服务器，千人同时传盘不卡；点开即播，无需等转码 |
| 收藏与社区割裂 | 收藏用 A，讨论用 B | **典藏与论坛一体化**：每部作品自带考据区，论坛支持分区、标签、@回复与多语言 | 边看边考据，考据本身成为可检索的文献 |
| 私有还是公开纠结 | 要么全公开要么全私有 | **元数据开放，媒体受控**：作品信息游客可索引与检索，原档/切片仅登录可见，邀请制可一键开关 | 既能被搜索引擎收录，又不担心直链外泄 |

---

### 🎯 核心能力

#### 📚 典藏，就该像图书馆一样严谨

- **五级 FRBR**：`作品 → 版本 → 载体 → 条目 → 文件`，同一录音可被中/美/日三版专辑共同引用，不再复制粘贴。
- **多维标签 + 虚拟货架**：风格、介质、规格、主题自由组合；货架由标签规则动态生成，“宫崎骏 1990s 剧场版”“DSD256 爵士”点一下即是。
- **创作者档案**：人、乐团、工作室、厂牌、出版社统一为 Artist，支持别名、存续时间、外部权威链接（MusicBrainz / TMDB / Bangumi）。
- **关系网络**：作品—作品、艺术家—艺术家、作品—艺术家均可自定义关系类型（翻唱、致敬、成员变动），带起止时间，自动生成可视化图谱。
- **多语言与修订**：标题、简介、厂牌均可多语言对照；每一次编辑留痕、可回溯、可合并实体。

#### ▶️ 播放，就该像流媒体一样顺滑

- **影视/动漫**：上传后自动转 HLS 自适应码率，雪碧图气泡预览，拖动即见画面。
- **音乐/有声书**：320k 预览流秒开，全局底栏切页不断播；封面、歌词、CUE/Log 随文件一并归档。
- **图书/漫画/画册**：EPUB/PDF 流式阅读，双页漫画无级缩放，画册 WebP 渐进加载。
- **直链安全**：所有二进制通过短期预签名访问，直传与预览均校验身份，Nginx 仅透传不透权。

#### 👥 社区，就该围绕收藏生长

- **分区 + 标签双过滤**：公告、技术、考据、综合分区；话题可绑定作品与标签。
- **Discourse 式楼层**：每贴即一楼，`#1` 即主题正文，`#2+` 为回复，支持楼中楼引用与已读管理。
- **私信与贡献墙**：私信对话按人聚合，未读实时计数；个人主页聚合“创建的作品/版本/艺术家/话题/审核”全链路。

#### 🛡️ 运营，就该省心且可进化

- **邀请制是风控，不是门槛**：后台一键开关 `registration_enabled / invite_required`，邀请码永久有效且可追溯邀请链。
- **后台一体化**：审核、分类、货架、标签、关系、翻译、审计日志均在 `/admin` 完成，无需第二套系统。
- **单机起步，平滑上云**：一台 NAS 即可跑全栈；存储可换 R2/Ceph，Worker 可迁 K8s GPU 集群，无需重构。

---

### 🚀 三步启动

> 不讲技术细节，只保证你能跑起来。详细部署见 `deploy/` 与 `docs/requirements.md`

**1. 准备**

- 安装 Docker Desktop（Windows 推荐 WSL2）
- 克隆：`git clone https://github.com/<your-org>/metafusion.git && cd metafusion`

**2. 配置**

```bash
cp .env.example .env
# 用编辑器打开 .env，填入三个强随机值：
# DB_PASSWORD / MINIO_ROOT_PASSWORD / JWT_SECRET
# 生成示例：openssl rand -base64 32
```

**3. 启动**

```bash
# 一键（Linux / macOS / WSL）
docker compose -f deploy/docker-compose.yml up -d
# 或极速脚本：bash deploy/deploy.sh fast
# Windows：.\deploy\deploy.ps1 fast

# 打开 http://localhost
# 首次登录后请立即在“设置”中修改密码，并在“管理后台 → 系统设置”中按需开启/关闭邀请
```

---

### 🗺️ 适合谁

- **个人收藏家**：把散落在硬盘的原盘、抓轨、扫描本变成可检索的私人博物馆
- **小团队/工作室**：为厂牌、出版社或同好会提供带审核的共建文库
- **社区运营者**：需要“可考据、可追溯、可播放”的垂直资源站，而非普通网盘

---

### 🔭 路线图

- [x] FRBR 典藏与多媒介转码
- [x] 货架、图谱、修订历史与多语言
- [x] 邀请制与后台治理
- [ ] 收藏夹与清单（用户自建公开/私有货架已上线，分享页优化中）
- [ ] 推荐与相似度（基于标签与关系图谱）
- [ ] 移动端 PWA 离线缓存与投屏

欢迎在 Issues 投票你最想要的下一个能力。

---

### 🤝 参与

- 提 Bug 请带复现步骤与截图
- 提功能请先看 `docs/requirements.md` 的访问模型（元数据开放/媒体受控）
- PR 前请跑 `docker compose -f deploy/docker-compose.yml config` 与 `npm run build`（前端在 `frontend/`）

---

### 📄 许可

[AGPL-3.0](LICENSE) — 可自托管商用，修改后需以同协议开源网络服务。

<p align="center"><sub>Built for collectors, by collectors. — 如果它帮你找回了一张找了十年的碟，就值得。</sub></p>
