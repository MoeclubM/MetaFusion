---
title: "常见问题"
description: "FAQ：邀请、审核、播放、API、限流等。"
order: 61
group: "meta"
---

# 常见问题（FAQ）

## 邀请

**Q：现在注册需要邀请码吗？**  
A：取决于后台开关。访问 `GET /api/v1/auth/settings` 或打开 `/login`，页面会动态提示“需要/不需要邀请码”。活动期可能临时开放。

**Q：哪里获得邀请码？**  
A：已注册用户在 `/invites` 或 `GET /auth/invite` 获取自己的 `MF-` 永久码与剩余配额。

## 浏览与媒体

**Q：游客能看什么？**  
A：全部元数据（作品/发行/创作者/分类/标签/搜索/社区文字）。点击播放/下载/上传/发帖时会引导登录。

**Q：为什么播放 401？**  
A：媒体受控，需 `Authorization: Bearer <JWT|PAT>`。确认已登录且请求透传了鉴权头，`/storage/preview/*` 当前由 MinIO 直出，生产需收紧为预签名。

**Q：封面不显示？**  
A：`cover_url` 会经 `validateCoverURL` 校验，非法外链会被拒绝。请使用站内上传或可信图床直链。

## 编辑与审核

**Q：为什么编辑被退回？**  
A：常见原因：缺少 `edit_note` / `source_urls`、标题或关联错误、重复创建。按审核备注修正后重提即可。

**Q：如何避免重复？**  
A：先 `GET /search?q=...` 搜索复用现存实体，再决定新建。

## API

**Q：匿名能调哪些？**  
A：`catalog/*` 读、`search`、`community` 读、`taxonomy` 等。写入与 `storage/*` 需认证。

**Q：为什么写入返回 400？**  
A：未设置有意义的 `User-Agent`（如 `MyApp/1.0 (you@example.com)`），或缺少 `edit_note`/`source_urls`。

**Q：限流多少？**  
A：匿名 60/min，认证 600/min，响应头 `X-RateLimit-*`，429 时请退避。

## 部署

**Q：ES 没起来怎么办？**  
A：搜索会自动降级为 SQL `ILIKE`，不影响浏览。公网部署请置 ES 于内网并开启认证。

**Q：文档站如何访问？**  
A：本地 `http://localhost/docs`（网关代理），开发 `http://localhost:3001/docs/overview`。
