-- 站内通知（2026-09-20）：事件型收件箱。
--
-- 为什么落在目录库：五类事件里四类的**产生端就在目录服务**（审核结果、收录、导入完成），
-- 只有"评论被回复"来自互动服务；目录又是前端 /api 的主系统与唯一的统一入口，
-- 而 catalog.user_preferences 已经确立了"目录库可以存裸 UUID 的按人数据"的先例。
-- 把收件箱放在账号服务会让**每一类目录事件**都要跨服务写一次（三个产生端两个朝向），
-- 放在目录只留下"互动服务 → 目录"这一条跨服务写（走 internal/upstream，见 notifications.go）。
--
-- 运行期本文件与 backend/migrations/000003_notifications.up.sql 是同一份 DDL：
-- 目录服务启动（Store.Initialize）与 mf-migrate up 都执行它，语句幂等且共用 advisory 锁 740205。
CREATE TABLE IF NOT EXISTS catalog.notifications (
  id uuid PRIMARY KEY,
  -- recipient_id / actor_id 是**裸 UUID**：账号归 auth.users，目录不跨 schema 建外键（与 created_by 同例）。
  recipient_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('comment.replied','entity.included','entity.review_approved','entity.review_rejected','import.completed')),
  actor_id uuid,
  -- actor_name 是写入时的身份快照：账号数据归账号服务，改名历史仍应显示当时是谁（与 catalog.revisions 同例）。
  actor_name text NOT NULL DEFAULT '',
  -- subject_* 是可点开的落点（topic / entity / import），与 payload 分开存是为了让列表页不必解 payload 就能跳转。
  subject_type text NOT NULL DEFAULT '',
  subject_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- dedupe_key 是聚合键：同一收件人同一键只保留一行（count 累加、read_at 归零、updated_at 刷新）。
  -- 它对客户端不可见（不进 DTO）：那是服务端的合并口径，不是展示字段。
  dedupe_key text NOT NULL,
  -- last_event_id 是"上一条被合并进来的事件身份"，让**重试幂等**：跨服务投递走 internal/upstream，
  -- 重试是常态（超时后上游其实已写入）。同一 event_id 再投一次时 count/read_at/updated_at 都不动，
  -- 因此"重试"不会把一条回复变成两条计数。
  last_event_id text NOT NULL DEFAULT '',
  count int NOT NULL DEFAULT 1 CHECK (count > 0),
  -- read_at IS NULL = 未读。未读数是角标的唯一来源，配 WHERE read_at IS NULL 的部分索引。
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 聚合唯一键：同一收件人同一 dedupe_key 只有一行，upsert 在同一条约束上合并。
CREATE UNIQUE INDEX IF NOT EXISTS notifications_aggregate ON catalog.notifications(recipient_id, dedupe_key);
-- 收件箱序：按 updated_at 倒序（合并后的行要浮到最新活动的位置），id 兜底保证稳定分页。
CREATE INDEX IF NOT EXISTS notifications_inbox ON catalog.notifications(recipient_id, updated_at DESC, id DESC);
-- 未读计数：部分索引，只覆盖未读行。
CREATE INDEX IF NOT EXISTS notifications_unread ON catalog.notifications(recipient_id, updated_at DESC) WHERE read_at IS NULL;

-- 保留期建议值 180 天，**本期不实现清理任务**：清理要配套"过期即删"的产品决定与监控
-- （删掉的正是用户唯一的事件事实来源），也依赖 deliveries/outbox 那条 TODO(三期) 的保留期口径。
-- 记录在此供运维排期：scripts/backup.sh 的备份窗口若短于保留期，恢复后就只剩窗口内的通知。
