-- Structural facts retain their existing foreign keys and inclusion tables.
-- Move only their display names into the one published, editable definition document.
DO $$
DECLARE
  doc jsonb;
  entry record;
  fields jsonb;
  renamed jsonb;
  forward_names jsonb;
  reverse_names jsonb;
BEGIN
  SELECT document INTO doc FROM catalog.definition_config WHERE singleton = true FOR UPDATE;
  IF doc IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(doc #> '{structure,release}') <> 'object' THEN
    RAISE EXCEPTION 'missing release structural rule';
  END IF;
  FOR entry IN
    SELECT * FROM (VALUES
      ('content_unit','work_id','包含内容单元','包含內容單元','内容単位を含む','Contains content unit','属于作品','屬於作品','作品に属する','Belongs to work'),
      ('expression','work_id','具有内容表达','具有內容表達','表現を持つ','Has expression','表达作品','表達作品','作品を表現する','Expression of work'),
      ('medium','release_id','包含载体','包含載體','媒体を含む','Contains medium','属于发行版','屬於發行版','リリースに属する','Belongs to release'),
      ('track','medium_id','包含收录位置','包含收錄位置','収録位置を含む','Contains track','属于载体','屬於載體','媒体に属する','Belongs to medium'),
      ('content_unit','parent_id','包含下级内容单元','包含下級內容單元','下位内容単位を含む','Contains child content unit','位于上级内容单元','位於上級內容單元','上位内容単位に属する','Within parent content unit'),
      ('expression','content_unit_id','承载内容表达','承載內容表達','表現を持つ','Hosts expression','属于内容单元','屬於內容單元','内容単位に属する','Within content unit'),
      ('medium','parent_id','包含下级载体','包含下級載體','下位媒体を含む','Contains child medium','位于上级载体','位於上級載體','上位媒体に属する','Within parent medium'),
      ('track','parent_id','包含下级收录位置','包含下級收錄位置','下位収録位置を含む','Contains child track','位于上级收录位置','位於上級收錄位置','上位収録位置に属する','Within parent track')
    ) AS v(kind, code, f_zh, f_tw, f_ja, f_en, r_zh, r_tw, r_ja, r_en)
  LOOP
    fields := doc #> ARRAY['structure',entry.kind,'fields'];
    IF fields IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fields) f WHERE f->>'code' = entry.code) THEN
      RAISE EXCEPTION 'missing structural field %.%', entry.kind, entry.code;
    END IF;
    forward_names := jsonb_build_object('zh-CN',entry.f_zh,'zh-TW',entry.f_tw,'ja',entry.f_ja,'ja-JP',entry.f_ja,'en-US',entry.f_en);
    reverse_names := jsonb_build_object('zh-CN',entry.r_zh,'zh-TW',entry.r_tw,'ja',entry.r_ja,'ja-JP',entry.r_ja,'en-US',entry.r_en);
    SELECT jsonb_agg(CASE WHEN f->>'code' = entry.code
      THEN f || jsonb_build_object('names',forward_names,'reverse_names',reverse_names)
      ELSE f END ORDER BY ordinal)
      INTO renamed FROM jsonb_array_elements(fields) WITH ORDINALITY AS x(f,ordinal);
    doc := jsonb_set(doc, ARRAY['structure',entry.kind,'fields'], renamed, false);
  END LOOP;
  doc := jsonb_set(doc, '{structure,release,subject_names}',
    jsonb_build_object('zh-CN','发行作品','zh-TW','發行作品','ja','作品をリリースする','ja-JP','作品をリリースする','en-US','Releases work'), true);
  doc := jsonb_set(doc, '{structure,release,subject_reverse_names}',
    jsonb_build_object('zh-CN','由发行版收录','zh-TW','由發行版收錄','ja','リリースに収録される','ja-JP','リリースに収録される','en-US','Subject of release'), true);
  doc := jsonb_set(doc, '{structure,track,content_names}',
    jsonb_build_object('zh-CN','收录内容表达','zh-TW','收錄內容表達','ja','表現を収録する','ja-JP','表現を収録する','en-US','Includes expression'), true);
  doc := jsonb_set(doc, '{structure,track,content_reverse_names}',
    jsonb_build_object('zh-CN','被收录于位置','zh-TW','被收錄於位置','ja','収録位置に含まれる','ja-JP','収録位置に含まれる','en-US','Included in track'), true);
  -- Rename only the old seed label; preserve any administrator-authored wording.
  IF doc #>> '{fields,catalog_number,names,zh-CN}' = '品番'
     AND doc #>> '{fields,catalog_number,names,zh-TW}' = '唱片編號'
     AND doc #>> '{fields,catalog_number,names,ja}' = '品番'
     AND doc #>> '{fields,catalog_number,names,en-US}' = 'Catalog number' THEN
    doc := jsonb_set(doc, '{fields,catalog_number,names}',
      jsonb_build_object('zh-CN','出版编号','zh-TW','出版編號','ja','出版番号','ja-JP','出版番号','en-US','Publication number'), false);
  END IF;
  UPDATE catalog.definition_config SET document = doc, etag = md5(doc::text || clock_timestamp()::text), updated_at = now() WHERE singleton = true;
END $$;
