-- 导入幂等键唯一护栏：external_ids.metafusion_import 并发可双插。
--
-- 背景：导入幂等（importer.go findImported）是"先查后建"，并发双写会同时查空、
-- 各建一份重复实体。幂等键存在 document->'external_ids'->>'metafusion_import'，
-- 对有键行建唯一索引即可在提交时拦截后到者（后到者拿到 23505，
-- http.go 已把 23505 转为 constraint_violation，前端可据此重试走复用分支）。
--
-- 只约束"有键行"（WHERE 谓词排除 NULL/空串）：手工载荷无键（importDedupKey 不可
-- 解析）本就不做幂等，不得互相阻塞；空键行保持可重复。
-- 若存量已有重复键，本迁移会失败：属数据问题，需先手工合并去重再重跑，
-- 不得为通过迁移而删数据（dirty 状态用 mf-migrate force 解除后重试）。
-- 与 000012 的 relations_no_exact_dup 同策略：应用层判重为主，
-- 唯一索引为并发与旁路写入的最后一道拦网。

CREATE UNIQUE INDEX IF NOT EXISTS entities_metafusion_import_key
  ON catalog.entities ((document->'external_ids'->>'metafusion_import'))
  WHERE (document->'external_ids'->>'metafusion_import') IS NOT NULL
    AND (document->'external_ids'->>'metafusion_import') <> '';
