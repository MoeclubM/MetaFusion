-- 19) 作品原始语言：与 works.language（元数据主语言 BCP-47）区分，
--     记录作品内容本身的原始语言（ISO 639-1：zh/ja/en/ko/...）
ALTER TABLE works ADD COLUMN IF NOT EXISTS original_language VARCHAR(16) DEFAULT '' NOT NULL;

-- 历史数据回填：原始语言为空时从元数据主语言推导语言主码（zh-CN -> zh）
UPDATE works
SET original_language = split_part(language, '-', 1)
WHERE original_language = '';

-- 便于按原始语言筛选
CREATE INDEX IF NOT EXISTS idx_works_original_language ON works(original_language);
