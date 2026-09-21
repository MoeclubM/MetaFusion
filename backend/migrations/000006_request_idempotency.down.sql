-- 回滚 000006：幂等键只是去重护栏，删表即退回"无幂等"（调用方重试可能双建）；重建方式为 `mf-migrate up`（空表）。
DROP TABLE IF EXISTS catalog.idempotency_keys;
