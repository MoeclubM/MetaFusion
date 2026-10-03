-- OpenSearch 只消费 entity.* 事件；按创建顺序和事件 ID 稳定拉取未投递批次。
-- 该索引直接支撑目录候选索引的有界增量消费，不改变事件语义。
CREATE INDEX IF NOT EXISTS outbox_entity_created_id ON catalog.outbox(created_at,id) WHERE type LIKE 'entity.%';
