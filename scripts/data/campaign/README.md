# 真实数据补录战役 — 共用工具与规则（scripts/data/campaign/）

本目录是"用真实媒体数据把线上测试实例的实体层级压满"的共用工具层。
目标不是堆数量，而是**让 Work → ContentUnit → Expression 与 Work → Release → Medium → Track → contents 两条链
在尽可能多的媒体类型上被真实数据走通**，并暴露层级 / 关系 / 技能文档的缺口。

| 文件 | 作用 |
| --- | --- |
| `lib.mjs` | 共用库：登录、限流重试、幂等创建（实体/关系）、索引查重、回读、JSONL 日志与汇总 |
| `probe.mjs` | 写入链路探针：在实例上验证"建实体→建关系→回读→幂等→生命周期删除"，**已 16/16 通过** |
| `verify.mjs` | 全库只读完整性校验：结构归属、parent 作用域、subjects 覆盖、关系端点/自环/环、四语翻译 |
| `domains/<slug>.mjs` | 各领域脚本（一个领域一个文件，互不修改） |

## 已验证的线上契约（2026-09-16 探针实测）

- 入口 `https://findverse.cc/api`（**没有 /api/v1 版本前缀**）。
- 创建实体：`POST /api/catalog/entities`
  `{"entity":{...},"expected_version":0,"edit_note":"...","sources":[{"kind":"url","url":"...","citation":"..."}]}`，
  可带 `Idempotency-Key`（重放返回首创结果，实测通过）。
- 更新实体：`PUT /api/catalog/entities/{id}`（**整实体替换**：先 GET 全量再写回，`expected_version` 必填）。
- 创建关系：`POST /api/catalog/relations`，body `{"relation":{"type","source_id","target_id","position","attributes"},"expected_version":0,"edit_note","sources"}`。
  删除关系：`DELETE /api/catalog/relations/{id}`，body 同样是 `{expected_version, edit_note, sources}`。
- 缺证据 → `400 evidence_required`；缺父级 → `400 parent_required`；自环 → `400 invalid_endpoints`。
- 发布态（`status:"published"`）要求至少一条翻译行；多语言封面、属性词表都按 definitions 校验。
- 列表类 GET 按 **IP+路由 120 次/分钟**限流，超限 `429 + Retry-After`（`lib.mjs` 已自动等待重试）；
  写接口没有该限流。

## 用法

```powershell
# 口令只走环境变量（不要把口令写进任何文件）
$env:MF_USER_PASS = (Select-String -Path 'docs-local/sim-credentials.md' -Pattern '^\| admin \|').Line.Split('|')[2].Trim()

node scripts/data/campaign/domains/<slug>.mjs --dry-run   # 先空跑看计划
node scripts/data/campaign/domains/<slug>.mjs             # 真正写入
node scripts/data/campaign/verify.mjs                     # 全库只读校验
```

日志与摘要写在 `docs-local/data-campaign/logs/<slug>.jsonl`（不进仓库）。

## 领域脚本的骨架

```js
import { Campaign, Client, Index, src } from "../lib.mjs";

const SRC = src("https://example.com/page", "页面标题：取了哪些字段");
const ev = { note: "编目：<做了什么、依据是什么>", sources: [SRC] };

const client = new Client();
await client.login();
const camp = new Campaign({ domain: "my-domain", client, index: Index.load() });

const work = await camp.ensureEntity("work", "作品题名", {
  original_language: "ja",
  types: ["animation"],
  translations: { "zh-CN": { title: "…" }, "zh-TW": { title: "…" }, "ja-JP": { title: "…" }, "en-US": { title: "…" } },
  attributes: { tags: ["…"] },
  external_ids: { bangumi: "12345" },
}, ev, { idemKey: "my-domain-work-1" });

const unit = await camp.ensureEntity("content_unit", "第1話 题名", {
  work_id: work.id, position: 1, number: "1",
  original_language: "ja", types: ["content_unit"],
  translations: { "ja-JP": { title: "…" }, "zh-CN": { title: "…" }, "zh-TW": { title: "…" }, "en-US": { title: "…" } },
  attributes: { air_date: "2024-01-05" },
}, ev, { idemKey: "my-domain-cu-1", allowServerLookup: false });

await camp.createRelation("character_in", character.id, work.id, ev, { attributes: { character_rank: "main" } });
camp.summary();
```
