-- The document holds administrator-authored group presets and per-account
-- overrides. Dropping the table restores the built-in budgets silently, so the
-- rollback is refused rather than performed (same rule as 000016/000017).
DO $$ BEGIN RAISE EXCEPTION '000018_api_rate_limit_policy is irreversible'; END $$;
