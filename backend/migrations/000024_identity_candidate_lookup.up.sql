-- Synchronous identity lookup: unrelated catalog writes must not invalidate
-- a creator's duplicate check. The index follows document writes atomically.
CREATE FUNCTION catalog.identity_title(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    SELECT lower(btrim(regexp_replace(value,
        U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')))
$$;

CREATE FUNCTION catalog.identity_scalar(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    SELECT CASE WHEN jsonb_typeof(value) <> 'number' THEN value #>> '{}'
        WHEN (value #>> '{}')::double precision = 0 THEN '0'
        WHEN abs((value #>> '{}')::double precision) >= 1e-6
            AND abs((value #>> '{}')::double precision) < 1e21
            THEN trim_scale(((value #>> '{}')::double precision)::text::numeric)::text
        ELSE regexp_replace(((value #>> '{}')::double precision)::text, 'e([-+])0+', 'e\1')
        END
$$;

CREATE FUNCTION catalog.identity_candidate_terms(doc jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
    WITH translations AS (
        SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(doc->'translations')='object'
            THEN doc->'translations' ELSE '{}'::jsonb END)
    ), titles AS (
        SELECT doc->>'title' AS value
        UNION ALL SELECT value->>'title' FROM translations
        UNION ALL SELECT alias #>> '{}' FROM translations,
            LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value->'aliases')='array'
                THEN value->'aliases' ELSE '[]'::jsonb END) alias
            WHERE jsonb_typeof(alias)='string'
        UNION ALL SELECT alias #>> '{}' FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(doc->'aliases')='array' THEN doc->'aliases' ELSE '[]'::jsonb END) alias
            WHERE jsonb_typeof(alias)='string'
    ), attrs AS (
        SELECT key, element FROM jsonb_each(CASE WHEN jsonb_typeof(doc->'attributes')='object'
            THEN doc->'attributes' ELSE '{}'::jsonb END),
            LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array'
                THEN value ELSE jsonb_build_array(value) END) element
        WHERE jsonb_typeof(element) IN ('string','number','boolean')
    ), terms AS (
        SELECT jsonb_build_array('title',catalog.identity_title(value))::text AS term
            FROM titles WHERE catalog.identity_title(value) <> ''
        UNION ALL SELECT jsonb_build_array('external',key,value #>> '{}')::text
            FROM jsonb_each(CASE WHEN jsonb_typeof(doc->'external_ids')='object'
                THEN doc->'external_ids' ELSE '{}'::jsonb END) WHERE jsonb_typeof(value)='string'
        UNION ALL SELECT jsonb_build_array('attribute',key,catalog.identity_scalar(element))::text FROM attrs
    -- Hashes bound GIN key size even for long text attributes. They select
    -- candidates only; clients still verify the original exact match evidence.
    ) SELECT coalesce(array_agg(DISTINCT md5(term)), ARRAY[]::text[]) FROM terms
$$;

CREATE INDEX entities_identity_candidates_idx ON catalog.entities
    USING gin (catalog.identity_candidate_terms(document)) WHERE status <> 'deleted';
