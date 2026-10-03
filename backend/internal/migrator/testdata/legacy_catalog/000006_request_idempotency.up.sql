-- R1：创建请求幂等落目录 PG（替代 http.go 的进程内 sync.Map 24h 缓存）。
--
-- 键含用户/操作/请求键（operation, user_id, request_key），request_hash 存请求摘要
-- （sha256 十六进制，见 catalog/idempotency.go 的 requestHash），response 存首创返回体。
-- 业务写入与幂等声明/结果回填在同一事务（见 claim/setIdempotencyResponseTx）：
-- 同键并发靠主键互斥（后来者阻塞到先行者提交后重放），重启/双副本读同一行，
-- 同键不同载荷返 409 idempotency_conflict。
--
-- 保留策略：行小且是审计依据，暂不清；TODO（三期）：按 operation 分区/保留期清理
-- 已全消费键。当前无消费者堆积问题（键只在显式传 Idempotency-Key 的创建请求产生）。
CREATE TABLE IF NOT EXISTS catalog.idempotency_keys (
  operation text NOT NULL,
  user_id uuid NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, user_id, request_key)
);
