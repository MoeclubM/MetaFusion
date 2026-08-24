-- 000002_seed_initial_data.down.sql
DELETE FROM system_settings WHERE key IN ('registration_enabled', 'invite_required', 'storage_quota_mb');
DELETE FROM forum_boards WHERE is_system = true;
DELETE FROM external_database_definitions WHERE is_system = true;
DELETE FROM relation_types WHERE is_system = true;
DELETE FROM entity_type_definitions WHERE is_system = true;
