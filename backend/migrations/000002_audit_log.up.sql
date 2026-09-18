-- 审计表跨服务共用：四个服务的业务 DDL 各管自己的 schema，这里单独用 audit schema，
-- 因为它不属于任何单个服务的领域数据（见 §5 的取舍说明）。
CREATE SCHEMA IF NOT EXISTS audit;

-- 四个服务可能同时首次启动；建表用同一个 advisory 锁键（740205）串行化。
-- 一次 Exec 里的多条语句由 lib/pq 作为隐式事务批处理发送，xact 锁因此覆盖到建表结束。
SELECT pg_advisory_xact_lock(740205);

CREATE TABLE IF NOT EXISTS audit.audit_log (
  id               uuid PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  service          text NOT NULL,
  action           text NOT NULL,
  actor_user_id    uuid,
  actor_username   text NOT NULL DEFAULT '',
  credential_type  text NOT NULL DEFAULT '',
  actor_ip         text NOT NULL DEFAULT '',
  actor_user_agent text NOT NULL DEFAULT '',
  target_type      text NOT NULL DEFAULT '',
  target_id        text NOT NULL DEFAULT '',
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  result           text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  error_code       text NOT NULL DEFAULT '',
  request_method   text NOT NULL DEFAULT '',
  route            text NOT NULL DEFAULT '',
  http_status      int NOT NULL DEFAULT 0,
  request_id       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit.audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_service_action_idx ON audit.audit_log(service, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit.audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit.audit_log(target_type, target_id, occurred_at DESC);
