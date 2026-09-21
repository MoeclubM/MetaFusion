-- R2：身份反向别名查询的表达式索引。redirect_id 列已随 000004 删除，反向遍历走
-- document->>'redirect_id'（见 Store.reverseAliases，逐层 ANY 查询 merged 行）；
-- 本索引让该查询按表达式命中而非全表扫描。部分索引只覆盖 status='merged' 行，
-- 与查询谓词一致；存量数据建索引只读不锁表（表小，无需 CONCURRENTLY，见基线同类索引）。
CREATE INDEX IF NOT EXISTS entities_redirect_lookup ON catalog.entities ((document->>'redirect_id')) WHERE status='merged';
