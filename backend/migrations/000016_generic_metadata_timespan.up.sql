-- One-way contract cutover. Run mf-migrate up with catalog writers stopped and
-- deploy the matching backend/frontend together. The migrator wraps this file
-- in one transaction; every preflight error rolls back without partial edits.
-- `type` on a relation, field value type, and the eight structural `kind`s are
-- not business entity types and are intentionally left intact.

CREATE TEMP TABLE mf_000016_issues (
  scope text NOT NULL, record_id text NOT NULL, path text NOT NULL, reason text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE mf_000016_allowed (
  field_code text NOT NULL, kind text NOT NULL, PRIMARY KEY (field_code, kind)
) ON COMMIT DROP;
-- Frozen from Defaults().relSlot at this cutover. Custom codes are not guessed.
CREATE TEMP TABLE mf_000016_relation_slot (
  code text PRIMARY KEY, slot text NOT NULL
) ON COMMIT DROP;
INSERT INTO mf_000016_relation_slot(code, slot) VALUES
  ('created_by','person'), ('performed_by','person'), ('photographed_by','person'),
  ('modeled_by','person'), ('developed_by','person'), ('voiced_by','person'),
  ('composed_by','person'), ('lyricist_of','person'), ('arranged_by','person'),
  ('directed_by','person'), ('written_by','person'), ('illustrated_by','person'),
  ('narrated_by','person'), ('translated_by','person'), ('credit_for','person'),
  ('store_bonus_for','person'), ('character_in','character'),
  ('adaptation_of','peer'), ('sequel_of','peer'), ('spin_off_of','peer'),
  ('soundtrack_of','peer'), ('translation_of','peer'), ('revision_of','peer'),
  ('cover_of','peer'), ('alternate_take_of','peer'), ('pressing_of','peer'),
  ('includes','peer'), ('bonus_included_in','peer'), ('member_of','peer');

DO $preflight_definitions$
DECLARE
  d jsonb;
  t record;
  item jsonb;
  f record;
  code text;
BEGIN
  SELECT document INTO d FROM catalog.definition_config WHERE singleton = true;
  IF d IS NULL THEN
    IF EXISTS (SELECT 1 FROM catalog.entities) THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document', 'missing published definitions for existing entities');
    END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(d) <> 'object' OR jsonb_typeof(d->'fields') <> 'object' THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.fields', 'expected object');
    RETURN;
  END IF;
  IF d ? 'types' AND jsonb_typeof(d->'types') <> 'object' THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.types', 'expected object');
    RETURN;
  END IF;
  IF d ? 'relations' AND jsonb_typeof(d->'relations') <> 'object' THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.relations', 'expected object');
  END IF;
  IF d ? 'schemes' AND jsonb_typeof(d->'schemes') <> 'object' THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.schemes', 'expected object');
  END IF;
  IF jsonb_typeof(d->'structure') <> 'object' OR d->'structure' IS NULL THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.structure', 'missing structural rules; publish them before cutover');
  END IF;
  IF d ? 'credit_declared' AND jsonb_typeof(d->'credit_declared') NOT IN ('boolean','null') THEN
    INSERT INTO mf_000016_issues VALUES ('definition_config', 'singleton', 'document.credit_declared', 'expected boolean');
  END IF;
  FOR f IN SELECT * FROM jsonb_each(d->'fields') LOOP
    IF jsonb_typeof(f.value) <> 'object' THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', f.key, 'fields.' || f.key, 'expected object');
    ELSIF f.value ? 'applicable_kinds' AND
      (jsonb_typeof(f.value->'applicable_kinds') <> 'array' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.value->'applicable_kinds') = 'array' THEN f.value->'applicable_kinds' ELSE '[]'::jsonb END) x(value)
        WHERE jsonb_typeof(x.value) <> 'string' OR x.value #>> '{}' NOT IN
          ('agent','collection','work','content_unit','expression','release','medium','track'))) THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', f.key, 'fields.' || f.key || '.applicable_kinds', 'invalid kind array');
    END IF;
  END LOOP;
  FOR t IN SELECT * FROM jsonb_each(COALESCE(d->'types', '{}'::jsonb)) LOOP
    IF jsonb_typeof(t.value) <> 'object'
       OR jsonb_typeof(t.value->'kinds') <> 'array'
       OR jsonb_typeof(t.value->'fields') <> 'array' THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'types.' || t.key, 'expected object with kinds[] and fields[]');
      CONTINUE;
    END IF;
    IF jsonb_array_length(t.value->'fields') > 0 AND jsonb_array_length(t.value->'kinds') = 0 THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'types.' || t.key || '.kinds', 'field-bearing type has no owner kind');
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(t.value->'kinds') LOOP
      IF jsonb_typeof(item) <> 'string' OR trim(item #>> '{}') NOT IN
         ('agent','collection','work','content_unit','expression','release','medium','track') THEN
        INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'types.' || t.key || '.kinds', 'invalid kind: ' || item::text);
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(t.value->'fields') LOOP
      IF jsonb_typeof(item) <> 'string' THEN
        INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'types.' || t.key || '.fields', 'non-string field: ' || item::text);
      ELSE
        code := item #>> '{}';
        IF NOT (d->'fields' ? code) THEN
          INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'types.' || t.key || '.fields', 'undefined field: ' || code);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  FOR t IN SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(d->'relations') = 'object' THEN d->'relations' ELSE '{}'::jsonb END) LOOP
    IF jsonb_typeof(t.value) <> 'object' THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key, 'expected object');
      CONTINUE;
    END IF;
    IF t.value ? 'participant_slot' AND jsonb_typeof(t.value->'participant_slot') NOT IN ('string','null') THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key || '.participant_slot', 'expected person/character/peer');
    ELSIF COALESCE(t.value->>'participant_slot','') = '' THEN
      IF NOT EXISTS (SELECT 1 FROM mf_000016_relation_slot m WHERE m.code = t.key) THEN
        INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key || '.participant_slot', 'empty slot on custom code; explicit decision required');
      END IF;
    ELSIF t.value->>'participant_slot' NOT IN ('person','character','peer') THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key || '.participant_slot', 'invalid slot');
    END IF;
    IF t.value ? 'counts_as_credit' AND jsonb_typeof(t.value->'counts_as_credit') NOT IN ('boolean','null') THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key || '.counts_as_credit', 'expected boolean');
    END IF;
    IF t.value ? 'group' AND jsonb_typeof(t.value->'group') NOT IN ('string','null') THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'relations.' || t.key || '.group', 'expected string');
    END IF;
  END LOOP;
  FOR t IN SELECT * FROM jsonb_each(CASE WHEN jsonb_typeof(d->'schemes') = 'object' THEN d->'schemes' ELSE '{}'::jsonb END) LOOP
    IF jsonb_typeof(t.value) <> 'object' THEN
      INSERT INTO mf_000016_issues VALUES ('definition_config', t.key, 'schemes.' || t.key, 'expected object');
    END IF;
  END LOOP;
END
$preflight_definitions$;

-- Include disabled types: their field grants still explain historical data.
INSERT INTO mf_000016_allowed(field_code, kind)
SELECT DISTINCT field_value #>> '{}', kind_value #>> '{}'
FROM catalog.definition_config c
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.document->'types') = 'object' THEN c.document->'types' ELSE '{}'::jsonb END) AS t(code, body)
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.body->'fields') = 'array' THEN t.body->'fields' ELSE '[]'::jsonb END) AS field_entry(field_value)
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.body->'kinds') = 'array' THEN t.body->'kinds' ELSE '[]'::jsonb END) AS kind_entry(kind_value)
WHERE c.singleton = true
  AND jsonb_typeof(field_value) = 'string'
  AND jsonb_typeof(kind_value) = 'string'
  AND kind_value #>> '{}' IN ('agent','collection','work','content_unit','expression','release','medium','track')
  AND c.document->'fields' ? (field_value #>> '{}');

-- A manually repeated SQL run (or a fresh install seeded after migration)
-- already has no legacy type map. Read its new grants without inventing types.
INSERT INTO mf_000016_allowed(field_code, kind)
SELECT DISTINCT f.key, k.value #>> '{}'
FROM catalog.definition_config c
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.document->'fields') = 'object' THEN c.document->'fields' ELSE '{}'::jsonb END) f
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.value->'applicable_kinds') = 'array' THEN f.value->'applicable_kinds' ELSE '[]'::jsonb END) k(value)
WHERE c.singleton = true AND NOT (c.document ? 'types')
  AND jsonb_typeof(k.value) = 'string'
  AND k.value #>> '{}' IN ('agent','collection','work','content_unit','expression','release','medium','track')
ON CONFLICT DO NOTHING;

-- Free tags were writable on every kind independently of the old type map.
-- Keep that capability without interpreting tag values as classifications.
INSERT INTO mf_000016_allowed(field_code, kind)
SELECT 'tags', kind
FROM catalog.definition_config c
CROSS JOIN (VALUES ('agent'), ('collection'), ('work'), ('content_unit'),
                   ('expression'), ('release'), ('medium'), ('track')) AS kinds(kind)
WHERE c.singleton = true AND c.document->'fields' ? 'tags'
ON CONFLICT DO NOTHING;

INSERT INTO mf_000016_issues(scope, record_id, path, reason)
SELECT 'definition_config', f.key, 'fields.' || f.key || '.applicable_kinds', 'existing value conflicts with derived kind union'
FROM catalog.definition_config c
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.document->'fields') = 'object' THEN c.document->'fields' ELSE '{}'::jsonb END) f
WHERE c.singleton = true AND c.document ? 'types'
  AND jsonb_typeof(f.value) = 'object' AND f.value ? 'applicable_kinds'
  AND f.value->'applicable_kinds' IS DISTINCT FROM
    COALESCE((SELECT jsonb_agg(a.kind ORDER BY a.kind) FROM mf_000016_allowed a WHERE a.field_code = f.key), '[]'::jsonb);

CREATE FUNCTION pg_temp.mf_000016_check_entity(doc jsonb, scope_name text, row_id text)
RETURNS void LANGUAGE plpgsql AS $check_entity$
DECLARE
  pic record;
  part text;
  old_period jsonb;
  begin_value text;
  end_value text;
  attr record;
  tag_entry record;
  attrs jsonb;
BEGIN
  IF jsonb_typeof(doc) <> 'object' THEN
    INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'document', 'expected entity object');
    RETURN;
  END IF;
  IF doc->>'kind' NOT IN ('agent','collection','work','content_unit','expression','release','medium','track')
     OR doc->>'kind' IS NULL THEN
    INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'kind', 'missing or invalid entity kind');
  END IF;
  IF doc ? 'types' AND jsonb_typeof(doc->'types') NOT IN ('array','null') THEN
    INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'types', 'expected array before removal');
  END IF;
  attrs := doc->'attributes';
  -- Six historical probe rows carry [null, {"tags": [...]}]. The leading
  -- null has no information; normalize this exact shape once, not at runtime.
  IF jsonb_typeof(attrs) = 'array' THEN
    IF jsonb_array_length(attrs) = 2 AND jsonb_typeof(attrs->0) = 'null'
       AND jsonb_typeof(attrs->1) = 'object' THEN
      attrs := attrs->1;
    ELSE
      INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'attributes', 'expected object or losslessly convertible [null, object]');
    END IF;
  ELSIF doc ? 'attributes' AND jsonb_typeof(attrs) NOT IN ('object','null') THEN
    INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'attributes', 'expected object or losslessly convertible [null, object]');
  END IF;
  IF jsonb_typeof(attrs) = 'object' THEN
    FOR attr IN SELECT * FROM jsonb_each(attrs) LOOP
      IF NOT EXISTS (SELECT 1 FROM mf_000016_allowed a WHERE a.field_code = attr.key AND a.kind = doc->>'kind') THEN
        INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'attributes.' || attr.key, 'field has no applicable_kinds grant for entity kind');
      END IF;
      IF attr.key = 'tags' AND jsonb_typeof(attr.value) NOT IN ('array','null') THEN
        INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'attributes.tags', 'expected tag array');
      ELSIF attr.key = 'tags' AND jsonb_typeof(attr.value) = 'array' THEN
        FOR tag_entry IN SELECT value, ord FROM jsonb_array_elements(attr.value) WITH ORDINALITY AS v(value, ord) LOOP
          IF jsonb_typeof(tag_entry.value) = 'string' THEN
            CONTINUE;
          END IF;
          IF jsonb_typeof(tag_entry.value) = 'object'
             AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(tag_entry.value) = 'object' THEN tag_entry.value ELSE '{}'::jsonb END)) = 1
             AND jsonb_typeof(tag_entry.value->'name') = 'string' THEN
            CONTINUE;
          END IF;
          INSERT INTO mf_000016_issues VALUES (scope_name, row_id,
            'attributes.tags[' || (tag_entry.ord - 1)::text || ']', 'tag cannot be converted to string without losing information');
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  IF NOT doc ? 'pictures' OR jsonb_typeof(doc->'pictures') = 'null' THEN
    RETURN;
  END IF;
  IF jsonb_typeof(doc->'pictures') <> 'array' THEN
    INSERT INTO mf_000016_issues VALUES (scope_name, row_id, 'pictures', 'non-array pictures cannot be converted without losing images');
    RETURN;
  END IF;
  FOR pic IN SELECT value, ord FROM jsonb_array_elements(doc->'pictures') WITH ORDINALITY AS p(value, ord) LOOP
    part := 'pictures[' || (pic.ord - 1)::text || ']';
    IF jsonb_typeof(pic.value) <> 'object' THEN
      INSERT INTO mf_000016_issues VALUES (scope_name, row_id, part, 'expected picture object');
      CONTINUE;
    END IF;
    IF (pic.value ? 'in_use_from' AND jsonb_typeof(pic.value->'in_use_from') NOT IN ('string','null'))
       OR (pic.value ? 'in_use_until' AND jsonb_typeof(pic.value->'in_use_until') NOT IN ('string','null')) THEN
      INSERT INTO mf_000016_issues VALUES (scope_name, row_id, part, 'old usage endpoints must be strings or null');
      CONTINUE;
    END IF;
    IF (pic.value->>'in_use_from' IS NOT NULL AND pic.value->>'in_use_from' <> trim(pic.value->>'in_use_from'))
       OR (pic.value->>'in_use_until' IS NOT NULL AND pic.value->>'in_use_until' <> trim(pic.value->>'in_use_until')) THEN
      INSERT INTO mf_000016_issues VALUES (scope_name, row_id, part, 'old usage endpoint contains noncanonical whitespace');
      CONTINUE;
    END IF;
    old_period := pic.value->'usage_period';
    IF old_period IS NOT NULL AND jsonb_typeof(old_period) <> 'null' THEN
      IF jsonb_typeof(old_period) <> 'object' OR old_period = '{}'::jsonb
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(old_period) = 'object' THEN old_period ELSE '{}'::jsonb END) AS k(key) WHERE k.key NOT IN ('begin','end'))
         OR (old_period ? 'begin' AND jsonb_typeof(old_period->'begin') NOT IN ('string','null'))
         OR (old_period ? 'end' AND jsonb_typeof(old_period->'end') NOT IN ('string','null'))
         OR (jsonb_typeof(old_period) = 'object' AND NULLIF(trim(old_period->>'begin'),'') IS NULL AND NULLIF(trim(old_period->>'end'),'') IS NULL) THEN
        INSERT INTO mf_000016_issues VALUES (scope_name, row_id, part || '.usage_period', 'invalid existing time span');
        CONTINUE;
      END IF;
    END IF;
    begin_value := NULLIF(trim(pic.value->>'in_use_from'), '');
    end_value := NULLIF(trim(pic.value->>'in_use_until'), '');
    IF (begin_value IS NOT NULL OR end_value IS NOT NULL)
       AND old_period IS NOT NULL AND jsonb_typeof(old_period) = 'object'
       AND old_period IS DISTINCT FROM jsonb_strip_nulls(jsonb_build_object('begin', begin_value, 'end', end_value)) THEN
      INSERT INTO mf_000016_issues VALUES (scope_name, row_id, part || '.usage_period', 'existing span conflicts with in_use_from/until');
    END IF;
  END LOOP;
END
$check_entity$;

SELECT pg_temp.mf_000016_check_entity(document, 'entities', id::text) FROM catalog.entities;
SELECT pg_temp.mf_000016_check_entity(r.snapshot, 'revisions', r.id::text)
FROM catalog.revisions r
WHERE r.snapshot ? 'kind'
   OR (r.target_id <> 'definitions' AND r.snapshot ?| ARRAY['types','pictures'])
   OR EXISTS (SELECT 1 FROM catalog.entities e WHERE e.id::text = r.target_id);
SELECT pg_temp.mf_000016_check_entity(payload, 'outbox', id::text)
FROM catalog.outbox WHERE type LIKE 'entity.%';
SELECT pg_temp.mf_000016_check_entity(response, 'idempotency_keys', user_id::text || '/' || request_key)
FROM catalog.idempotency_keys WHERE operation = 'entity.create';

INSERT INTO mf_000016_issues(scope, record_id, path, reason)
SELECT 'user_preferences', user_id::text, 'home_shelves', 'expected object with order/hidden/sections arrays'
FROM catalog.user_preferences
WHERE jsonb_typeof(home_shelves) <> 'object'
   OR (home_shelves ? 'order' AND jsonb_typeof(home_shelves->'order') NOT IN ('array','null'))
   OR (home_shelves ? 'hidden' AND jsonb_typeof(home_shelves->'hidden') NOT IN ('array','null'))
   OR (home_shelves ? 'sections' AND jsonb_typeof(home_shelves->'sections') NOT IN ('array','null'));

DO $abort_if_ambiguous$
DECLARE details text;
BEGIN
  SELECT string_agg(scope || ':' || record_id || ' ' || path || ' (' || reason || ')', E'\n' ORDER BY scope, record_id, path)
    INTO details FROM mf_000016_issues;
  IF details IS NOT NULL THEN
    RAISE EXCEPTION '000016 preflight failed; resolve these records and rerun:%', E'\n' || details;
  END IF;
END
$abort_if_ambiguous$;

CREATE FUNCTION pg_temp.mf_000016_convert_entity(doc jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $convert_entity$
DECLARE result jsonb;
BEGIN
  result := doc - 'types';
  IF jsonb_typeof(result->'attributes') = 'array' THEN
    IF jsonb_array_length(result->'attributes') = 2
       AND jsonb_typeof(result->'attributes'->0) = 'null'
       AND jsonb_typeof(result->'attributes'->1) = 'object' THEN
      result := jsonb_set(result, '{attributes}', result->'attributes'->1);
    END IF;
  END IF;
  IF jsonb_typeof(result->'attributes'->'tags') = 'array' THEN
    result := jsonb_set(result, '{attributes,tags}', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(tag.value) = 'object' THEN to_jsonb(tag.value->>'name')
             ELSE tag.value END ORDER BY tag.ord)
      FROM jsonb_array_elements(result->'attributes'->'tags') WITH ORDINALITY AS tag(value, ord)
    ), '[]'::jsonb));
  END IF;
  IF jsonb_typeof(result->'pictures') = 'array' THEN
    result := jsonb_set(result, '{pictures}',
      COALESCE((SELECT jsonb_agg(
        (p.value - 'in_use_from' - 'in_use_until') ||
        CASE WHEN NULLIF(trim(p.value->>'in_use_from'),'') IS NOT NULL OR NULLIF(trim(p.value->>'in_use_until'),'') IS NOT NULL
          THEN jsonb_build_object('usage_period', jsonb_strip_nulls(jsonb_build_object(
            'begin', NULLIF(trim(p.value->>'in_use_from'),''), 'end', NULLIF(trim(p.value->>'in_use_until'),''))))
          ELSE '{}'::jsonb END ORDER BY p.ord)
        FROM jsonb_array_elements(result->'pictures') WITH ORDINALITY AS p(value, ord)), '[]'::jsonb), true);
  END IF;
  RETURN result;
END
$convert_entity$;

UPDATE catalog.entities SET document = pg_temp.mf_000016_convert_entity(document);
UPDATE catalog.revisions r SET snapshot = pg_temp.mf_000016_convert_entity(snapshot)
WHERE r.snapshot ? 'kind'
   OR (r.target_id <> 'definitions' AND r.snapshot ?| ARRAY['types','pictures'])
   OR EXISTS (SELECT 1 FROM catalog.entities e WHERE e.id::text = r.target_id);
UPDATE catalog.outbox SET payload = pg_temp.mf_000016_convert_entity(payload) WHERE type LIKE 'entity.%';
UPDATE catalog.idempotency_keys SET response = pg_temp.mf_000016_convert_entity(response) WHERE operation = 'entity.create';

-- Persist canonical preference arrays while preserving every other key.
UPDATE catalog.user_preferences
SET home_shelves = jsonb_set(jsonb_set(jsonb_set(home_shelves,
  '{order}', CASE WHEN jsonb_typeof(home_shelves->'order') = 'array' THEN home_shelves->'order' ELSE '[]'::jsonb END, true),
  '{hidden}', CASE WHEN jsonb_typeof(home_shelves->'hidden') = 'array' THEN home_shelves->'hidden' ELSE '[]'::jsonb END, true),
  '{sections}', CASE WHEN jsonb_typeof(home_shelves->'sections') = 'array' THEN home_shelves->'sections' ELSE '[]'::jsonb END, true)
WHERE NOT home_shelves ? 'order' OR jsonb_typeof(home_shelves->'order') = 'null'
   OR NOT home_shelves ? 'hidden' OR jsonb_typeof(home_shelves->'hidden') = 'null'
   OR NOT home_shelves ? 'sections' OR jsonb_typeof(home_shelves->'sections') = 'null';

-- Relations retain their `type` code (relation identity), while the now
-- meaningless endpoint business-type filters are removed from definitions.
UPDATE catalog.definition_config c
SET document = (c.document - 'types' - 'credit_declared') || jsonb_build_object(
  'fields', COALESCE((
    SELECT jsonb_object_agg(f.key,
      CASE WHEN EXISTS (SELECT 1 FROM mf_000016_allowed a WHERE a.field_code = f.key)
        THEN f.value || jsonb_build_object('applicable_kinds',
          (SELECT jsonb_agg(a.kind ORDER BY a.kind) FROM mf_000016_allowed a WHERE a.field_code = f.key))
        ELSE f.value - 'applicable_kinds' END)
    FROM jsonb_each(c.document->'fields') f), '{}'::jsonb),
  'relations', COALESCE((
    SELECT jsonb_object_agg(r.key,
      (r.value - 'source_types' - 'target_types') ||
      CASE WHEN COALESCE(r.value->>'participant_slot','') = ''
        THEN jsonb_build_object('participant_slot', (SELECT m.slot FROM mf_000016_relation_slot m WHERE m.code = r.key))
        ELSE '{}'::jsonb END ||
      CASE WHEN COALESCE(c.document->>'credit_declared','false') = 'false' AND r.value->>'group' = 'credits'
        THEN jsonb_build_object('counts_as_credit', true) ELSE '{}'::jsonb END)
    FROM jsonb_each(CASE WHEN jsonb_typeof(c.document->'relations') = 'object' THEN c.document->'relations' ELSE '{}'::jsonb END) r), '{}'::jsonb),
  'schemes', COALESCE((
    SELECT jsonb_object_agg(s.key, s.value - 'types')
    FROM jsonb_each(CASE WHEN jsonb_typeof(c.document->'schemes') = 'object' THEN c.document->'schemes' ELSE '{}'::jsonb END) s), '{}'::jsonb),
  'structure', c.document->'structure'
), etag = gen_random_uuid()::text, updated_at = now()
WHERE c.singleton = true AND (
  c.document ? 'types'
  OR c.document ? 'credit_declared'
  OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(c.document->'relations') = 'object' THEN c.document->'relations' ELSE '{}'::jsonb END) r WHERE COALESCE(r.value->>'participant_slot','') = '')
  OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(c.document->'relations') = 'object' THEN c.document->'relations' ELSE '{}'::jsonb END) r WHERE r.value ?| ARRAY['source_types','target_types'])
  OR EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(c.document->'schemes') = 'object' THEN c.document->'schemes' ELSE '{}'::jsonb END) s WHERE s.value ? 'types')
);

DROP INDEX IF EXISTS catalog.entities_types;

-- No legacy JSON contract remains in the live entity, historical entity
-- snapshots, replayable responses, or entity outbox payloads. Audit summaries
-- in audit.audit_log retain factual historical counts; they are not DTOs.
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM catalog.entities WHERE document ? 'types')
     OR EXISTS (SELECT 1 FROM catalog.revisions WHERE target_id <> 'definitions' AND snapshot ? 'types')
     OR EXISTS (SELECT 1 FROM catalog.outbox WHERE type LIKE 'entity.%' AND payload ? 'types')
     OR EXISTS (SELECT 1 FROM catalog.idempotency_keys WHERE operation = 'entity.create' AND response ? 'types')
     OR EXISTS (SELECT 1 FROM catalog.definition_config WHERE document ? 'types') THEN
    RAISE EXCEPTION '000016 verification failed: business types remain';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.definition_config WHERE document ? 'credit_declared')
     OR EXISTS (SELECT 1 FROM catalog.definition_config c
       CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.document->'relations')='object' THEN c.document->'relations' ELSE '{}'::jsonb END) r
       WHERE r.value ?| ARRAY['source_types','target_types'] OR COALESCE(r.value->>'participant_slot','') = '')
     OR EXISTS (SELECT 1 FROM catalog.definition_config c
       CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.document->'schemes')='object' THEN c.document->'schemes' ELSE '{}'::jsonb END) s
       WHERE s.value ? 'types') THEN
    RAISE EXCEPTION '000016 verification failed: old relation/scheme definition remains';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.user_preferences WHERE jsonb_typeof(home_shelves->'order') <> 'array'
    OR jsonb_typeof(home_shelves->'hidden') <> 'array' OR jsonb_typeof(home_shelves->'sections') <> 'array') THEN
    RAISE EXCEPTION '000016 verification failed: home_shelves arrays are invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.entities e CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.document->'pictures')='array' THEN e.document->'pictures' ELSE '[]'::jsonb END) p WHERE p.value ?| ARRAY['in_use_from','in_use_until'])
     OR EXISTS (SELECT 1 FROM catalog.revisions r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.snapshot->'pictures')='array' THEN r.snapshot->'pictures' ELSE '[]'::jsonb END) p WHERE r.snapshot ? 'kind' AND p.value ?| ARRAY['in_use_from','in_use_until'])
     OR EXISTS (SELECT 1 FROM catalog.outbox o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.payload->'pictures')='array' THEN o.payload->'pictures' ELSE '[]'::jsonb END) p WHERE o.type LIKE 'entity.%' AND p.value ?| ARRAY['in_use_from','in_use_until'])
     OR EXISTS (SELECT 1 FROM catalog.idempotency_keys i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.response->'pictures')='array' THEN i.response->'pictures' ELSE '[]'::jsonb END) p WHERE i.operation = 'entity.create' AND p.value ?| ARRAY['in_use_from','in_use_until']) THEN
    RAISE EXCEPTION '000016 verification failed: old picture interval keys remain';
  END IF;
END
$verify$;

DROP FUNCTION pg_temp.mf_000016_convert_entity(jsonb);
DROP FUNCTION pg_temp.mf_000016_check_entity(jsonb, text, text);
