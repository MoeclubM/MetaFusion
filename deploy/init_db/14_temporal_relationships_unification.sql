-- 14_temporal_relationships_unification.sql — 实体与关系全时序生命周期体系升级 (Temporal Lifecycles & Relationship Unification)
-- 目标:
-- 1) 为 artists, works, canonical_entries 实体提供 begin_date, end_date, ended, recording_date 时序存储；
-- 2) 为 entity_relationships 升级主键 UUID 与 begin_date, end_date, ended, updated_at 字段；
-- 3) 建立时序索引，支撑 "当前有效 / 历史过往" 极速过滤与时序时间线检索。

-- 1. artists 主体生命周期扩展 (出生/设立、逝世/解散、是否已终结)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artists' AND column_name='begin_date') THEN
        ALTER TABLE artists ADD COLUMN begin_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artists' AND column_name='end_date') THEN
        ALTER TABLE artists ADD COLUMN end_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artists' AND column_name='ended') THEN
        ALTER TABLE artists ADD COLUMN ended BOOLEAN DEFAULT FALSE NOT NULL;
    END IF;
END $$;

-- 2. works 作品生命周期扩展 (创作/连载/播映起止、是否已完结)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='works' AND column_name='begin_date') THEN
        ALTER TABLE works ADD COLUMN begin_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='works' AND column_name='end_date') THEN
        ALTER TABLE works ADD COLUMN end_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='works' AND column_name='ended') THEN
        ALTER TABLE works ADD COLUMN ended BOOLEAN DEFAULT FALSE NOT NULL;
    END IF;
END $$;

-- 3. canonical_entries 内容实体录制时序扩展
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='canonical_entries' AND column_name='recording_date') THEN
        ALTER TABLE canonical_entries ADD COLUMN recording_date VARCHAR(16);
    END IF;
END $$;

-- 4. entity_relationships 关系连线时序扩展
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_relationships' AND column_name='begin_date') THEN
        ALTER TABLE entity_relationships ADD COLUMN begin_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_relationships' AND column_name='end_date') THEN
        ALTER TABLE entity_relationships ADD COLUMN end_date VARCHAR(16);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_relationships' AND column_name='ended') THEN
        ALTER TABLE entity_relationships ADD COLUMN ended BOOLEAN DEFAULT FALSE NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='entity_relationships' AND column_name='updated_at') THEN
        ALTER TABLE entity_relationships ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;
    END IF;
END $$;

-- 5. 时序与检索索引
CREATE INDEX IF NOT EXISTS idx_entity_rel_temporal ON entity_relationships(source_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_entity_rel_target_temporal ON entity_relationships(target_id, relationship_type, ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_artists_temporal ON artists(ended, begin_date);
CREATE INDEX IF NOT EXISTS idx_works_temporal ON works(ended, begin_date);
