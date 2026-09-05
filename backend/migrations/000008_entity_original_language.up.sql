-- 实体原始语言（ISO 639-1）：主体/系列与作品一致支持设置内容主语言，
-- 原语言标题归属对应语种翻译行，展示跟随用户显示语言优先级。
ALTER TABLE artists ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) NOT NULL DEFAULT '';
