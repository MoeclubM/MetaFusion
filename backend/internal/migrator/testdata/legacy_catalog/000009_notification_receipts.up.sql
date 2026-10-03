-- A04：通知事件收据表。聚合行只记 last_event_id（上一条事件），A→B→A 交错里
-- 第二个 A 会被误判成重试而丢计数；并发同事件与响应丢失重投也需要跨语句的稳定身份。
-- 收据以 (recipient_id, event_id) 为唯一键：event_id 由发送方跨重试保持稳定
-- （互动分支保证），同一事件先插收据、再做聚合，两步同事务——重复事件整体不更新
-- 聚合行（计数/未读/展示字段都不动）；不同收件人互不干扰。
--
-- 展示排序仍走 notifications.updated_at，但它即事件时间驱动的最大值
-- （迟到的旧事件只累加计数，不把聚合行顶到顶部，见 notifyTx）：
-- 展示按事件时间，不按抵达顺序。
-- 幂等：IF NOT EXISTS，mf-migrate up 与目录服务安装路径重复执行都安全。
CREATE TABLE IF NOT EXISTS catalog.notification_receipts (
  recipient_id uuid NOT NULL,
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_id, event_id)
);
