-- Definitions are one live configuration document. Keep the current published
-- document and retire draft/superseded rows and their version linkage.
CREATE TABLE IF NOT EXISTS catalog.definition_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  document jsonb NOT NULL,
  etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('catalog.definitions') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM catalog.definitions)
       AND NOT EXISTS (SELECT 1 FROM catalog.definitions WHERE state='published') THEN
      RAISE EXCEPTION 'definition_config migration requires a published document';
    END IF;
    INSERT INTO catalog.definition_config(singleton, document, etag, updated_at)
    SELECT true, document, md5(document::text || clock_timestamp()::text), now()
    FROM catalog.definitions WHERE state = 'published'
    ON CONFLICT (singleton) DO NOTHING;
    DROP TABLE catalog.definitions;
  END IF;
END $$;
ALTER TABLE catalog.revisions DROP COLUMN IF EXISTS definition_version;

-- Retire the old full-document audit payloads as well: retaining them would
-- leave a second, implicit definition-version store after dropping the table.
DELETE FROM catalog.deliveries WHERE event_id IN (
  SELECT id FROM catalog.outbox WHERE type IN ('definitions.drafted','definitions.published')
);
DELETE FROM catalog.outbox WHERE type IN ('definitions.drafted','definitions.published');
DELETE FROM catalog.revisions WHERE target_id LIKE 'definitions:%';
