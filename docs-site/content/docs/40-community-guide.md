---
title: "社区使用"
description: "板块、发帖、回帖、审核与私信。"
order: 40
group: "community"
---

# 社区使用

社区遵循“读开放、写需登录”，与元数据开放策略一致。

## 板块

```http
GET /api/v1/community/boards
```

默认三板块（见 `forum-boards-three-default`）：

- `announcement`：公告（仅站务可发）
- `general`：综合讨论
- `comment`：评注分区，`show_in_feed=false` 不进入 `board_code=all` 信息流

语种过滤 `?language=zh-CN/en-US` 对游客同样生效（`forum-language-i18n-multilingual`）。

## 帖子

```http
GET  /api/v1/community/topics?board_code=general&page=1&q=keyword
GET  /api/v1/community/topics/:id          # 含 posts 流
POST /api/v1/community/topics               # 需认证
{ "board_code": "general", "title": "标题", "content": "正文（Markdown）", "work_id": "<uuid>", "tag_ids": [] }

POST /api/v1/community/topics/:id/posts    # 回帖，需认证
{ "content": "回复正文", "reply_to_post_number": 2 }
```

文字部分对游客开放可浏览与检索；写入一律需登录。

## 私信

```http
POST /api/v1/messages/with/:user_id  { "content": "hi" }
GET  /api/v1/messages/with/:user_id?page=1
GET  /api/v1/messages/conversations
```

需认证，适合协作考据与站务沟通。

## 审核

- 社区写入受 `community_admin` 审核，垃圾内容与外链滥用会被限流或封禁
- 速率限制对 `L1` 写入接口生效

## 前端入口

- `/community`：板块与信息流
- `/community/:id`：帖子详情
- 个人页的贡献与消息入口

> 发帖前先搜索是否已有相关讨论，引用作品时可带 `work_id` 关联，自动生成卡片。
