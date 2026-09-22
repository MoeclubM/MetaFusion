-- A04 回滚：删除通知事件收据表（聚合行与 last_event_id 不动）。
DROP TABLE IF EXISTS catalog.notification_receipts;
