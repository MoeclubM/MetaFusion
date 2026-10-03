-- API 调用日志（开发者中心「API 请求日志」）：只记已登录请求，匿名不记。
--
-- 归因口径与审计 DirectoryActor 同源：pat（PAT 内省，credential_name 为令牌名）、
-- session（其余已登录请求，名为空）。route 存 gin 模板路径（/api/catalog/entities/:id），
-- 不存原始 URL——路径里的实体 id 与查询串不进日志。
-- 保留 30 天：写入时 1% 概率顺手清过期行（无外部 cron，自维护）。
CREATE TABLE IF NOT EXISTS catalog.api_request_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL,
 credential_type text NOT NULL,
 credential_name text NOT NULL DEFAULT '',
 method text NOT NULL,
 route text NOT NULL,
 status int NOT NULL DEFAULT 0,
 ms int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS api_request_logs_user_at ON catalog.api_request_logs(user_id, at DESC);
