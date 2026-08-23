-- 05_forum_boards.sql — forum_boards as first-class entity, FK migration from CHECK
-- Spec: default boards: 站点公告(announcement), 闲聊杂谈(casual), 求助答疑(qa), 考据评注(reviews), 反馈与建议(bug_report), 评论专用(comment); comment board is comment-only and excluded from feeds
CREATE TABLE IF NOT EXISTS forum_boards (
    code VARCHAR(32) PRIMARY KEY,
    name_zh VARCHAR(64) NOT NULL,
    name_en VARCHAR(64) DEFAULT '',
    description TEXT DEFAULT '',
    color VARCHAR(16) DEFAULT 'emerald' NOT NULL CHECK (color IN ('emerald','amber','sky','purple','cyan','rose','indigo','teal')),
    icon VARCHAR(32) DEFAULT 'BookOpen' NOT NULL CHECK (icon IN ('BookOpen','Cpu','Archive','Coffee','Layers','Hash','Tag','Sparkles','Flame','Bookmark','MessageSquare','Globe','Megaphone','Bug','MessageCircle')),
    sort_order INT DEFAULT 0 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    show_in_feed BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Backfill for existing installs that created the table without show_in_feed / new icons
ALTER TABLE forum_boards ADD COLUMN IF NOT EXISTS show_in_feed BOOLEAN DEFAULT TRUE NOT NULL;
DO $$
BEGIN
    ALTER TABLE forum_boards DROP CONSTRAINT IF EXISTS forum_boards_icon_check;
    ALTER TABLE forum_boards ADD CONSTRAINT forum_boards_icon_check CHECK (icon IN ('BookOpen','Cpu','Archive','Coffee','Layers','Hash','Tag','Sparkles','Flame','Bookmark','MessageSquare','Globe','Megaphone','Bug','MessageCircle'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('announcement', '站点公告',   'Announcements',          '站点公告与运营通知',                   'amber',   'Megaphone',     10, TRUE, TRUE,  '{"zh-CN":"站点公告","en-US":"Announcements"}'),
('casual',       '闲聊杂谈',   'Casual Chat',            '轻松闲聊与站内日常交流',               'purple',  'Coffee',        20, TRUE, TRUE,  '{"zh-CN":"闲聊杂谈","en-US":"Casual Chat"}'),
('qa',           '求助答疑',   'Q&A',                    '使用问题、编目与功能答疑',             'teal',    'Hash',          30, TRUE, TRUE,  '{"zh-CN":"求助答疑","en-US":"Q&A"}'),
('reviews',      '考据评注',   'Archive Reviews',        '版本考证、原盘评析与文献释读',         'emerald', 'BookOpen',      40, TRUE, TRUE,  '{"zh-CN":"考据评注","en-US":"Archive Reviews"}'),
('bug_report',   '反馈与建议', 'Feedback & Bug Reports', '缺陷反馈、功能建议与复现信息',         'rose',    'Bug',           50, TRUE, TRUE,  '{"zh-CN":"反馈与建议","en-US":"Feedback & Bug Reports"}'),
('comment',      '评论专用',   'Comments',               '作品与讨论的评论承载区，不进入信息流与全站聚合', 'sky',     'MessageCircle', 60, TRUE, FALSE, '{"zh-CN":"评论专用","en-US":"Comments"}')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_enabled = EXCLUDED.is_enabled,
    show_in_feed = EXCLUDED.show_in_feed,
    names = EXCLUDED.names;

CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    permissions JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_group_members (
    user_group_id UUID REFERENCES user_groups(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    PRIMARY KEY (user_group_id, user_id)
);

-- Clean legacy boards and migrate topics
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='discussion_topics') THEN
        UPDATE discussion_topics SET board_code='announcement' WHERE board_code IS NULL OR board_code='' OR board_code IN ('technology','archival','general');
    END IF;
    DELETE FROM forum_boards WHERE code IN ('technology','archival','general');
END $$;

-- Migrate board_code CHECK → FK (idempotent: drop CHECK if exists, add FK)
DO $$
BEGIN
    BEGIN
        ALTER TABLE discussion_topics DROP CONSTRAINT IF EXISTS discussion_topics_board_code_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_topics_board' AND conrelid = 'discussion_topics'::regclass
    ) THEN
        ALTER TABLE discussion_topics
            ADD CONSTRAINT fk_topics_board FOREIGN KEY (board_code) REFERENCES forum_boards(code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_topics_board_code ON discussion_topics(board_code);
