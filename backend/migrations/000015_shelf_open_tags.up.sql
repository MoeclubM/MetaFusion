-- Preserve existing category membership once, then make open tags the only
-- category rule. Entity types remain metadata schemas, not category filters.
WITH merged AS (
  SELECT e.id, jsonb_agg(DISTINCT tag.value) AS tags
  FROM catalog.entities e
  CROSS JOIN LATERAL (
    SELECT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(e.document->'attributes'->'tags') = 'array'
        THEN e.document->'attributes'->'tags' ELSE '[]'::jsonb END)
    UNION
    SELECT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(e.document->'types') = 'array'
        THEN e.document->'types' ELSE '[]'::jsonb END)
  ) tag
  WHERE e.kind = 'work'
  GROUP BY e.id
)
UPDATE catalog.entities e
SET document = jsonb_set(
  e.document, '{attributes}',
  COALESCE(e.document->'attributes', '{}'::jsonb) || jsonb_build_object('tags', merged.tags), true)
FROM merged
WHERE e.id = merged.id
  AND merged.tags <> COALESCE(e.document->'attributes'->'tags', '[]'::jsonb);

UPDATE catalog.shelves s
SET query = (s.query - 'types') || jsonb_build_object('tags', (
  SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
  FROM (
    SELECT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(s.query->'tags') = 'array' THEN s.query->'tags' ELSE '[]'::jsonb END)
    UNION
    SELECT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(s.query->'types') = 'array' THEN s.query->'types' ELSE '[]'::jsonb END)
  ) existing
))
WHERE s.query ? 'types';

UPDATE catalog.user_preferences p
SET home_shelves = jsonb_set(p.home_shelves, '{sections}', (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN section ? 'query' AND (section->'query') ? 'types' THEN
      jsonb_set(section, '{query}',
        ((section->'query') - 'types'::text) || jsonb_build_object('tags', (
          SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
          FROM (
            SELECT value FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(section->'query'->'tags') = 'array'
                THEN section->'query'->'tags' ELSE '[]'::jsonb END)
            UNION
            SELECT value FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(section->'query'->'types') = 'array'
                THEN section->'query'->'types' ELSE '[]'::jsonb END)
          ) values_to_keep
        )), true)
    ELSE section END ORDER BY ordinal), '[]'::jsonb) AS sections
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.home_shelves->'sections') = 'array'
      THEN p.home_shelves->'sections' ELSE '[]'::jsonb END) WITH ORDINALITY AS items(section, ordinal)
), true)
WHERE p.home_shelves ? 'sections';
