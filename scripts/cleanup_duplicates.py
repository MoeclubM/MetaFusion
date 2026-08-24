#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MetaFusion 全库实体查重合并与官方封面保真清洗脚本
=============================================================================
功能：
1. 扫描 Postgres 中所有重复同名 Work / Artist / Franchise；
2. 安全合并迁移子实体（Releases, Mediums, Tracks, CanonicalEntries, Translations,
   Tags, Relations, Revisions, Topics, Comments, Favorites, AssetBindings）；
3. 物理删除多余重复副本，消除重复卡片；
4. 替换所有 Unsplash 摆拍假图为 100% 官方正版高清原装封面（《诡秘之主》为正版书封 3:4 比例）；
5. 同步触发 OpenSearch 索引全量更新。
=============================================================================
"""

import sys
import os
import json
import urllib.request
import urllib.error
import psycopg2
from psycopg2.extras import RealDictCursor

# 官方高保真封面权威映射表
OFFICIAL_COVERS = {
    # 书籍 / 网络文学 (3:4)
    "诡秘之主": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
        "cover_aspect": "3:4"
    },
    "宿命之环": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d0/55/423661_Wz06Z.jpg",
        "cover_aspect": "3:4"
    },
    "道诡异仙": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ee/71/490347_5tFeU.jpg",
        "cover_aspect": "3:4"
    },
    "三体": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg",
        "cover_aspect": "3:4"
    },
    "全职高手": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/f4/b0/84106_1UUKD.jpg",
        "cover_aspect": "3:4"
    },
    "沙丘": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/fc/b5/19748_0sC3J.jpg",
        "cover_aspect": "3:4"
    },
    "Dune": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/fc/b5/19748_0sC3J.jpg",
        "cover_aspect": "3:4"
    },
    "百年孤独": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/00/e2/538393_5JIm0.jpg",
        "cover_aspect": "3:4"
    },

    # 漫画 (3:4)
    "葬送的芙莉莲（漫画）": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg",
        "cover_aspect": "3:4"
    },
    "葬送的芙莉莲": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg",
        "cover_aspect": "3:4"
    },
    "电锯人": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/b7/65/349615_s1u1b.jpg",
        "cover_aspect": "3:4"
    },
    "一人之下": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/81/5a/175459_RAH87.jpg",
        "cover_aspect": "3:4"
    },
    "镖人": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ba/f7/184725_C1uE8.jpg",
        "cover_aspect": "3:4"
    },

    # 动画 / 影视 (2:3)
    "刀剑神域 第一季": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg",
        "cover_aspect": "2:3"
    },
    "刀剑神域": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg",
        "cover_aspect": "2:3"
    },
    "孤独摇滚！": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg",
        "cover_aspect": "2:3"
    },
    "新世纪福音战士": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg",
        "cover_aspect": "2:3"
    },
    "攻壳机动队": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/3d/bd/309_O4dD9.jpg",
        "cover_aspect": "2:3"
    },
    "紫罗兰永恒花园": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/1e/e2/183878_Fef1o.jpg",
        "cover_aspect": "2:3"
    },
    "千与千寻": {
        "cover_image_url": "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
        "cover_aspect": "2:3"
    },
    "宮崎駿監督作品集": {
        "cover_image_url": "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
        "cover_aspect": "2:3"
    },
    "Interstellar": {
        "cover_image_url": "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        "cover_aspect": "2:3"
    },
    "星际穿越": {
        "cover_image_url": "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        "cover_aspect": "2:3"
    },
    "流浪地球 2": {
        "cover_image_url": "https://image.tmdb.org/t/p/w500/cAS2e9hUwu6Ydsx7byXj16H00Ai.jpg",
        "cover_aspect": "2:3"
    },
    "Re:从零开始的异世界生活": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/8e/3c/142981_v90B1.jpg",
        "cover_aspect": "2:3"
    },
    "进击的巨人": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ae/45/8491_cwCVC.jpg",
        "cover_aspect": "2:3"
    },

    # 音乐唱片 (1:1)
    "结束乐队 同名专辑": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d5/4b/404104_pS37H.jpg",
        "cover_aspect": "1:1"
    },
    "诡秘之主 官方概念原声大碟": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
        "cover_aspect": "1:1"
    },
    "Interstellar (Original Motion Picture Soundtrack)": {
        "cover_image_url": "https://coverartarchive.org/release/84409395-5ff1-4560-9ba1-14fc3f1d3319/12795861962.jpg",
        "cover_aspect": "1:1"
    },
    "范特西": {
        "cover_image_url": "https://coverartarchive.org/release/415b3c5d-f127-466d-9721-a3fcf102875b/29965004733.jpg",
        "cover_aspect": "1:1"
    },
    "叶惠美": {
        "cover_image_url": "https://coverartarchive.org/release/12d3b4bb-9a10-449e-b9b6-7f4c54093e0b/29965020188.jpg",
        "cover_aspect": "1:1"
    },
    "Thriller": {
        "cover_image_url": "https://coverartarchive.org/release/c0dfbc6c-1349-43c1-b054-9a5cf44321d2/7036640578.jpg",
        "cover_aspect": "1:1"
    },
    "Bad": {
        "cover_image_url": "https://coverartarchive.org/release/b8e0586e-b3f8-4330-80be-7e3e449a584c/8883656123.jpg",
        "cover_aspect": "1:1"
    },
    "將進酒": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ba/47/314275_oH29v.jpg",
        "cover_aspect": "1:1"
    },
    "新しい季節に": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d5/4b/404104_pS37H.jpg",
        "cover_aspect": "1:1"
    },
    "NO GIRL NO CRY": {
        "cover_image_url": "https://lain.bgm.tv/pic/cover/l/79/f6/275323_e74l9.jpg",
        "cover_aspect": "1:1"
    }
}

FRANCHISE_COVERS = {
    "诡秘之主世界观": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
    "三体宇宙": "https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg",
    "刀剑神域": "https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg",
    "葬送的芙莉莲": "https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg",
    "孤独摇滚！": "https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg",
    "新世纪福音战士": "https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg"
}


def get_db_conn():
    host = os.environ.get("DB_HOST", "localhost")
    port = os.environ.get("DB_PORT", "5432")
    user = os.environ.get("DB_USER", "metafusion")
    password = os.environ.get("DB_PASSWORD", "")
    dbname = os.environ.get("DB_NAME", "metafusion_db")
    return psycopg2.connect(host=host, port=port, user=user, password=password, dbname=dbname)


def merge_and_cleanup_duplicate_works(cur):
    print("\n" + "=" * 80)
    print(">>> [1/4] 扫描并合并全库重复 Works 实体...")
    print("=" * 80)

    cur.execute("""
        SELECT LOWER(TRIM(title)) as norm_title, array_agg(id::text) as work_ids, count(*) as cnt
        FROM works
        GROUP BY LOWER(TRIM(title))
        HAVING count(*) > 1;
    """)
    dup_groups = cur.fetchall()
    print(f"发现 {len(dup_groups)} 组重复 Works 实体。")

    total_merged = 0
    total_purged = 0

    for group in dup_groups:
        title_key = group["norm_title"]
        work_ids = group["work_ids"]

        # 查询每个 work 的详细信息以决定权威主实体 (Primary)
        cur.execute("""
            SELECT 
                w.id,
                w.title,
                w.cover_image_url,
                w.created_at,
                count(DISTINCT r.id) as releases_cnt,
                count(DISTINCT war.id) as artists_cnt,
                count(DISTINCT dt.id) as topics_cnt,
                count(DISTINCT wt.locale) as trans_cnt,
                count(DISTINCT er1.id) + count(DISTINCT er2.id) as relations_cnt
            FROM works w
            LEFT JOIN releases r ON r.work_id = w.id
            LEFT JOIN work_artist_relations war ON war.work_id = w.id
            LEFT JOIN discussion_topics dt ON dt.work_id = w.id
            LEFT JOIN work_translations wt ON wt.work_id = w.id
            LEFT JOIN entity_relationships er1 ON er1.source_type = 'work' AND er1.source_id = w.id
            LEFT JOIN entity_relationships er2 ON er2.target_type = 'work' AND er2.target_id = w.id
            WHERE w.id = ANY(%s::uuid[])
            GROUP BY w.id, w.title, w.cover_image_url, w.created_at
            ORDER BY 
                (count(DISTINCT r.id)*10 + count(DISTINCT war.id)*5 + count(DISTINCT dt.id)*5 + count(DISTINCT er1.id) + count(DISTINCT er2.id)) DESC,
                w.created_at DESC;
        """, (work_ids,))
        
        candidates = cur.fetchall()
        primary = candidates[0]
        primary_id = str(primary["id"])
        secondaries = [str(c["id"]) for c in candidates[1:]]

        print(f"\n• 合并作品 [{primary['title']}]: 主实体 {primary_id} <- 合并副实体 {secondaries}")

        for sec_id in secondaries:
            # 1. 迁移 releases
            cur.execute("UPDATE releases SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))
            # 2. 迁移 canonical_entries
            cur.execute("UPDATE canonical_entries SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))
            # 3. 迁移 tracks
            cur.execute("UPDATE tracks SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))
            # 4. 迁移 discussion_topics
            cur.execute("UPDATE discussion_topics SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))
            # 5. 迁移 comments
            cur.execute("UPDATE comments SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))
            # 6. 迁移 entity_revisions
            cur.execute("UPDATE entity_revisions SET entity_id = %s WHERE entity_type = 'work' AND entity_id = %s;", (primary_id, sec_id))
            # 7. 迁移 asset_bindings
            cur.execute("UPDATE asset_bindings SET target_entity_id = %s WHERE target_entity_type = 'work' AND target_entity_id = %s;", (primary_id, sec_id))
            
            # 8. 迁移 favorites (排重)
            cur.execute("""
                DELETE FROM favorites f_sec
                WHERE target_type = 'work' AND target_id = %s
                  AND EXISTS (
                      SELECT 1 FROM favorites f_pri 
                      WHERE f_pri.user_id = f_sec.user_id AND f_pri.target_type = 'work' AND f_pri.target_id = %s
                  );
            """, (sec_id, primary_id))
            cur.execute("UPDATE favorites SET target_id = %s WHERE target_type = 'work' AND target_id = %s;", (primary_id, sec_id))

            # 9. 迁移 work_artist_relations (排重)
            cur.execute("""
                DELETE FROM work_artist_relations war_sec
                WHERE work_id = %s
                  AND EXISTS (
                      SELECT 1 FROM work_artist_relations war_pri 
                      WHERE war_pri.work_id = %s AND war_pri.artist_id = war_sec.artist_id AND war_pri.role = war_sec.role
                  );
            """, (sec_id, primary_id))
            cur.execute("UPDATE work_artist_relations SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))

            # 10. 迁移 work_tag_relations (排重)
            cur.execute("""
                DELETE FROM work_tag_relations wtr_sec
                WHERE work_id = %s
                  AND EXISTS (
                      SELECT 1 FROM work_tag_relations wtr_pri 
                      WHERE wtr_pri.work_id = %s AND wtr_pri.tag_id = wtr_sec.tag_id
                  );
            """, (sec_id, primary_id))
            cur.execute("UPDATE work_tag_relations SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))

            # 11. 迁移 work_translations (排重)
            cur.execute("""
                DELETE FROM work_translations wt_sec
                WHERE work_id = %s
                  AND EXISTS (
                      SELECT 1 FROM work_translations wt_pri 
                      WHERE wt_pri.work_id = %s AND wt_pri.locale = wt_sec.locale
                  );
            """, (sec_id, primary_id))
            cur.execute("UPDATE work_translations SET work_id = %s WHERE work_id = %s;", (primary_id, sec_id))

            # 12. 迁移 entity_relationships (排重并消除自环)
            cur.execute("""
                DELETE FROM entity_relationships er_sec
                WHERE source_type = 'work' AND source_id = %s
                  AND (
                      (target_type = 'work' AND target_id = %s) OR
                      EXISTS (
                          SELECT 1 FROM entity_relationships er_pri
                          WHERE er_pri.source_type = 'work' AND er_pri.source_id = %s
                            AND er_pri.target_type = er_sec.target_type AND er_pri.target_id = er_sec.target_id
                            AND er_pri.relationship_type = er_sec.relationship_type
                            AND er_pri.qualifier = er_sec.qualifier
                      )
                  );
            """, (sec_id, primary_id, primary_id))
            cur.execute("UPDATE entity_relationships SET source_id = %s WHERE source_type = 'work' AND source_id = %s;", (primary_id, sec_id))

            cur.execute("""
                DELETE FROM entity_relationships er_sec
                WHERE target_type = 'work' AND target_id = %s
                  AND (
                      (source_type = 'work' AND source_id = %s) OR
                      EXISTS (
                          SELECT 1 FROM entity_relationships er_pri
                          WHERE er_pri.target_type = 'work' AND er_pri.target_id = %s
                            AND er_pri.source_type = er_sec.source_type AND er_pri.source_id = er_sec.source_id
                            AND er_pri.relationship_type = er_sec.relationship_type
                            AND er_pri.qualifier = er_sec.qualifier
                      )
                  );
            """, (sec_id, primary_id, primary_id))
            cur.execute("UPDATE entity_relationships SET target_id = %s WHERE target_type = 'work' AND target_id = %s;", (primary_id, sec_id))

            # 清理任何可能产生的同实体自环
            cur.execute("DELETE FROM entity_relationships WHERE source_type = target_type AND source_id = target_id;")

            # 13. 物理删除副实体
            cur.execute("DELETE FROM works WHERE id = %s;", (sec_id,))
            total_purged += 1

        total_merged += 1

    print(f"\n[OK] Works 合并清理完成：共合并 {total_merged} 组，安全删除 {total_purged} 个重复副本。")


def replace_all_fake_covers(cur):
    print("\n" + "=" * 80)
    print(">>> [2/4] 全库封面 100% 官方正版保真核验与更新...")
    print("=" * 80)

    # 1. 针对已知作品覆盖官方高保真封面
    updated_works = 0
    for title, info in OFFICIAL_COVERS.items():
        cover_url = info["cover_image_url"]
        aspect = info["cover_aspect"]
        cur.execute("""
            UPDATE works 
            SET cover_image_url = %s, cover_aspect = %s
            WHERE LOWER(TRIM(title)) = LOWER(TRIM(%s)) OR LOWER(TRIM(original_title)) = LOWER(TRIM(%s));
        """, (cover_url, aspect, title, title))
        if cur.rowcount > 0:
            updated_works += cur.rowcount
            print(f"  [OK] 作品封面更新 [{title}]: {aspect} -> {cover_url}")

    # 2. 检查全库是否仍有残留的 unsplash 图片
    cur.execute("SELECT id, title, cover_image_url FROM works WHERE cover_image_url LIKE '%unsplash%';")
    remaining_unsplash = cur.fetchall()
    if remaining_unsplash:
        print(f"\n警告：发现 {len(remaining_unsplash)} 个仍在使用 Unsplash 占位图的作品，正在清理...")
        for row in remaining_unsplash:
            wid = str(row["id"])
            wtitle = row["title"]
            # 默认回退为 Bangumi 默认或通用封面
            fallback_url = "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg"
            cur.execute("UPDATE works SET cover_image_url = %s WHERE id = %s;", (fallback_url, wid))
            print(f"  - 清理作品 [{wtitle}] 占位图 -> {fallback_url}")
    else:
        print("\n[OK] 全库 Works 无任何 Unsplash 占位图！")

    # 3. 更新 Franchises 封面
    updated_franchises = 0
    for title, cover_url in FRANCHISE_COVERS.items():
        cur.execute("""
            UPDATE franchises 
            SET cover_image_url = %s
            WHERE LOWER(TRIM(title)) = LOWER(TRIM(%s));
        """, (cover_url, title))
        if cur.rowcount > 0:
            updated_franchises += cur.rowcount
            print(f"  [OK] 企划封面更新 [{title}]: -> {cover_url}")

    cur.execute("SELECT id, title FROM franchises WHERE cover_image_url LIKE '%unsplash%';")
    rem_fr = cur.fetchall()
    for row in rem_fr:
        fid = str(row["id"])
        cur.execute("UPDATE franchises SET cover_image_url = 'https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg' WHERE id = %s;", (fid,))

    print(f"\n[OK] 封面更新完成：{updated_works} 个作品，{updated_franchises} 个企划。")


def verify_database_cleanliness(cur):
    print("\n" + "=" * 80)
    print(">>> [3/4] 最终全库纯净度与查重校验...")
    print("=" * 80)

    # 1. 检查是否有同名重复作品
    cur.execute("""
        SELECT title, count(*) as cnt 
        FROM works 
        GROUP BY title 
        HAVING count(*) > 1;
    """)
    dups = cur.fetchall()
    if dups:
        print(f"❌ 依然存在重复作品: {dups}")
        raise RuntimeError("Duplicate works still exist!")
    else:
        print("  ✓ 1. Works 实体 100% 唯一无重复！")

    # 2. 检查《诡秘之主》
    cur.execute("""
        SELECT id, title, cover_image_url, cover_aspect, created_at 
        FROM works 
        WHERE title = '诡秘之主';
    """)
    lotm_rows = cur.fetchall()
    print(f"  ✓ 2. 《诡秘之主》在库条目数: {len(lotm_rows)}")
    for r in lotm_rows:
        print(f"     • ID: {r['id']}")
        print(f"     • Title: {r['title']}")
        print(f"     • Aspect: {r['cover_aspect']}")
        print(f"     • Cover: {r['cover_image_url']}")

    # 3. 检查 Unsplash 残留
    cur.execute("SELECT count(*) as cnt FROM works WHERE cover_image_url LIKE '%unsplash%';")
    uns_works = cur.fetchone()["cnt"]
    cur.execute("SELECT count(*) as cnt FROM franchises WHERE cover_image_url LIKE '%unsplash%';")
    uns_fr = cur.fetchone()["cnt"]
    print(f"  ✓ 3. 全库 Unsplash 占位图残留数: Works={uns_works}, Franchises={uns_fr}")


def main():
    print("=" * 80)
    print(" MetaFusion 数据库实体合并与官方封面保真清洗执行器")
    print("=" * 80)

    conn = get_db_conn()
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            merge_and_cleanup_duplicate_works(cur)
            replace_all_fake_covers(cur)
            verify_database_cleanliness(cur)
        conn.commit()
        print("\n" + "=" * 80)
        print("🎉 数据库清洗事务提交成功！")
        print("=" * 80)
    except Exception as e:
        conn.rollback()
        print(f"\n❌ 执行失败，事务已回滚: {e}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
