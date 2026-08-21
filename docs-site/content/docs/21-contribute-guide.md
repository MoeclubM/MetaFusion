---
title: "投稿与审核"
description: "从投稿到审核通过的完整流程与规范。"
order: 21
group: "guide"
---

# 投稿与审核

## 路径

- 统一入口：`/contribute`（`/upload` 与 `/submit` 已 301 至此）
- 管理审核：`/admin` → 编目审核、社区审核、用户管理

## 审核状态

| 状态 | 含义 |
|---|---|
| pending | 待审核，仅作者与站务可见 |
| approved | 已通过，全站可见 |
| rejected | 已驳回，需按反馈修改后重提 |

`ListWorks` / `ListReleases` 仅返回已审核通过的版本，未通过的通过 `applyReleaseVisibility` 过滤。

## 投稿清单

- [ ] 标题、媒介类型、分类/标签准确
- [ ] 封面为合法直链或已上传资源（经 `validateCoverURL`）
- [ ] 关联创作者已正确选择角色（在白名单内）
- [ ] `edit_note` 说明本次投稿的依据与改动点
- [ ] `source_urls` 提供至少一个可验证来源（官网、VGMdb、MusicBrainz、出版信息页等）
- [ ] 若含媒体文件，见 [上传与转码](/docs/upload-transcode)

## 被驳回怎么办

1. 查看站务留言（审核备注）
2. 按指引修正后重新提交，修订历史会保留
3. 有争议可在社区对应板块发帖讨论，@站务

## 贡献可见性

- `GET /users/:id/contributions` 可查看公开贡献历史
- 个人主页 `/users/:id` 展示统计

## 邀请与贡献

贡献质量与邀请码无直接挂钩。邀请是风控手段，审核是质量手段，二者分离。
