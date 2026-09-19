-- 回滚 000005：调用日志是纯派生数据，重建方式为 `mf-migrate up`（空表）。
DROP TABLE IF EXISTS catalog.api_request_logs;
