-- 关系去重护栏与结构侧表反向索引。
--
-- relations 去重：应用层 validateRelation 以（端点+类型+属性）判重
-- （relations.go），但 relations.document 内嵌 id/version，直接对整行建唯一
-- 约束会误伤合法更新；对称关系的反向边（A-B 与 B-A 同义）也无法用声明式
-- 索引表达，仍由应用层拦截。这里只拦"完全重复边"：同一端点+同一类型+
-- 同一 attributes。position 不计入（应用层判重同样忽略 position）。
-- attributes 直接比 jsonb 逻辑值（jsonb 有 btree 支持，-> 与 COALESCE 均
-- immutable）：缺键按 'null' 归一，与 validateRelation 里 encode(nil map)=
-- "null" 同口径；空对象 '{}' 与 null 视为不同值，与应用层一致。
-- 若存量已有完全重复边，本迁移会失败：属数据问题，需先手工合并去重再重跑，
-- 不得为通过迁移而删数据（dirty 状态用 mf-migrate force 解除后重试）。

CREATE UNIQUE INDEX IF NOT EXISTS relations_no_exact_dup
 ON catalog.relations(source_id, target_id, type, (COALESCE(document->'attributes', 'null'::jsonb)));

-- 结构侧表反向索引：外键只建约束不建索引，以下查询此前全走全表扫描——
-- List 的 WorkID/ReleaseID/MediumID/ContentUnitID 子查询（store.go listFilter）、
-- Save 的 release 范围收录校验（store.go undeclaredSubjects）、
-- Occurrences 的表达反查（track_contents(expression_id) 已有，不重复建）。
-- 侧表行数与实体同量级，普通 B-tree 即可；表本身很小，无需 CONCURRENTLY
--（若未来单表过大，改由运维手工 CONCURRENTLY 建，迁移幂等不受影响）。

CREATE INDEX IF NOT EXISTS content_units_work ON catalog.content_units(work_id);
CREATE INDEX IF NOT EXISTS expressions_work ON catalog.expressions(work_id);
CREATE INDEX IF NOT EXISTS expressions_content_unit ON catalog.expressions(content_unit_id);
CREATE INDEX IF NOT EXISTS mediums_release ON catalog.mediums(release_id);
CREATE INDEX IF NOT EXISTS tracks_medium ON catalog.tracks(medium_id);
CREATE INDEX IF NOT EXISTS release_subjects_work ON catalog.release_subjects(work_id);
