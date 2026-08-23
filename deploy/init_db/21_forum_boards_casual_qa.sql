-- 21_forum_boards_casual_qa.sql
-- 默认系统分区：闲聊杂谈 (casual)、求助答疑 (qa)
-- 幂等：已存在则更新基础信息，确保处于正常启用状态

INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('casual', '闲聊杂谈', 'Casual Chat', '轻松闲聊与站内日常交流', 'purple', 'Coffee', 20, TRUE, TRUE, '{"zh-CN":"闲聊杂谈","en-US":"Casual Chat"}'),
('qa',     '求助答疑', 'Q&A',         '使用问题、编目与功能答疑', 'teal',   'Hash',   30, TRUE, TRUE, '{"zh-CN":"求助答疑","en-US":"Q&A"}')
ON CONFLICT (code) DO UPDATE SET
    name_zh = EXCLUDED.name_zh,
    name_en = EXCLUDED.name_en,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    is_enabled = TRUE,
    show_in_feed = TRUE,
    names = EXCLUDED.names;
