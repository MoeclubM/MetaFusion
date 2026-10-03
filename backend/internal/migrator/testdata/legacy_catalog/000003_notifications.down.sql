-- 回滚站内通知：只删自己的表，不触碰 entities/relations/revisions/outbox 与审计表。
DROP TABLE IF EXISTS catalog.notifications;
