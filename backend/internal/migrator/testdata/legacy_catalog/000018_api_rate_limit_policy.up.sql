-- API rate limiting is operator configuration, not catalog metadata. It gets
-- its own singleton row instead of living in the published definition document,
-- which is served anonymously: per-account quotas and account ids must not be
-- downloadable by every client, and a quota change must not invalidate the
-- metadata contract or require an impact replay over 100k entities.
--
-- The runtime never mutates this row outside the admin endpoint. It reads it
-- once at startup and refuses to boot when the row cannot be read: a silent
-- fallback to the built-in budgets is indistinguishable from "the policy is not
-- taking effect", and that is exactly the symptom an operator would then have to
-- diagnose from source. An empty document means "inherit every built-in budget".
CREATE TABLE IF NOT EXISTS catalog.rate_limit_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  document jsonb NOT NULL,
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the empty policy so GET /api/admin/rate-limits always has a row to read
-- and the etag guard has a baseline. '{}' means inherit every built-in budget.
INSERT INTO catalog.rate_limit_policy(singleton, document, etag, updated_at)
VALUES (true, '{}'::jsonb, gen_random_uuid()::text, now())
ON CONFLICT (singleton) DO NOTHING;
