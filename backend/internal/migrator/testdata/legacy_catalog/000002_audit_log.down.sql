-- 回滚审计表结构。注意 audit schema 与 audit.audit_log 是**四个服务共用**的
-- （auth / community / storage 的迁移建的是同一张表，见 docs/architecture/audit-log.md §1）：
-- 这里只删本迁移建的表，不 DROP SCHEMA——删共享 schema 的语义留给运维显式执行，
-- 不由其中某一个服务的迁移代劳。IF EXISTS 保证重复回滚安全；
-- 重建方式：本迁移 up（或目录服务启动时自动执行，两条路径同一份 DDL）。

DROP TABLE IF EXISTS audit.audit_log;
