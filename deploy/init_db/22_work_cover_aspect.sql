-- 22) 作品封面手动比例：允许为单个作品固定封面显示比例（如 "1:1"/"2:3"/"3:4"），
--     空字符串 = 自动（按标签/图片自然比例推断）。仅影响前端展示，不改变原图。
ALTER TABLE works ADD COLUMN IF NOT EXISTS cover_aspect VARCHAR(8) DEFAULT '' NOT NULL;
