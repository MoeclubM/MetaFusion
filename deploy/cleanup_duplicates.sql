
BEGIN;

-- 1. 创建临时表记录所有重复作品组
CREATE TEMP TABLE tmp_duplicate_works AS
SELECT 
    LOWER(TRIM(title)) AS norm_title,
    array_agg(id ORDER BY created_at DESC) AS all_ids,
    count(*) AS cnt
FROM works
GROUP BY LOWER(TRIM(title))
HAVING count(*) > 1;

-- 2. 编写合并清理过程
DO $$
DECLARE
    rec RECORD;
    primary_id UUID;
    sec_id UUID;
    secondaries UUID[];
BEGIN
    FOR rec IN SELECT * FROM tmp_duplicate_works LOOP
        -- 选取关联数据最多、或最新的作为 primary_id
        SELECT w.id INTO primary_id
        FROM works w
        LEFT JOIN releases r ON r.work_id = w.id
        LEFT JOIN work_artist_relations war ON war.work_id = w.id
        LEFT JOIN discussion_topics dt ON dt.work_id = w.id
        LEFT JOIN entity_relationships er1 ON er1.source_type = 'work' AND er1.source_id = w.id
        LEFT JOIN entity_relationships er2 ON er2.target_type = 'work' AND er2.target_id = w.id
        WHERE w.id = ANY(rec.all_ids)
        GROUP BY w.id, w.created_at
        ORDER BY (count(DISTINCT r.id)*10 + count(DISTINCT war.id)*5 + count(DISTINCT dt.id)*5 + count(DISTINCT er1.id) + count(DISTINCT er2.id)) DESC, w.created_at DESC
        LIMIT 1;

        RAISE NOTICE 'Merging works for [%], Primary ID: %', rec.norm_title, primary_id;

        -- 遍历所有 secondary_id
        FOREACH sec_id IN ARRAY rec.all_ids LOOP
            IF sec_id <> primary_id THEN
                RAISE NOTICE '  - Merging secondary % into primary %', sec_id, primary_id;

                -- releases
                UPDATE releases SET work_id = primary_id WHERE work_id = sec_id;
                -- canonical_entries
                UPDATE canonical_entries SET work_id = primary_id WHERE work_id = sec_id;
                -- tracks
                UPDATE tracks SET work_id = primary_id WHERE work_id = sec_id;
                -- discussion_topics
                UPDATE discussion_topics SET work_id = primary_id WHERE work_id = sec_id;
                -- comments
                UPDATE comments SET work_id = primary_id WHERE work_id = sec_id;
                -- entity_revisions
                UPDATE entity_revisions SET target_id = primary_id WHERE target_type = 'work' AND target_id = sec_id;
                -- asset_bindings
                UPDATE asset_bindings SET target_entity_id = primary_id WHERE target_entity_type = 'work' AND target_entity_id = sec_id;

                -- favorites (排重)
                DELETE FROM favorites f_sec
                WHERE target_type = 'work' AND target_id = sec_id
                  AND EXISTS (
                      SELECT 1 FROM favorites f_pri 
                      WHERE f_pri.user_id = f_sec.user_id AND f_pri.target_type = 'work' AND f_pri.target_id = primary_id
                  );
                UPDATE favorites SET target_id = primary_id WHERE target_type = 'work' AND target_id = sec_id;

                -- work_artist_relations (排重)
                DELETE FROM work_artist_relations war_sec
                WHERE work_id = sec_id
                  AND EXISTS (
                      SELECT 1 FROM work_artist_relations war_pri 
                      WHERE war_pri.work_id = primary_id AND war_pri.artist_id = war_sec.artist_id AND war_pri.role = war_sec.role
                  );
                UPDATE work_artist_relations SET work_id = primary_id WHERE work_id = sec_id;

                -- work_tag_relations (排重)
                DELETE FROM work_tag_relations wtr_sec
                WHERE work_id = sec_id
                  AND EXISTS (
                      SELECT 1 FROM work_tag_relations wtr_pri 
                      WHERE wtr_pri.work_id = primary_id AND wtr_pri.tag_id = wtr_sec.tag_id
                  );
                UPDATE work_tag_relations SET work_id = primary_id WHERE work_id = sec_id;

                -- work_translations (排重)
                DELETE FROM work_translations wt_sec
                WHERE work_id = sec_id
                  AND EXISTS (
                      SELECT 1 FROM work_translations wt_pri 
                      WHERE wt_pri.work_id = primary_id AND wt_pri.locale = wt_sec.locale
                  );
                UPDATE work_translations SET work_id = primary_id WHERE work_id = sec_id;

                -- entity_relationships (排重并消除自环)
                DELETE FROM entity_relationships er_sec
                WHERE source_type = 'work' AND source_id = sec_id
                  AND (
                      (target_type = 'work' AND target_id = primary_id) OR
                      EXISTS (
                          SELECT 1 FROM entity_relationships er_pri
                          WHERE er_pri.source_type = 'work' AND er_pri.source_id = primary_id
                            AND er_pri.target_type = er_sec.target_type AND er_pri.target_id = er_sec.target_id
                            AND er_pri.relationship_type = er_sec.relationship_type
                            AND er_pri.qualifier = er_sec.qualifier
                      )
                  );
                UPDATE entity_relationships SET source_id = primary_id WHERE source_type = 'work' AND source_id = sec_id;

                DELETE FROM entity_relationships er_sec
                WHERE target_type = 'work' AND target_id = sec_id
                  AND (
                      (source_type = 'work' AND source_id = primary_id) OR
                      EXISTS (
                          SELECT 1 FROM entity_relationships er_pri
                          WHERE er_pri.target_type = 'work' AND er_pri.target_id = primary_id
                            AND er_pri.source_type = er_sec.source_type AND er_pri.source_id = er_sec.source_id
                            AND er_pri.relationship_type = er_sec.relationship_type
                            AND er_pri.qualifier = er_sec.qualifier
                      )
                  );
                UPDATE entity_relationships SET target_id = primary_id WHERE target_type = 'work' AND target_id = sec_id;

                -- 删除次要作品记录
                DELETE FROM works WHERE id = sec_id;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 消除同实体自环
DELETE FROM entity_relationships WHERE source_type = target_type AND source_id = target_id;

-- 3. 官方高保真封面覆盖更新（100% 正版原画与规范长宽比）
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '诡秘之主';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/d0/55/423661_Wz06Z.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '宿命之环';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/ee/71/490347_5tFeU.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '道诡异仙';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '三体';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/f4/b0/84106_1UUKD.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '全职高手';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/fc/b5/19748_0sC3J.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '沙丘' OR LOWER(TRIM(title)) = 'dune';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/00/e2/538393_5JIm0.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '百年孤独';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) LIKE '%葬送的芙莉莲%';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/b7/65/349615_s1u1b.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '电锯人';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/81/5a/175459_RAH87.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '一人之下';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/ba/f7/184725_C1uE8.jpg', cover_aspect = '3:4' WHERE LOWER(TRIM(title)) = '镖人';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) LIKE '%刀剑神域%';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '孤独摇滚！';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '新世纪福音战士';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/3d/bd/309_O4dD9.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '攻壳机动队';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/1e/e2/183878_Fef1o.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '紫罗兰永恒花园';
UPDATE works SET cover_image_url = 'https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '千与千寻';
UPDATE works SET cover_image_url = 'https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '宮崎駿監督作品集';
UPDATE works SET cover_image_url = 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = 'interstellar' OR LOWER(TRIM(title)) = '星际穿越';
UPDATE works SET cover_image_url = 'https://image.tmdb.org/t/p/w500/cAS2e9hUwu6Ydsx7byXj16H00Ai.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) LIKE '%流浪地球%';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/8e/3c/142981_v90B1.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = 're:从零开始的异世界生活';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/ae/45/8491_cwCVC.jpg', cover_aspect = '2:3' WHERE LOWER(TRIM(title)) = '进击的巨人';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/d5/4b/404104_pS37H.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '结束乐队 同名专辑';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '诡秘之主 官方概念原声大碟';
UPDATE works SET cover_image_url = 'https://coverartarchive.org/release/84409395-5ff1-4560-9ba1-14fc3f1d3319/12795861962.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) LIKE '%interstellar (original motion picture soundtrack)%';
UPDATE works SET cover_image_url = 'https://coverartarchive.org/release/415b3c5d-f127-466d-9721-a3fcf102875b/29965004733.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '范特西';
UPDATE works SET cover_image_url = 'https://coverartarchive.org/release/12d3b4bb-9a10-449e-b9b6-7f4c54093e0b/29965020188.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '叶惠美';
UPDATE works SET cover_image_url = 'https://coverartarchive.org/release/c0dfbc6c-1349-43c1-b054-9a5cf44321d2/7036640578.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = 'thriller';
UPDATE works SET cover_image_url = 'https://coverartarchive.org/release/b8e0586e-b3f8-4330-80be-7e3e449a584c/8883656123.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = 'bad';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/ba/47/314275_oH29v.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '將進酒';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/d5/4b/404104_pS37H.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = '新しい季節に';
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/79/f6/275323_e74l9.jpg', cover_aspect = '1:1' WHERE LOWER(TRIM(title)) = 'no girl no cry';

-- 4. 清理任何剩余的 unsplash 占位图
UPDATE works SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg' WHERE cover_image_url LIKE '%unsplash%';

-- 5. 更新企划封面
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg' WHERE LOWER(TRIM(title)) = '诡秘之主世界观';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg' WHERE LOWER(TRIM(title)) = '三体宇宙';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg' WHERE LOWER(TRIM(title)) = '刀剑神域';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg' WHERE LOWER(TRIM(title)) = '葬送的芙莉莲';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg' WHERE LOWER(TRIM(title)) = '孤独摇滚！';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg' WHERE LOWER(TRIM(title)) = '新世纪福音战士';
UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg' WHERE cover_image_url LIKE '%unsplash%';

COMMIT;
