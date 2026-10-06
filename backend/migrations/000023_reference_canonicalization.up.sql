-- One-time protocol normalization. Stop catalog writes while applying this
-- migration and deploy the strict reference writer only after it succeeds.
-- Historical revisions and user contributions remain immutable.
CREATE FUNCTION pg_temp.mf_reference_field(field jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE child jsonb;
BEGIN
    CASE field->>'type'
    WHEN 'entity' THEN RETURN true;
    WHEN 'group' THEN
        FOR child IN SELECT value FROM jsonb_each(coalesce(field->'fields', '{}'::jsonb)) LOOP
            IF pg_temp.mf_reference_field(child) THEN RETURN true; END IF;
        END LOOP;
    WHEN 'list' THEN RETURN pg_temp.mf_reference_field(field->'items');
    ELSE RETURN false;
    END CASE;
    RETURN false;
END $$;

CREATE FUNCTION pg_temp.mf_reference_value(value jsonb, field jsonb, site text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    raw text;
    parsed text;
    result jsonb;
    child record;
BEGIN
    IF value IS NULL OR value = 'null'::jsonb OR NOT pg_temp.mf_reference_field(field) THEN
        RETURN value;
    END IF;
    CASE field->>'type'
    WHEN 'entity' THEN
        IF jsonb_typeof(value) <> 'string' THEN
            RAISE EXCEPTION 'invalid entity reference type at %', site USING ERRCODE = '22023';
        END IF;
        raw := value #>> '{}';
        -- Empty optional reference slots are not UUIDs and keep their value.
        IF btrim(raw, E' \t\r\n\f' || chr(11) || U&'\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') = '' THEN
            RETURN value;
        END IF;
        -- Match the encodings accepted by google/uuid Parse, rather than
        -- PostgreSQL's more permissive UUID cast. Parse examines only the
        -- middle 36 bytes of a 38-byte encoding, regardless of its delimiters.
        CASE octet_length(raw)
        WHEN 36 THEN parsed := raw;
        WHEN 32 THEN
            IF raw !~ '^[0-9a-fA-F]{32}$' THEN
                RAISE EXCEPTION 'invalid entity reference format at %', site USING ERRCODE = '22023';
            END IF;
            parsed := raw;
        WHEN 45 THEN
            IF lower(left(raw, 9)) <> 'urn:uuid:' THEN
                RAISE EXCEPTION 'invalid entity reference format at %', site USING ERRCODE = '22023';
            END IF;
            parsed := substring(raw FROM 10);
        WHEN 38 THEN
            IF char_length(raw) <> 38 THEN
                RAISE EXCEPTION 'invalid entity reference format at %', site USING ERRCODE = '22023';
            END IF;
            parsed := substring(raw FROM 2 FOR 36);
        ELSE
            RAISE EXCEPTION 'invalid entity reference format at %', site USING ERRCODE = '22023';
        END CASE;
        IF octet_length(raw) <> 32 AND parsed !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
            RAISE EXCEPTION 'invalid entity reference format at %', site USING ERRCODE = '22023';
        END IF;
        RETURN to_jsonb(parsed::uuid::text);
    WHEN 'group' THEN
        IF jsonb_typeof(value) <> 'object' THEN
            RAISE EXCEPTION 'invalid reference group at %', site USING ERRCODE = '22023';
        END IF;
        result := value;
        FOR child IN SELECT key, v FROM jsonb_each(coalesce(field->'fields', '{}'::jsonb)) AS f(key, v) ORDER BY key LOOP
            IF value ? child.key THEN
                result := jsonb_set(result, ARRAY[child.key], pg_temp.mf_reference_value(value->child.key, child.v, site || '.' || child.key), false);
            END IF;
        END LOOP;
        RETURN result;
    WHEN 'list' THEN
        IF jsonb_typeof(value) <> 'array' THEN
            RAISE EXCEPTION 'invalid reference list at %', site USING ERRCODE = '22023';
        END IF;
        SELECT coalesce(jsonb_agg(pg_temp.mf_reference_value(item, field->'items', site || '[' || (ordinality - 1)::text || ']') ORDER BY ordinality), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(item, ordinality);
        RETURN result;
    ELSE RETURN value;
    END CASE;
END $$;

CREATE FUNCTION pg_temp.mf_reference_attributes(value jsonb, fields jsonb, selected jsonb, site text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb := value; code text;
BEGIN
    IF value IS NULL OR value = 'null'::jsonb THEN
        RETURN value;
    END IF;
    IF jsonb_typeof(value) <> 'object' THEN
        RAISE EXCEPTION 'invalid reference attributes at %', site USING ERRCODE = '22023';
    END IF;
    FOR code IN SELECT jsonb_array_elements_text(coalesce(selected, '[]'::jsonb)) LOOP
        IF value ? code AND fields ? code THEN
            result := jsonb_set(result, ARRAY[code], pg_temp.mf_reference_value(value->code, fields->code, site || '.' || code), false);
        END IF;
    END LOOP;
    RETURN result;
END $$;

DO $$
DECLARE
    definitions jsonb;
    fields jsonb;
    selected jsonb;
    normalized jsonb;
    normalized_locator jsonb;
    item record;
    changed_at timestamptz := clock_timestamp();
BEGIN
    LOCK TABLE catalog.definition_config, catalog.entities, catalog.relations,
        catalog.release_subjects, catalog.track_contents IN SHARE ROW EXCLUSIVE MODE;
    SELECT document INTO definitions FROM catalog.definition_config WHERE singleton;
    IF definitions IS NULL THEN
        IF EXISTS(SELECT 1 FROM catalog.entities) OR EXISTS(SELECT 1 FROM catalog.relations)
            OR EXISTS(SELECT 1 FROM catalog.release_subjects) OR EXISTS(SELECT 1 FROM catalog.track_contents) THEN
            RAISE EXCEPTION 'reference canonicalization requires published definitions for nonempty catalog';
        END IF;
        RETURN; -- A fresh installation is intentionally not seeded by migrations.
    END IF;
    fields := definitions->'fields';
    IF fields IS NULL OR jsonb_typeof(fields) <> 'object' THEN
        RAISE EXCEPTION 'reference canonicalization requires published field definitions';
    END IF;
    CREATE TEMP TABLE mf_normalized_entity_ids(id uuid PRIMARY KEY) ON COMMIT DROP;
    FOR item IN SELECT id, kind, document FROM catalog.entities ORDER BY id LOOP
        SELECT coalesce(jsonb_agg(key ORDER BY key), '[]'::jsonb) INTO selected
        FROM jsonb_each(fields) WHERE value->'applicable_kinds' ? item.kind;
        normalized := pg_temp.mf_reference_attributes(item.document->'attributes', fields, selected, 'entity:' || item.id::text || '.attributes');
        IF normalized IS DISTINCT FROM item.document->'attributes' THEN
            UPDATE catalog.entities SET document=jsonb_set(document, '{attributes}', normalized, false) WHERE id=item.id;
            INSERT INTO mf_normalized_entity_ids VALUES(item.id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    FOR item IN SELECT id, type, version, document FROM catalog.relations ORDER BY id LOOP
        selected := definitions->'relations'->item.type->'fields';
        normalized := pg_temp.mf_reference_attributes(item.document->'attributes', fields, selected, 'relation:' || item.id::text || '.attributes');
        IF normalized IS DISTINCT FROM item.document->'attributes' THEN
            UPDATE catalog.relations SET version=version+1,
                document=jsonb_set(jsonb_set(document, '{attributes}', normalized, false), '{version}', to_jsonb(version+1), true)
            WHERE id=item.id;
            -- Relations have no updated_at column; this event records the change
            -- time without inventing a user-authored revision or contributor.
            INSERT INTO catalog.outbox(id,type,entity_id,version,payload,created_at)
            SELECT gen_random_uuid(),'relation.normalized',id::text,version,document,changed_at
            FROM catalog.relations WHERE id=item.id;
        END IF;
    END LOOP;
    FOR item IN SELECT release_id,work_id,role,attributes FROM catalog.release_subjects ORDER BY release_id,work_id,role LOOP
        normalized := pg_temp.mf_reference_value(item.attributes, fields->'subject_attributes', 'release:' || item.release_id::text || '.subjects.attributes');
        IF normalized IS DISTINCT FROM item.attributes THEN
            UPDATE catalog.release_subjects SET attributes=normalized WHERE release_id=item.release_id AND work_id=item.work_id AND role=item.role;
            INSERT INTO mf_normalized_entity_ids VALUES(item.release_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    FOR item IN SELECT track_id,position,locator,attributes FROM catalog.track_contents ORDER BY track_id,position LOOP
        normalized_locator := pg_temp.mf_reference_value(item.locator, fields->'locator', 'track:' || item.track_id::text || '.contents[' || item.position::text || '].locator');
        normalized := pg_temp.mf_reference_value(item.attributes, fields->'inclusion_attributes', 'track:' || item.track_id::text || '.contents[' || item.position::text || '].attributes');
        IF normalized_locator IS DISTINCT FROM item.locator OR normalized IS DISTINCT FROM item.attributes THEN
            UPDATE catalog.track_contents SET locator=normalized_locator,attributes=normalized WHERE track_id=item.track_id AND position=item.position;
            INSERT INTO mf_normalized_entity_ids VALUES(item.track_id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
    -- Multiple normalized attributes/records belong to one metadata version.
    UPDATE catalog.entities SET version=version+1,updated_at=changed_at,
        document=jsonb_set(jsonb_set(document, '{version}', to_jsonb(version+1), true), '{updated_at}', to_jsonb(changed_at), true)
    WHERE id IN(SELECT id FROM mf_normalized_entity_ids);
    INSERT INTO catalog.outbox(id,type,entity_id,version,payload,created_at)
    SELECT gen_random_uuid(),'entity.normalized',e.id::text,e.version,e.document,changed_at
    FROM catalog.entities e JOIN mf_normalized_entity_ids n ON n.id=e.id;
END $$;

DROP FUNCTION pg_temp.mf_reference_attributes(jsonb,jsonb,jsonb,text);
DROP FUNCTION pg_temp.mf_reference_value(jsonb,jsonb,text);
DROP FUNCTION pg_temp.mf_reference_field(jsonb);

-- The catalog role can verify the current protocol without reading the private
-- migrator ledger. Future protocol migrations explicitly advance this marker.
CREATE TABLE IF NOT EXISTS catalog.schema_contract (
    singleton boolean PRIMARY KEY CHECK (singleton),
    version integer NOT NULL
);
INSERT INTO catalog.schema_contract(singleton,version) VALUES(true,23)
ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version;
