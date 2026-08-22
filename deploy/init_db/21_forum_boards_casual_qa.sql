-- 21_forum_boards_casual_qa.sql
-- 默认系统分区：闲聊 (casual)、答疑 (qa)
-- 幂等：已存在则跳过，不覆盖管理员改名 / 停用 / 排序
-- 供已部署库补种；新库也会跑本文件（与 01/05 重复插入安全）

INSERT INTO forum_boards (code, name_zh, name_en, description, color, icon, sort_order, is_enabled, show_in_feed, names) VALUES
('casual', '闲聊', 'Casual Chat', '轻松闲聊与站内日常交流', 'purple', 'Coffee', 45, TRUE, TRUE, '{"zh-CN":"闲聊","en-US":"Casual Chat"}'),
('qa',     '答疑', 'Q&A',         '使用问题、编目与功能答疑', 'teal',   'Hash',   55, TRUE, TRUE, '{"zh-CN":"答疑","en-US":"Q&A"}')
ON CONFLICT (code) DO NOTHING;
