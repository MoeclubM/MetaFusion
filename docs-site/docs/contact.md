---
title: "联系方式"
description: "如何联系站务、报告问题与贡献文档。"
order: 60
group: "meta"
---

# 联系方式

## 站务

- **GitHub**：[MoeclubM/MetaFusion](https://github.com/MoeclubM/MetaFusion)（提 Issue / PR 最快）
- **站内私信**：登录后在站务账号主页点击「发送私信」，或在社区发帖时 @站务
- **社区板块**：在 `/community` 的 `general` 或 `announcement` 下发帖，标题前缀 `[反馈]` / `[合规]` 便于分拣

## 报告问题

| 类型 | 去哪 |
|---|---|
| 侵权 / 合规 | 社区私信站务 + 附 URL 与权属证明（见 [版权与 DMCA](/copyright)） |
| 审核申诉 | 站内私信，附 Work/Release ID 与修订记录 |
| Bug / 功能建议 | GitHub Issue，附复现步骤与截图 |
| 文档错误 | GitHub PR 直接改 `docs-site/content/docs/*.md` |

## 贡献文档

本文档站内容位于 `docs-site/content/docs/`，每篇 Markdown 含 frontmatter：

```yaml
---
title: "标题"
description: "一句话摘要"
order: 31
group: "api"  # start / model / guide / api / community / legal / meta
---
```

修改后本地预览：

```bash
cd docs-site && npm install && npm run dev  # http://localhost:3001/overview
```

构建产物为 Next.js standalone，随 `docker compose up` 一键拉起。

## 响应时间

站务为志愿运营，工作日 24–48 小时内响应，合规类优先处理。
