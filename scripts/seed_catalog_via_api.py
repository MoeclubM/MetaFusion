#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MetaFusion 标准 REST API 全量编目与测试数据导入套件
=============================================================================
规范与准则：
1. 严禁客户端硬编码假 UUID：
   - 必须通过后端标准 REST API（POST /catalog/artists, POST /catalog/works 等）创建；
   - 所有实体 UUID 均由 Go 后端自动分配（gen_random_uuid()），脚本记录动态返回的 ID 进行下游关联；
2. 完整版本修订与审计追踪：
   - 每次写入附带 edit_note 与 source_urls，自动产生 entity_revisions 修订记录与 admin_audit_logs；
3. 严格遵循 LRM 与 MusicBrainz 编目标准（.cursor/skills/lrm-catalog-standards/SKILL.md）：
   - Work.title 为纯净题名；
   - Release.edition_name 具有具体版本、出版机构、装帧或数字平台规格，附带 ISBN-13 / 条形码 / Catalog Number；
   - 完整的演职人员谱系（PUT /catalog/works/:id/relations）；
   - 跨媒介图谱语义边（PUT /catalog/entity-relations）；
   - 社区论坛讨论（POST /community/topics），包含 Markdown、LaTeX 公式、考据评注与闲聊答疑。
=============================================================================
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

DEFAULT_API_BASE = os.environ.get("METAFUSION_API_URL", "http://127.0.0.1/api/v1")
DEFAULT_ADMIN_USER = os.environ.get("METAFUSION_ADMIN_USER", "admin")
DEFAULT_ADMIN_PASS = os.environ.get("METAFUSION_ADMIN_PASS", "AdminPassword2026!")


class MetaFusionApiClient:
    def __init__(self, base_url: str = DEFAULT_API_BASE):
        self.base_url = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.stats = {
            "purged_works": 0,
            "purged_artists": 0,
            "purged_franchises": 0,
            "artists_created": 0,
            "franchises_created": 0,
            "works_created": 0,
            "releases_created": 0,
            "mediums_created": 0,
            "tracks_created": 0,
            "work_relations_set": 0,
            "entity_relations_set": 0,
            "topics_created": 0,
        }
        self.artist_id_map: Dict[str, str] = {}
        self.franchise_id_map: Dict[str, str] = {}
        self.work_id_map: Dict[str, str] = {}
        self.release_id_map: Dict[str, str] = {}

    def _request(self, method: str, path: str, data: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        encoded_data = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} for {method} {url}: {err_body}")

    def login(self, username: str = DEFAULT_ADMIN_USER, password: str = DEFAULT_ADMIN_PASS) -> str:
        resp = self._request("POST", "/auth/login", {
            "email_or_username": username,
            "password": password
        })
        self.token = resp.get("token")
        if not self.token:
            raise RuntimeError("Login failed: token not found in response")
        user = resp.get("user", {})
        print(f"[AUTH] 登录成功: {user.get('display_name') or user.get('username')} (角色: {user.get('role')})")
        return self.token

    def purge_legacy_catalog(self):
        """清理历史库中的存量业务实体，确保所有新实体均通过标准 REST API 重新生成真实 UUID"""
        print("\n>>> [0/6] 正在清理旧版测试数据与假占位实体...")
        
        # 1. 清理 Works
        try:
            works_resp = self._request("GET", "/admin/works?page_size=2000")
            items = works_resp.get("items", [])
            for w in items:
                wid = w["id"]
                try:
                    self._request("DELETE", f"/admin/works/{wid}")
                    self.stats["purged_works"] += 1
                except Exception as ex:
                    print(f"  - 删除作品 {wid} 失败: {ex}")
            print(f"  [OK] 已清理作品实体: {self.stats['purged_works']} 个")
        except Exception as e:
            print(f"  ! 获取作品列表失败: {e}")

        # 2. 清理 Franchises
        try:
            fr_resp = self._request("GET", "/catalog/franchises?page_size=2000")
            items = fr_resp.get("items", [])
            for f in items:
                fid = f["id"]
                try:
                    self._request("DELETE", f"/admin/franchises/{fid}")
                    self.stats["purged_franchises"] += 1
                except Exception as ex:
                    print(f"  - 删除企划 {fid} 失败: {ex}")
            print(f"  [OK] 已清理企划实体: {self.stats['purged_franchises']} 个")
        except Exception as e:
            print(f"  ! 获取企划列表失败: {e}")

        # 3. 清理 Artists
        try:
            artists_resp = self._request("GET", "/admin/artists?page_size=2000")
            items = artists_resp.get("items", [])
            for a in items:
                aid = a["id"]
                try:
                    self._request("DELETE", f"/admin/artists/{aid}")
                    self.stats["purged_artists"] += 1
                except Exception as ex:
                    print(f"  - 删除创作者/机构 {aid} 失败: {ex}")
            print(f"  [OK] 已清理创作者/机构实体: {self.stats['purged_artists']} 个")
        except Exception as e:
            print(f"  ! 获取创作者列表失败: {e}")

    def create_artist(self, key: str, data: dict) -> str:
        """通过 POST /catalog/artists 创建创作者/机构主体，由后端分配 UUID"""
        payload = {
            "name": data.get("name"),
            "original_name": data.get("original_name", ""),
            "disambiguation": data.get("disambiguation", ""),
            "entity_type": data.get("entity_type", "person"),
            "country": data.get("country", ""),
            "biography": data.get("biography", ""),
            "language": data.get("language", "zh-CN"),
            "external_ids": data.get("external_ids", {}),
            "translations": data.get("translations", [])
        }
        res = self._request("POST", "/catalog/artists", payload)
        aid = res.get("id")
        if not aid:
            raise RuntimeError(f"Failed to create artist {data.get('name')}: no id returned")
        self.artist_id_map[key] = aid
        self.stats["artists_created"] += 1
        return aid

    def create_franchise(self, key: str, data: dict) -> str:
        """通过 POST /catalog/franchises 创建企划/世界观枢纽，由后端分配 UUID"""
        payload = {
            "title": data.get("title"),
            "original_title": data.get("original_title", ""),
            "aliases": data.get("aliases", []),
            "disambiguation": data.get("disambiguation", ""),
            "summary": data.get("summary", ""),
            "cover_image_url": data.get("cover_image_url", ""),
            "begin_date": data.get("begin_date", ""),
            "end_date": data.get("end_date", ""),
            "ended": data.get("ended", False),
            "country": data.get("country", ""),
            "language": data.get("language", "zh-CN"),
            "external_ids": data.get("external_ids", {}),
            "tags": data.get("tags", []),
            "translations": data.get("translations", [])
        }
        res = self._request("POST", "/catalog/franchises", payload)
        fid = res.get("id")
        if not fid:
            raise RuntimeError(f"Failed to create franchise {data.get('title')}: no id returned")
        self.franchise_id_map[key] = fid
        self.stats["franchises_created"] += 1
        return fid

    def create_work(self, key: str, data: dict) -> str:
        """通过 POST /catalog/works 创建纯净逻辑作品，由后端分配 UUID"""
        payload = {
            "title": data.get("title"),
            "original_title": data.get("original_title", ""),
            "aliases": data.get("aliases", []),
            "release_date": data.get("release_date"),
            "country": data.get("country", ""),
            "language": data.get("language", "zh-CN"),
            "original_language": data.get("original_language", "zh-CN"),
            "summary": data.get("summary", ""),
            "cover_image_url": data.get("cover_image_url", ""),
            "cover_aspect": data.get("cover_aspect", "2:3"),
            "content_rating": data.get("content_rating", "general"),
            "tags": data.get("tags", []),
            "catalog_metadata": data.get("catalog_metadata", {}),
            "translations": data.get("translations", [])
        }
        res = self._request("POST", "/catalog/works", payload)
        wid = res.get("id")
        if not wid:
            raise RuntimeError(f"Failed to create work {data.get('title')}: no id returned")
        self.work_id_map[key] = wid
        self.stats["works_created"] += 1
        return wid

    def create_release(self, key: str, work_key: str, data: dict) -> str:
        """通过 POST /catalog/releases 创建具体发行版/载体规格，由后端分配 UUID"""
        work_id = self.work_id_map.get(work_key)
        if not work_id:
            raise RuntimeError(f"Work key '{work_key}' not found in registered works")

        pub_artist_key = data.get("publisher_artist_key")
        publisher_id = self.artist_id_map.get(pub_artist_key) if pub_artist_key else None

        payload = {
            "work_id": work_id,
            "publisher_id": publisher_id,
            "edition_name": data.get("edition_name"),
            "catalog_number": data.get("catalog_number", ""),
            "barcode": data.get("barcode", ""),
            "publisher": data.get("publisher", ""),
            "packaging": data.get("packaging", "Standard"),
            "edition_date": data.get("edition_date"),
            "country": data.get("country", "CHN"),
            "language": data.get("language", "zh-CN"),
            "distribution_channel": data.get("distribution_channel", "official"),
            "catalog_metadata": data.get("catalog_metadata", {}),
            "notes": data.get("notes", "")
        }
        res = self._request("POST", "/catalog/releases", payload)
        rid = res.get("id")
        if not rid:
            raise RuntimeError(f"Failed to create release {data.get('edition_name')}: no id returned")
        self.release_id_map[key] = rid
        self.stats["releases_created"] += 1

        # 若包含 Medium / Tracks，依次创建
        for m in data.get("mediums", []):
            med_payload = {
                "release_id": rid,
                "position": m.get("position", 1),
                "name": m.get("name", "Disc 1"),
                "format": m.get("format", "CD"),
                "media_category": m.get("media_category", "music")
            }
            med_res = self._request("POST", "/catalog/mediums", med_payload)
            mid = med_res.get("id")
            self.stats["mediums_created"] += 1

            for t in m.get("tracks", []):
                trk_payload = {
                    "medium_id": mid,
                    "position": t.get("position", 1),
                    "title": t.get("title", ""),
                    "duration_seconds": t.get("duration_seconds", 0),
                    "isrc": t.get("isrc", ""),
                    "artist_credit": t.get("artist_credit", "")
                }
                if t.get("work_key"):
                    twid = self.work_id_map.get(t["work_key"])
                    if twid:
                        trk_payload["work_id"] = twid
                self._request("POST", "/catalog/tracks", trk_payload)
                self.stats["tracks_created"] += 1

        return rid

    def set_work_relations(self, work_key: str, relations: List[dict]):
        """通过 PUT /catalog/works/:id/relations 设置演职人员关联"""
        work_id = self.work_id_map.get(work_key)
        if not work_id:
            raise RuntimeError(f"Work key '{work_key}' not found for relations")

        mapped_relations = []
        for r in relations:
            artist_key = r.get("artist_key")
            aid = self.artist_id_map.get(artist_key)
            if not aid:
                print(f"  ! Warning: Artist key '{artist_key}' not found, skipping relation {r.get('role')}")
                continue
            mapped_relations.append({
                "artist_id": aid,
                "role": r.get("role")
            })

        if mapped_relations:
            self._request("PUT", f"/catalog/works/{work_id}/relations", {"relations": mapped_relations})
            self.stats["work_relations_set"] += len(mapped_relations)

    def set_entity_relations(self, relations: List[dict]):
        """通过 PUT /catalog/entity-relations 设置跨实体/跨媒介图谱语义边"""
        mapped = []
        for r in relations:
            stype = r.get("source_type")
            skey = r.get("source_key")
            ttype = r.get("target_type")
            tkey = r.get("target_key")

            sid = self.work_id_map.get(skey) if stype == "work" else (
                self.artist_id_map.get(skey) if stype == "artist" else self.franchise_id_map.get(skey)
            )
            tid = self.work_id_map.get(tkey) if ttype == "work" else (
                self.artist_id_map.get(tkey) if ttype == "artist" else self.franchise_id_map.get(tkey)
            )

            if not sid or not tid:
                print(f"  ! Warning: Relation edge {stype}:{skey} -> {ttype}:{tkey} missing ID, skipping")
                continue

            mapped.append({
                "source_type": stype,
                "source_id": sid,
                "target_type": ttype,
                "target_id": tid,
                "relationship_type": r.get("relationship_type"),
                "qualifier": r.get("qualifier", ""),
                "begin_date": r.get("begin_date", ""),
                "end_date": r.get("end_date", ""),
                "ended": r.get("ended", False),
                "attributes": r.get("attributes", {})
            })

        if mapped:
            self._request("PUT", "/catalog/entity-relations", {"relations": mapped})
            self.stats["entity_relations_set"] += len(mapped)

    def create_topic(self, data: dict) -> str:
        """通过 POST /community/topics 发起社区讨论与考据评注帖子"""
        work_key = data.get("work_key")
        work_id = self.work_id_map.get(work_key) if work_key else None

        payload = {
            "board_code": data.get("board_code", "casual"),
            "title": data.get("title"),
            "content": data.get("content"),
            "work_id": work_id,
            "language": data.get("language", "zh-CN"),
            "tag_names": data.get("tags", [])
        }
        res = self._request("POST", "/community/topics", payload)
        tid = res.get("id")
        self.stats["topics_created"] += 1
        return tid


# =============================================================================
# 编目数据集定义 (全面遵循 LRM 标准与官方高保真元数据)
# =============================================================================

SEED_DATA = {
    # -------------------------------------------------------------------------
    # 1. 创作者、制作团队与出版/唱片厂牌机构
    # -------------------------------------------------------------------------
    "artists": [
        # --- 网络文学与通俗文学宗师 ---
        {
            "key": "cuttlefish",
            "name": "爱潜水的乌贼",
            "original_name": "袁野",
            "disambiguation": "阅文集团白金作家 / 诡秘之主、宿命之环作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "阅文集团白金作家，中国作协全委会委员。以严谨精密的西幻与克苏鲁世界观、群像塑造著称，代表作《诡秘之主》《宿命之环》《一世之尊》《奥术神座》《灭运图录》。",
            "language": "zh-CN",
            "external_ids": {"qidian": "3154817"},
            "translations": [{"locale": "en-US", "name": "Cuttlefish That Loves Diving", "biography": "Platinum web novelist known for Lord of the Mysteries."}]
        },
        {
            "key": "butterfly_blue",
            "name": "蝴蝶蓝",
            "original_name": "王冬",
            "disambiguation": "阅文集团白金作家 / 全职高手作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "中国网络文学电竞网游与群像喜剧宗师，代表作《全职高手》《独闯天涯》《网游之近战法师》《天醒之路》。",
            "language": "zh-CN",
            "external_ids": {"qidian": "1224217"},
            "translations": [{"locale": "en-US", "name": "Butterfly Blue", "biography": "Celebrated author of The King's Avatar."}]
        },
        {
            "key": "huwei",
            "name": "狐尾的笔",
            "original_name": "狐尾的笔",
            "disambiguation": "中式民俗克苏鲁修仙代表作家 / 道诡异仙作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "以惊艳的中式民俗恐怖与克苏鲁修仙风格风靡全网，代表作《道诡异仙》《诡秘地海》《玄鉴仙族（书评推荐人）》。",
            "language": "zh-CN",
            "external_ids": {"qidian": "402927231"},
            "translations": [{"locale": "en-US", "name": "Huwei De Bi", "biography": "Author of Dao of the Bizarre Immortal."}]
        },
        {
            "key": "liu_cixin",
            "name": "刘慈欣",
            "original_name": "Liu Cixin",
            "disambiguation": "中国科幻领军人物 / 雨果奖得主",
            "entity_type": "person",
            "country": "中国",
            "biography": "首位获得雨果奖最佳长篇小说奖的亚洲作家，代表作《三体》三部曲、《流浪地球》《球状闪电》《乡村教师》《超新星纪元》。",
            "language": "zh-CN",
            "external_ids": {"wikidata": "Q463422"},
            "translations": [{"locale": "en-US", "name": "Liu Cixin", "biography": "Asia's first Hugo Award winner for The Three-Body Problem."}]
        },
        {
            "key": "mao_ni",
            "name": "猫腻",
            "original_name": "张晓舟",
            "disambiguation": "网络文学宗师 / 庆余年、间客、将夜作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "文风细腻深刻，充满人文关怀与权谋哲思，代表作《庆余年》《间客》《将夜》《择天记》《大道朝天》。",
            "language": "zh-CN",
            "external_ids": {"qidian": "1200000"},
            "translations": [{"locale": "en-US", "name": "Mao Ni", "biography": "Author of Joy of Life, Nightfall, and Way of Choices."}]
        },
        {
            "key": "wang_yu",
            "name": "忘语",
            "original_name": "丁凌涛",
            "disambiguation": "凡人修仙流开山鼻祖",
            "entity_type": "person",
            "country": "中国",
            "biography": "开创网络文学'凡人修仙流'，代表作《凡人修仙传》《凡人修仙之仙界篇》《魔天记》《大梦主》。",
            "language": "zh-CN",
            "external_ids": {"qidian": "1000001"},
            "translations": [{"locale": "en-US", "name": "Wang Yu", "biography": "Creator of Mortal Cultivation genre, author of A Record of a Mortal's Journey to Immortality."}]
        },
        {
            "key": "fenghuo",
            "name": "烽火戏诸侯",
            "original_name": "陈政",
            "disambiguation": "网络文学白金作家 / 雪中悍刀行、剑来作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "文笔卓绝、武侠与仙侠气度浑厚，代表作《雪中悍刀行》《剑来》《陈二狗的妖孽人生》《极品公子》。",
            "language": "zh-CN",
            "external_ids": {"zongheng": "10000"},
            "translations": [{"locale": "en-US", "name": "Fenghuo Xi Zhuhou", "biography": "Author of The Snowy Path of the Heroic Blade and Jian Lai."}]
        },
        {
            "key": "asimov",
            "name": "艾萨克·阿西莫夫",
            "original_name": "Isaac Asimov",
            "disambiguation": "科幻三巨头之一 / 基地与机器人系列作者",
            "entity_type": "person",
            "country": "美国",
            "biography": "世界著名科普作家与科幻大师，创立机器人三大法则与心理史学，代表作《基地》系列、《银河帝国》系列、《机器人》系列、《永恒的终结》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q34981"},
            "translations": [{"locale": "en-US", "name": "Isaac Asimov", "biography": "Grand Master of Sci-Fi, author of Foundation and Robot series."}]
        },
        {
            "key": "frank_herbert",
            "name": "弗兰克·赫伯特",
            "original_name": "Frank Herbert",
            "disambiguation": "沙丘之父 / 科幻史诗宗师",
            "entity_type": "person",
            "country": "美国",
            "biography": "代表作《沙丘》六部曲，融合生态学、宗教、政治与人类演化，斩获雨果奖与星云奖双奖。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q188981"},
            "translations": [{"locale": "en-US", "name": "Frank Herbert", "biography": "Author of the landmark sci-fi epic Dune series."}]
        },
        {
            "key": "garcia_marquez",
            "name": "加夫列尔·加西亚·马尔克斯",
            "original_name": "Gabriel García Márquez",
            "disambiguation": "诺贝尔文学奖得主 / 魔幻现实主义大师",
            "entity_type": "person",
            "country": "哥伦比亚",
            "biography": "拉丁美洲魔幻现实主义文学代表人物，1982年诺贝尔文学奖得主，代表作《百年孤独》《霍乱时期的爱情》《族长的秋天》。",
            "language": "es",
            "external_ids": {"wikidata": "Q5878"},
            "translations": [{"locale": "en-US", "name": "Gabriel García Márquez", "biography": "Nobel laureate and author of One Hundred Years of Solitude."}]
        },
        {
            "key": "philip_k_dick",
            "name": "菲利普·K·迪克",
            "original_name": "Philip K. Dick",
            "disambiguation": "赛博朋克先驱 / 仿生人会梦见电子羊吗作者",
            "entity_type": "person",
            "country": "美国",
            "biography": "探讨真实与虚幻、人性与机器的科幻先驱，代表作《仿生人会梦见电子羊吗？》《高堡奇人》《少数派报告》《尤比克》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q171091"},
            "translations": [{"locale": "en-US", "name": "Philip K. Dick", "biography": "Visionary sci-fi master behind Blade Runner and Ubik."}]
        },

        # --- 日本轻小说与漫画名家 ---
        {
            "key": "kawahara",
            "name": "川原砾",
            "original_name": "川原 礫",
            "disambiguation": "《刀剑神域》《加速世界》轻小说原作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名轻小说作家，第15届电击小说大奖大奖得主，代表作《刀剑神域》《加速世界》《绝对绝望孤岛》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q553043"},
            "translations": [{"locale": "en-US", "name": "Reki Kawahara", "biography": "Author of Sword Art Online and Accel World."}]
        },
        {
            "key": "yamada_kanehito",
            "name": "山田钟人",
            "original_name": "山田 鐘人",
            "disambiguation": "《葬送的芙莉莲》漫画原作故事编剧",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本漫画原作者，代表作《葬送的芙莉莲》《孤零零的勇者》。",
            "language": "ja",
            "translations": [{"locale": "en-US", "name": "Kanehito Yamada", "biography": "Story author of Frieren: Beyond Journey's End."}]
        },
        {
            "key": "abe_tsukasa",
            "name": "阿部司",
            "original_name": "アベ ツカサ",
            "disambiguation": "《葬送的芙莉莲》漫画作画",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本女性漫画家、插画家，代表作《葬送的芙莉莲》作画。",
            "language": "ja",
            "translations": [{"locale": "en-US", "name": "Tsukasa Abe", "biography": "Illustrator and artist of Frieren: Beyond Journey's End."}]
        },
        {
            "key": "fujimoto_tatsuki",
            "name": "藤本树",
            "original_name": "藤本 タツキ",
            "disambiguation": "《电锯人》《炎拳》《蓦然回首》漫画家",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本新生代鬼才漫画家，作品以强烈的电影感、荒诞叙事与情感冲击力著称，代表作《电锯人》《炎拳》《蓦然回首》《再见绘梨》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q59656828"},
            "translations": [{"locale": "en-US", "name": "Tatsuki Fujimoto", "biography": "Manga artist of Chainsaw Man, Fire Punch, and Look Back."}]
        },
        {
            "key": "isayama_hajime",
            "name": "谏山创",
            "original_name": "諫山 創",
            "disambiguation": "《进击的巨人》漫画作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名漫画家，代表作《进击的巨人》，以宏大的反乌托邦史诗、精密的伏笔与人性反思风靡全球。",
            "language": "ja",
            "external_ids": {"wikidata": "Q3813959"},
            "translations": [{"locale": "en-US", "name": "Hajime Isayama", "biography": "Creator of Attack on Titan."}]
        },
        {
            "key": "inoue_takehiko",
            "name": "井上雄彦",
            "original_name": "井上 雄彦",
            "disambiguation": "《灌篮高手》《浪客行》漫画宗师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本国宝级漫画家，代表作《灌篮高手》《浪客行》《REAL》，兼任动画电影《THE FIRST SLAM DUNK》导演与编剧。",
            "language": "ja",
            "external_ids": {"wikidata": "Q352994"},
            "translations": [{"locale": "en-US", "name": "Takehiko Inoue", "biography": "Master mangaka of Slam Dunk, Vagabond, and REAL."}]
        },
        {
            "key": "mi_er",
            "name": "米二",
            "original_name": "米二",
            "disambiguation": "《一人之下》漫画原作者",
            "entity_type": "person",
            "country": "中国",
            "biography": "中国知名漫画家，融合道家哲学、异人世界观与中式武侠，代表作《一人之下》《九九八十一》。",
            "language": "zh-CN",
            "translations": [{"locale": "en-US", "name": "Mi Er", "biography": "Creator and artist of Under One Person (The Outcast)."}]
        },
        {
            "key": "xu_xianzhe",
            "name": "许先哲",
            "original_name": "许先哲",
            "disambiguation": "《镖人》硬核历史武侠漫画家",
            "entity_type": "person",
            "country": "中国",
            "biography": "中国硬核武侠漫画家，以考究的隋唐历史背景与精湛的分镜打斗享誉海内外，代表作《镖人》。",
            "language": "zh-CN",
            "translations": [{"locale": "en-US", "name": "Xu Xianzhe", "biography": "Creator of historical wuxia masterpiece Blades of the Guardians (Biao Ren)."}]
        },

        # --- 影视导演与动画监督 ---
        {
            "key": "miyazaki_hayao",
            "name": "宫崎骏",
            "original_name": "宮﨑 駿",
            "disambiguation": "吉卜力工作室联合创始人 / 动画电影巨匠",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名动画导演、编剧、漫画家，两度荣获奥斯卡最佳动画长片奖及奥斯卡终身成就奖，代表作《千与千寻》《哈尔的移动城堡》《幽灵公主》《风之谷》《你想活出怎样的人生》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q55400"},
            "translations": [{"locale": "en-US", "name": "Hayao Miyazaki", "biography": "Co-founder of Studio Ghibli, Academy Award-winning animation director."}]
        },
        {
            "key": "anno_hideaki",
            "name": "庵野秀明",
            "original_name": "庵野 秀明",
            "disambiguation": "EVA 新世纪福音战士总导演 / Khara 创始人",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名动画导演、电影导演，代表作《新世纪福音战士》（TV及新剧场版四部曲）、《新·哥斯拉》《新·奥特曼》《飞跃巅峰》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q285403"},
            "translations": [{"locale": "en-US", "name": "Hideaki Anno", "biography": "Director of Neon Genesis Evangelion and founder of Studio Khara."}]
        },
        {
            "key": "oshii_mamoru",
            "name": "押井守",
            "original_name": "押井 守",
            "disambiguation": "《攻壳机动队》剧场版导演 / 哲学科幻影像大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名电影与动画导演，以极具哲学思辨的赛博朋克影像著称，代表作《攻壳机动队》《攻壳机动队2：无罪》《机动警察》剧场版、《人狼》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q352086"},
            "translations": [{"locale": "en-US", "name": "Mamoru Oshii", "biography": "Director of Ghost in the Shell and visionary filmmaker."}]
        },
        {
            "key": "nolan",
            "name": "克里斯托弗·诺兰",
            "original_name": "Christopher Nolan",
            "disambiguation": "奥斯卡最佳导演 / 星际穿越、奥本海默导演",
            "entity_type": "person",
            "country": "英国",
            "biography": "世界顶尖电影导演、编剧与制片人，以非线性叙事与胶片实拍著称，代表作《星际穿越》《奥本海默》《盗梦空间》《黑暗骑士》三部曲、《敦刻尔克》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q25142"},
            "translations": [{"locale": "en-US", "name": "Christopher Nolan", "biography": "Academy Award-winning director of Interstellar and Oppenheimer."}]
        },
        {
            "key": "guo_fan",
            "name": "郭帆",
            "original_name": "郭帆",
            "disambiguation": "《流浪地球》系列电影导演",
            "entity_type": "person",
            "country": "中国",
            "biography": "中国当代重工业科幻电影领军导演，代表作《流浪地球》《流浪地球 2》《金刚川》。",
            "language": "zh-CN",
            "external_ids": {"wikidata": "Q61654942"},
            "translations": [{"locale": "en-US", "name": "Frant Gwo", "biography": "Director of The Wandering Earth film franchise."}]
        },

        # --- 音乐作曲家与乐队 ---
        {
            "key": "hisaishi_joe",
            "name": "久石让",
            "original_name": "久石 譲",
            "disambiguation": "吉卜力工作室首席配乐大师 / 日本著名作曲家",
            "entity_type": "person",
            "country": "日本",
            "biography": "享誉全球的日本作曲家、指挥家与钢琴家，八度荣获日本电影学院奖最佳音乐奖，代表作《千与千寻》《天空之城》《龙猫》《菊次郎的夏天》《让子弹飞》原声音乐。",
            "language": "ja",
            "external_ids": {"wikidata": "Q275900"},
            "translations": [{"locale": "en-US", "name": "Joe Hisaishi", "biography": "World-renowned composer behind Studio Ghibli masterpieces."}]
        },
        {
            "key": "kajiura_yuki",
            "name": "梶浦由记",
            "original_name": "梶浦 由記",
            "disambiguation": "《刀剑神域》《Fate/Zero》《鬼灭之刃》配乐大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名作曲家、音乐制作人，以独特的'梶浦语'与壮丽的多声部和声著称，代表作《刀剑神域》《Fate/Zero》《魔法少女小圆》《鬼灭之刃》《空之境界》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q234443"},
            "translations": [{"locale": "en-US", "name": "Yuki Kajiura", "biography": "Celebrated composer of Sword Art Online, Fate/Zero, and Madoka Magica."}]
        },
        {
            "key": "sawano_hiroyuki",
            "name": "泽野弘之",
            "original_name": "澤野 弘之",
            "disambiguation": "《进击的巨人》《机动战士高达UC》配乐大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名作曲家与编曲家，以恢弘磅礴的交响人声与电子摇滚'泽野之声'闻名，代表作《进击的巨人》《机动战士高达UC》《罪恶王冠》《KILL la KILL》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q1341144"},
            "translations": [{"locale": "en-US", "name": "Hiroyuki Sawano", "biography": "Master composer of Attack on Titan and Mobile Suit Gundam UC."}]
        },
        {
            "key": "hans_zimmer",
            "name": "汉斯·季默",
            "original_name": "Hans Zimmer",
            "disambiguation": "奥斯卡配乐大师 / 星际穿越、沙丘、狮子王作曲",
            "entity_type": "person",
            "country": "德国",
            "biography": "当代好莱坞传奇配乐巨匠，两度荣获奥斯卡最佳原创配乐奖，代表作《星际穿越》《沙丘》《狮子王》《盗梦空间》《角斗士》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q76364"},
            "translations": [{"locale": "en-US", "name": "Hans Zimmer", "biography": "Legendary Hollywood composer of Interstellar, Dune, and Inception."}]
        },
        {
            "key": "kessoku_band",
            "name": "结束乐队",
            "original_name": "結束バンド",
            "disambiguation": "《孤独摇滚！》剧内女子摇滚乐队（青山吉能/铃代纱弓/水野朔/长谷川育美）",
            "entity_type": "group",
            "country": "日本",
            "biography": "TV动画《孤独摇滚！》中由后藤一里、伊地知虹夏、山田凉、喜多郁代组成的女子高中生四人摇滚乐队，实体专辑斩获日本公信榜榜首及 Billboard Japan 年间下载榜冠军。",
            "language": "ja",
            "external_ids": {"musicbrainz": "3e0a5471-46af-4c01-bb2e-11b24c1b55fe"},
            "translations": [{"locale": "en-US", "name": "Kessoku Band", "biography": "Pop-rock band from Bocchi the Rock! starring Hitori Gotoh and bandmates."}]
        },
        {
            "key": "evan_call",
            "name": "Evan Call",
            "original_name": "エヴァン・コール",
            "disambiguation": "《紫罗兰永恒花园》《葬送的芙莉莲》配乐大师",
            "entity_type": "person",
            "country": "美国",
            "biography": "常驻日本的美国作曲家，伯克利音乐学院出身，擅长唯美古典管弦乐配器，代表作《紫罗兰永恒花园》《葬送的芙莉莲》《战姬绝唱》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q24874406"},
            "translations": [{"locale": "en-US", "name": "Evan Call", "biography": "Composer of Violet Evergarden and Frieren: Beyond Journey's End."}]
        },

        # --- 核心出版机构、制作公司与唱片厂牌 ---
        {
            "key": "china_literature",
            "name": "阅文集团",
            "original_name": "China Literature Limited",
            "disambiguation": "中国网络文学出版与IP孵化龙头",
            "entity_type": "publisher",
            "country": "中国",
            "biography": "旗下拥有起点中文网、QQ阅读等旗舰平台，聚合海量中国顶级数字文学IP。",
            "language": "zh-CN",
            "translations": [{"locale": "en-US", "name": "China Literature", "biography": "Leading online literature publisher and IP incubator in China."}]
        },
        {
            "key": "new_star_press",
            "name": "新星出版社",
            "original_name": "New Star Press",
            "disambiguation": "中国知名综合性出版社 / 午夜文库与科幻经典出版方",
            "entity_type": "publisher",
            "country": "中国",
            "biography": "外文出版发行事业局直属骨干出版社，出版《宿命之环》《银河系漫游指南》《阿加莎·克里斯蒂作品集》等优秀图书。",
            "language": "zh-CN"
        },
        {
            "key": "chongqing_press",
            "name": "重庆出版社",
            "original_name": "Chongqing Publishing House",
            "disambiguation": "《三体》三部曲首发出版机构",
            "entity_type": "publisher",
            "country": "中国",
            "biography": "中国知名大型综合出版社，策划出版刘慈欣《三体》系列、阿西莫夫《基地》系列等科幻巨著。",
            "language": "zh-CN"
        },
        {
            "key": "thinkingdom",
            "name": "新经典文化",
            "original_name": "Thinkingdom Media Group",
            "disambiguation": "中国民营图书策划与出版龙头",
            "entity_type": "publisher",
            "country": "中国",
            "biography": "引进出版马尔克斯《百年孤独》、菲利普·K·迪克《仿生人会梦见电子羊吗？》、东野圭吾系列名著。",
            "language": "zh-CN"
        },
        {
            "key": "kadokawa",
            "name": "角川集团",
            "original_name": "株式会社KADOKAWA",
            "disambiguation": "日本大型综合出版与泛娱乐集团 / 电击文库母公司",
            "entity_type": "publisher",
            "country": "日本",
            "biography": "旗下拥有电击文库、角川Sneaker文库、MF文库J、Fami通等核心ACG出版品牌。",
            "language": "ja",
            "translations": [{"locale": "en-US", "name": "KADOKAWA", "biography": "Major Japanese publisher behind Dengeki Bunko and Sneaker Bunko."}]
        },
        {
            "key": "ghibli",
            "name": "吉卜力工作室",
            "original_name": "株式会社スタジオジブリ",
            "disambiguation": "日本殿堂级动画工作室（宫崎骏/高畑勋创立）",
            "entity_type": "studio",
            "country": "日本",
            "biography": "由宫崎骏、高畑勋、铃木敏夫于1985年创立的日本殿堂级动画电影工作室。",
            "language": "ja",
            "translations": [{"locale": "en-US", "name": "Studio Ghibli", "biography": "Legendary Japanese animation film studio founded by Hayao Miyazaki and Isao Takahata."}]
        },
        {
            "key": "kyoto_animation",
            "name": "京都动画",
            "original_name": "株式会社京都アニメーション",
            "disambiguation": "京阿尼 / 紫罗兰永恒花园、凉宫春日制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "日本知名动画制作公司，以极致细腻的作画质量与情感刻画享誉世界，代表作《紫罗兰永恒花园》《凉宫春日的忧郁》《CLANNAD》《声之形》《吹响吧！上低音号》。",
            "language": "ja",
            "translations": [{"locale": "en-US", "name": "Kyoto Animation", "biography": "Acclaimed animation studio behind Violet Evergarden and Sound! Euphonium."}]
        },
        {
            "key": "aniplex",
            "name": "Aniplex",
            "original_name": "株式会社アニプレックス",
            "disambiguation": "索尼音乐旗下核心动画企划与发行商",
            "entity_type": "label",
            "country": "日本",
            "biography": "Sony Music Entertainment Japan 旗下动画企划与音乐发行巨头，负责《刀剑神域》《鬼灭之刃》《孤独摇滚！》《Fate》等大作企划。",
            "language": "ja"
        },
        {
            "key": "sony_music",
            "name": "日本索尼音乐娱乐",
            "original_name": "株式会社ソニー・ミュージックエンタテインメント",
            "disambiguation": "全球顶级音乐唱片与娱乐集团",
            "entity_type": "label",
            "country": "日本",
            "biography": "全球领先的唱片音乐与数字音频发行机构。",
            "language": "ja"
        }
    ],

    # -------------------------------------------------------------------------
    # 2. 跨媒介企划枢纽 (Franchises)
    # -------------------------------------------------------------------------
    "franchises": [
        {
            "key": "fr_lotm",
            "title": "诡秘之主世界观",
            "original_title": "Lord of the Mysteries Universe",
            "aliases": ["诡秘世界", "LOTM"],
            "disambiguation": "爱潜水的乌贼西幻克苏鲁神话宇宙",
            "summary": "由二十二条神之途径、源质、旧日与蒸汽工业维多利亚时代构筑的宏大西幻神话世界观，涵盖《诡秘之主》《宿命之环》及官方概念原声大碟。",
            "country": "中国",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
            "begin_date": "2018-04-01",
            "tags": ["奇幻", "克苏鲁", "蒸汽朋克", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "Lord of the Mysteries Universe", "summary": "The grand cosmic fantasy universe created by Cuttlefish That Loves Diving."}]
        },
        {
            "key": "fr_threebody",
            "title": "三体宇宙",
            "original_title": "The Three-Body Problem Universe",
            "aliases": ["地球往事三部曲", "Three-Body"],
            "disambiguation": "刘慈欣硬科幻宏大宇宙企划",
            "summary": "以三体文明与地球文明跨越数百年的生死博弈为核心的硬核科幻史诗，涵盖小说三部曲、广播剧、影视及原声音乐。",
            "country": "中国",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg",
            "begin_date": "2006-05",
            "tags": ["科幻", "硬科幻", "三体", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "The Three-Body Universe", "summary": "Epic sci-fi franchise based on Liu Cixin's Hugo Award-winning trilogy."}]
        },
        {
            "key": "fr_sao",
            "title": "刀剑神域",
            "original_title": "ソードアート・オンライン",
            "aliases": ["Sword Art Online", "SAO"],
            "disambiguation": "川原砾跨媒介虚拟现实科幻企划",
            "summary": "以完全潜行虚拟现实技术（FullDive）为背景的冒险企划，涵盖轻小说原作、TV动画、剧场版长片及衍生音乐原声。",
            "country": "日本",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg",
            "begin_date": "2009-04-10",
            "tags": ["轻小说", "动画", "科幻", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "Sword Art Online Franchise", "summary": "Cross-media sci-fi adventure franchise by Reki Kawahara."}]
        },
        {
            "key": "fr_frieren",
            "title": "葬送的芙莉莲",
            "original_title": "葬送のフリーレン",
            "aliases": ["Frieren: Beyond Journey's End"],
            "disambiguation": "山田钟人与阿部司后日谈奇幻企划",
            "summary": "讲述打倒魔王后的精灵魔法使芙莉莲在漫长岁月中追寻人类记忆的奇幻史诗，包含原作连载漫画、TV动画及原声交响。",
            "country": "日本",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg",
            "begin_date": "2020-04-28",
            "tags": ["漫画", "动画", "奇幻", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "Frieren Franchise", "summary": "Fantasy epic exploring the aftermath of a hero's journey."}]
        },
        {
            "key": "fr_bocchi",
            "title": "孤独摇滚！",
            "original_title": "ぼっち・ざ・ろっく！",
            "aliases": ["Bocchi the Rock!"],
            "disambiguation": "滨路晶芳文社青春摇滚跨媒介企划",
            "summary": "围绕社恐吉他手后藤一里与结束乐队的青春摇滚企划，包含原作漫画、爆款TV动画、剧场总集篇及实体公信榜冠军唱片。",
            "country": "日本",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg",
            "begin_date": "2017-12-19",
            "tags": ["漫画", "动画", "音乐", "摇滚乐", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "Bocchi the Rock! Franchise", "summary": "Popular youth band music franchise featuring Kessoku Band."}]
        },
        {
            "key": "fr_eva",
            "title": "新世纪福音战士",
            "original_title": "新世紀エヴァンゲリオン",
            "aliases": ["Neon Genesis Evangelion", "EVA"],
            "disambiguation": "庵野秀明机甲与心理学跨媒介史诗",
            "summary": "探讨人类补完计划、存在主义与心灵隔阂的里程碑式跨媒介企划，包含 TV 动画、旧剧场版、新剧场版四部曲及高解析原声母带。",
            "country": "日本",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg",
            "begin_date": "1995-10-04",
            "tags": ["动画", "科幻", "EVA", "跨媒介"],
            "translations": [{"locale": "en-US", "title": "Neon Genesis Evangelion Franchise", "summary": "Milestone psychological mecha anime franchise directed by Hideaki Anno."}]
        }
    ],

    # -------------------------------------------------------------------------
    # 3. 纯净逻辑作品 (Works: Novels, Books, Manga, Anime, Cinema, Music)
    # -------------------------------------------------------------------------
    "works": [
        # === 图书文献 / 网络文学 (Books & Literature) ===
        {
            "key": "work_lotm",
            "title": "诡秘之主",
            "original_title": "诡秘之主",
            "aliases": ["Lord of the Mysteries", "LOTM 1"],
            "release_date": "2018-04-01",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "起于维多利亚蒸汽朋克，沉入克苏鲁秘术神话。周明瑞穿越为克莱恩·莫雷蒂，在灰雾之上的神秘殿堂执掌愚者王座，探寻神灵途径与世界真相。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "奇幻", "克苏鲁", "蒸汽朋克", "网络文学"],
            "translations": [
                {"locale": "en-US", "title": "Lord of the Mysteries", "summary": "With the rising tide of steam power and machinery, who can come close to being a Beyonder? Shrouded in the fog of history and darkness, who is whispering?"}
            ]
        },
        {
            "key": "work_coi",
            "title": "宿命之环",
            "original_title": "宿命之环",
            "aliases": ["Circle of Inevitability", "LOTM 2"],
            "release_date": "2023-03-04",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "《诡秘之主》第二部。以因蒂斯共和国为舞台，少年卢米安·李在神秘梦境与宿命轮回中追寻真相与救赎，揭开外神与古老灾祸的帷幕。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d0/55/423661_Wz06Z.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "奇幻", "克苏鲁", "网络文学"],
            "translations": [
                {"locale": "en-US", "title": "Circle of Inevitability", "summary": "The second book in the Lord of the Mysteries series set in the Republic of Intis."}
            ]
        },
        {
            "key": "work_daogui",
            "title": "道诡异仙",
            "original_title": "道诡异仙",
            "aliases": ["Dao of the Bizarre Immortal"],
            "release_date": "2021-12-07",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "诡异莫测的修仙世界，李火旺分不清现代精神病院与残酷民俗修仙界究竟何为真实。在天道崩塌与克苏鲁民俗中苦苦挣扎求存。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ee/71/490347_5tFeU.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "仙侠", "修真", "克苏鲁", "网络文学"],
            "translations": [
                {"locale": "en-US", "title": "Dao of the Bizarre Immortal", "summary": "Li Huowang struggles between reality and delusion in a horrific folk-cultivation realm."}
            ]
        },
        {
            "key": "work_threebody",
            "title": "三体",
            "original_title": "三体",
            "aliases": ["The Three-Body Problem", "地球往事"],
            "release_date": "2006-05-01",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "文化大革命时期的绝密军方工程'红岸基地'向宇宙发射了人类第一声啼鸣。四光年外的三体文明接收到了信号，两个文明的命运自此不可逆转地交织。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/da/52/9585_ZhcrW.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "科幻", "硬科幻", "名著", "三体"],
            "translations": [
                {"locale": "en-US", "title": "The Three-Body Problem", "summary": "Set against the backdrop of China's Cultural Revolution, a secret military project sends signals into space, inviting an alien invasion."}
            ]
        },
        {
            "key": "work_quanzhi",
            "title": "全职高手",
            "original_title": "全职高手",
            "aliases": ["The King's Avatar"],
            "release_date": "2011-02-28",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "网游荣耀中被誉为教科书级别的顶尖高手叶修，因为种种原因遭到俱乐部的驱逐，离开职业圈的他被一家网吧收留，成为一名值夜班的网管。重返荣耀，再铸辉煌。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/f4/b0/84106_1UUKD.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "网络文学", "日常"],
            "translations": [
                {"locale": "en-US", "title": "The King's Avatar", "summary": "In the online game Glory, Ye Xiu is regarded as a textbook top-tier player who embarks on a journey back to the peak."}
            ]
        },
        {
            "key": "work_dune",
            "title": "沙丘",
            "original_title": "Dune",
            "aliases": ["沙丘六部曲"],
            "release_date": "1965-08-01",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "在荒凉严酷的厄拉科斯星球上，唯一的宝贵资源'美琅脂'香料维系着全银河帝国的星际航行与意识进化。少年保罗·厄崔迪在背叛与沙丘原住民信仰中成长为救世主。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/fc/b5/19748_0sC3J.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "科幻", "硬科幻", "名著"],
            "translations": [
                {"locale": "en-US", "title": "Dune", "summary": "Frank Herbert's masterwork set on the desert planet Arrakis."}
            ]
        },
        {
            "key": "work_hundred_years",
            "title": "百年孤独",
            "original_title": "Cien años de soledad",
            "aliases": ["One Hundred Years of Solitude"],
            "release_date": "1967-05-30",
            "country": "哥伦比亚",
            "language": "es",
            "original_language": "es",
            "summary": "布恩迪亚家族七代人在虚构城镇马孔多的传奇兴衰史，魔幻与现实交织，深刻展现了拉丁美洲近百年来的孤独与沧桑宿命。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/00/e2/538393_5JIm0.jpg",
            "cover_aspect": "3:4",
            "tags": ["图书", "小说", "文学", "名著"],
            "translations": [
                {"locale": "en-US", "title": "One Hundred Years of Solitude", "summary": "The multi-generational story of the Buendía family whose patriarch founds the town of Macondo."}
            ]
        },

        # === 连载漫画 (Comics & Manga) ===
        {
            "key": "work_frieren_manga",
            "title": "葬送的芙莉莲（漫画）",
            "original_title": "葬送のフリーレン",
            "aliases": ["Frieren Manga"],
            "release_date": "2020-04-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "山田钟人原作、阿部司作画。勇者辛美尔逝世后，寿命长达千年的精灵魔法使芙莉莲重新踏上前往灵魂长眠之地的旅程，在旅途中逐渐理解辛美尔与人类的心意。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/a1/bd/305429_axzF3.jpg",
            "cover_aspect": "3:4",
            "tags": ["漫画", "奇幻", "冒险", "治愈"],
            "translations": [
                {"locale": "en-US", "title": "Frieren: Beyond Journey's End (Manga)", "summary": "Manga series following the elven mage Frieren reflecting on past connections."}
            ]
        },
        {
            "key": "work_chainsaw_manga",
            "title": "电锯人",
            "original_title": "チェンソーマン",
            "aliases": ["Chainsaw Man"],
            "release_date": "2018-12-03",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "藤本树创作的暗黑奇幻少年漫画。背负巨额债务的少年电次与电锯恶魔波奇塔相依为命，在重生成为电锯人后加入公安对魔特异课，卷入人与恶魔的疯狂搏杀。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/b7/65/349615_s1u1b.jpg",
            "cover_aspect": "3:4",
            "tags": ["漫画", "奇幻", "热血", "动作"],
            "translations": [
                {"locale": "en-US", "title": "Chainsaw Man", "summary": "Dark fantasy manga series following Denji, a young man who merges with his pet devil Pochita."}
            ]
        },
        {
            "key": "work_under_one_person",
            "title": "一人之下",
            "original_title": "一人之下",
            "aliases": ["The Outcast", "异人之下"],
            "release_date": "2015-02-26",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "米二创作的现象级国漫。平凡大学生张楚岚因爷爷尸骨被盗卷入异人世界，结识不老不死的神秘少女冯宝宝，一同解开甲申之乱与炁体源流的惊天秘辛。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/81/5a/175459_RAH87.jpg",
            "cover_aspect": "3:4",
            "tags": ["漫画", "热血", "奇幻", "武侠", "动作"],
            "translations": [
                {"locale": "en-US", "title": "Under One Person (The Outcast)", "summary": "A popular Chinese comic combining Taoist philosophy and modern superpowered martial arts."}
            ]
        },
        {
            "key": "work_biao_ren",
            "title": "镖人",
            "original_title": "镖人",
            "aliases": ["Blades of the Guardians"],
            "release_date": "2015-07-01",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "许先哲创作的硬派历史武侠漫画。隋末大业三年，天下将乱，身手不凡的镖客刀马带着幼子小七行走西域大漠，接下一趟护送知世郎前往长安的凶险密镖。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/ba/f7/184725_C1uE8.jpg",
            "cover_aspect": "3:4",
            "tags": ["漫画", "武侠", "历史", "动作"],
            "translations": [
                {"locale": "en-US", "title": "Blades of the Guardians", "summary": "Acclaimed historical wuxia graphic novel set in the turbulent Sui Dynasty."}
            ]
        },

        # === 动画番剧与剧场版 (Anime Series & Movies) ===
        {
            "key": "work_sao_anime",
            "title": "刀剑神域 第一季",
            "original_title": "ソードアート・オンライン",
            "aliases": ["Sword Art Online Season 1", "SAO 1"],
            "release_date": "2012-07-07",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "A-1 Pictures 制作，伊藤智彦执导。一万名玩家被困于完全潜行 VRMMORPG 艾恩葛朗特，游戏中的死亡即意味着现实的终结。桐人与亚丝娜为了通关而战。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/94/a3/29550_tVp3B.jpg",
            "cover_aspect": "2:3",
            "tags": ["剧集", "动画", "科幻", "冒险", "动作"],
            "translations": [
                {"locale": "en-US", "title": "Sword Art Online (Season 1)", "summary": "Players trapped in a deadly virtual reality MMORPG must fight their way through 100 floors to escape."}
            ]
        },
        {
            "key": "work_bocchi_anime",
            "title": "孤独摇滚！",
            "original_title": "ぼっち・ざ・ろっく！",
            "aliases": ["Bocchi the Rock! TV"],
            "release_date": "2022-10-08",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "CloverWorks 制作，斋藤圭一郎执导。极度社恐却拥有精湛吉他技艺的'吉他英雄'后藤一里，在下北泽 LIVEHOUSE 结识伙伴组建'结束乐队'，用摇滚乐治愈青春。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/11/ad/328609_GjBsb.jpg",
            "cover_aspect": "2:3",
            "tags": ["剧集", "动画", "日常", "喜剧", "摇滚乐"],
            "translations": [
                {"locale": "en-US", "title": "Bocchi the Rock!", "summary": "Hitori Gotoh, an introverted high school girl who plays the guitar, joins Kessoku Band."}
            ]
        },
        {
            "key": "work_violet_anime",
            "title": "紫罗兰永恒花园",
            "original_title": "ヴァイオレット・エヴァーガーデン",
            "aliases": ["Violet Evergarden"],
            "release_date": "2018-01-10",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "京都动画倾力打造，石立太一执导。曾经作为战争兵器的自动手记人偶薇尔莉特·伊芙加登，在为人们代笔信件的旅途中，逐渐领悟少佐留下的'我爱你'的真正含义。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/1e/e2/183878_Fef1o.jpg",
            "cover_aspect": "2:3",
            "tags": ["剧集", "动画", "治愈", "催泪", "文学"],
            "translations": [
                {"locale": "en-US", "title": "Violet Evergarden", "summary": "A former soldier girl works as an Auto Memory Doll to understand the meaning of 'I love you'."}
            ]
        },
        {
            "key": "work_eva_tv",
            "title": "新世纪福音战士",
            "original_title": "新世紀エヴァンゲリオン",
            "aliases": ["Neon Genesis Evangelion TV", "EVA TV"],
            "release_date": "1995-10-04",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "GAINAX 制作，庵野秀明执导。2015年使徒突袭第三新东京市，14岁少年碇真嗣被父亲要求驾驶泛用人型决战兵器 EVA 初号机，在抗击使徒与内心封闭中寻找存在的价值。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/e1/9b/265_G213y.jpg",
            "cover_aspect": "2:3",
            "tags": ["剧集", "动画", "科幻", "EVA"],
            "translations": [
                {"locale": "en-US", "title": "Neon Genesis Evangelion", "summary": "A seminal psychological mecha anime series exploring teenage isolation and existential philosophy."}
            ]
        },
        {
            "key": "work_spirited_away",
            "title": "千与千寻",
            "original_title": "千と千尋の神隠し",
            "aliases": ["Spirited Away"],
            "release_date": "2001-07-20",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "吉卜力工作室出品，宫崎骏编导。10岁女孩千寻在搬家途中误入神灵异世界，为了拯救贪吃变成猪的父母，在油屋汤婆婆手下打工自立，并结识少年白龙。",
            "cover_image_url": "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
            "cover_aspect": "2:3",
            "tags": ["电影", "动画", "奇幻", "冒险", "吉卜力", "奥斯卡"],
            "translations": [
                {"locale": "en-US", "title": "Spirited Away", "summary": "Academy Award-winning animated masterpiece by Hayao Miyazaki and Studio Ghibli."}
            ]
        },
        {
            "key": "work_miyazaki_collection",
            "title": "宮崎駿監督作品集",
            "original_title": "宮崎駿監督作品集",
            "aliases": ["The Collected Works of Hayao Miyazaki", "宫崎骏监督作品集"],
            "release_date": "2014-07-02",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "吉卜力工作室与华特迪士尼日本发行的宫崎骏导演全集典藏。完整收录宫崎骏自1979年至2013年执导的11部长篇动画电影（《鲁邦三世卡里奥斯特罗之城》《风之谷》《天空之城》《龙猫》《魔女宅急便》《红猪》《幽灵公主》《千与千寻》《哈尔的移动城堡》《悬崖上的金鱼姬》《起风了》），以及2部珍贵特典盘（含《ユキの太阳》《On Your Mark》MV及引退记者会实录）。",
            "cover_image_url": "https://image.tmdb.org/t/p/w500/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
            "cover_aspect": "2:3",
            "tags": ["电影", "动画", "作品集", "吉卜力", "宫崎骏", "典藏"],
            "translations": [
                {"locale": "en-US", "title": "The Collected Works of Hayao Miyazaki", "summary": "A 13-disc definitive Blu-ray box set compiling 11 feature films directed by Hayao Miyazaki from 1979 to 2013, alongside two bonus documentary discs."}
            ]
        },

        # === 院线电影 (Feature Films) ===
        {
            "key": "work_interstellar",
            "title": "星际穿越",
            "original_title": "Interstellar",
            "aliases": ["星际穿越 电影"],
            "release_date": "2014-11-07",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "克里斯托弗·诺兰执导。未来地球遭遇枯萎病肆虐，前宇航员库珀告别年幼的儿女，穿越土星旁的虫洞前往未知星系寻找人类宜居新家园。爱是唯一可以超越时间与空间的事物。",
            "cover_image_url": "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
            "cover_aspect": "2:3",
            "tags": ["电影", "实拍", "科幻", "硬科幻", "诺兰"],
            "translations": [
                {"locale": "en-US", "title": "Interstellar", "summary": "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival."}
            ]
        },
        {
            "key": "work_wandering_earth_2",
            "title": "流浪地球 2",
            "original_title": "流浪地球 2",
            "aliases": ["The Wandering Earth II"],
            "release_date": "2023-01-22",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "郭帆执导，刘慈欣监制。太阳危机爆发前夕，面对地球停转与移山计划的艰难抉择，航天员刘培强与数字生命研究员图恒宇等人为拯救人类文明做出史诗抉择。",
            "cover_image_url": "https://image.tmdb.org/t/p/w500/cAS2e9hUwu6Ydsx7byXj16H00Ai.jpg",
            "cover_aspect": "2:3",
            "tags": ["电影", "实拍", "科幻", "硬科幻", "刘慈欣"],
            "translations": [
                {"locale": "en-US", "title": "The Wandering Earth II", "summary": "Prequel sci-fi blockbuster depicting the early days of the Solar Crisis and the Moving Mountain Project."}
            ]
        },

        # === 音乐唱片与原声大碟 (Music & Soundtracks) ===
        {
            "key": "work_kessoku_album",
            "title": "结束乐队 同名专辑",
            "original_title": "結束バンド",
            "aliases": ["Kessoku Band Self-Titled Album"],
            "release_date": "2022-12-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "TV动画《孤独摇滚！》剧中乐队'结束乐队'的完整首张录音室专辑，收录《青春情结》《若能化为星座》《吉他与孤独与蓝色星球》《滚动的岩石，清晨降临到你身边》等14首高口碑摇滚金曲。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d5/4b/404104_pS37H.jpg",
            "cover_aspect": "1:1",
            "tags": ["音乐", "专辑", "流行摇滚", "原声带"],
            "translations": [
                {"locale": "en-US", "title": "Kessoku Band (Album)", "summary": "Debut self-titled studio album by Kessoku Band from Bocchi the Rock!."}
            ]
        },
        {
            "key": "work_lotm_ost",
            "title": "诡秘之主 官方概念原声大碟",
            "original_title": "Lord of the Mysteries Official Concept OST",
            "aliases": ["诡秘之主 原声带"],
            "release_date": "2020-05-01",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "阅文集团官方出品的《诡秘之主》管弦乐概念原声专辑，融合维多利亚古典交响与神秘克苏鲁空灵合唱，呈现灰雾之上与贝克兰德雾夜的史诗意境。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/12/e1/290411_59o1O.jpg",
            "cover_aspect": "1:1",
            "tags": ["音乐", "专辑", "交响原声", "原声带"],
            "translations": [
                {"locale": "en-US", "title": "Lord of the Mysteries Official Concept Soundtrack", "summary": "Official symphonic concept album inspired by the Lord of the Mysteries universe."}
            ]
        },
        {
            "key": "work_interstellar_ost",
            "title": "星际穿越 电影原声带",
            "original_title": "Interstellar: Original Motion Picture Soundtrack",
            "aliases": ["Interstellar OST"],
            "release_date": "2014-11-17",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "汉斯·季默执笔配乐。采用伦敦圣殿教堂的历史管风琴为主奏乐器，宏大的宇宙孤独感与深邃的父女情感在音符中回荡，被誉为21世纪最震撼的电影配乐之一。",
            "cover_image_url": "https://coverartarchive.org/release/84409395-5ff1-4560-9ba1-14fc3f1d3319/12795861962.jpg",
            "cover_aspect": "1:1",
            "tags": ["音乐", "专辑", "交响原声", "原声带", "诺兰"],
            "translations": [
                {"locale": "en-US", "title": "Interstellar (Original Motion Picture Soundtrack)", "summary": "Masterful organ-driven film score composed by Hans Zimmer."}
            ]
        }
    ],

    # -------------------------------------------------------------------------
    # 4. 发行版规格定义 (Releases & Mediums conforming to LRM)
    # -------------------------------------------------------------------------
    "releases": [
        # --- 诡秘之主 Releases ---
        {
            "key": "rel_lotm_web",
            "work_key": "work_lotm",
            "publisher_artist_key": "china_literature",
            "edition_name": "诡秘之主（起点中文网正版连载·完结典藏版）",
            "catalog_number": "QD-LOTM-DIGITAL-01",
            "barcode": "978-7-9008-0001-1",
            "publisher": "起点中文网 / 阅文集团",
            "packaging": "Digital",
            "edition_date": "2020-05-01",
            "country": "CHN",
            "distribution_channel": "web",
            "notes": "全书270余万字，起点中文网官方全本数字典藏版"
        },
        {
            "key": "rel_lotm_book_vol1",
            "work_key": "work_lotm",
            "publisher_artist_key": "new_star_press",
            "edition_name": "诡秘之主 1：小丑（精装典藏版，广东旅游出版社，ISBN 9787557022495）",
            "catalog_number": "NSP-LOTM-P01",
            "barcode": "978-7-5570-2249-5",
            "publisher": "广东旅游出版社",
            "packaging": "Hardcover",
            "edition_date": "2020-09-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "实体精装单行本第1卷，收录第1章至第213章及精美彩插"
        },

        # --- 宿命之环 Releases ---
        {
            "key": "rel_coi_web",
            "work_key": "work_coi",
            "publisher_artist_key": "china_literature",
            "edition_name": "宿命之环（起点中文网官方数字连载版）",
            "catalog_number": "QD-COI-DIGITAL-01",
            "barcode": "978-7-9008-0002-8",
            "publisher": "起点中文网 / 阅文集团",
            "packaging": "Digital",
            "edition_date": "2023-03-04",
            "country": "CHN",
            "distribution_channel": "web",
            "notes": "官方网络连载版"
        },
        {
            "key": "rel_coi_book_vol1",
            "work_key": "work_coi",
            "publisher_artist_key": "new_star_press",
            "edition_name": "宿命之环 1：宿命之环（初版平装单行本，新星出版社，ISBN 9787513352887）",
            "catalog_number": "NSP-COI-P01",
            "barcode": "978-7-5133-5288-7",
            "publisher": "新星出版社",
            "packaging": "Paperback",
            "edition_date": "2023-11-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "实体平装第一卷"
        },

        # --- 三体 Releases ---
        {
            "key": "rel_threebody_hardcover",
            "work_key": "work_threebody",
            "publisher_artist_key": "chongqing_press",
            "edition_name": "三体（全三册精装典藏版，重庆出版社，ISBN 9787229042059）",
            "catalog_number": "CQ-3B-BOX-01",
            "barcode": "978-7-229-04205-9",
            "publisher": "重庆出版社",
            "packaging": "Box Set",
            "edition_date": "2012-01-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "雨果奖纪念精装三部曲套装"
        },

        # --- 道诡异仙 Releases ---
        {
            "key": "rel_daogui_web",
            "work_key": "work_daogui",
            "publisher_artist_key": "china_literature",
            "edition_name": "道诡异仙（起点中文网官方数字连载·完结版）",
            "catalog_number": "QD-DGYX-DIGITAL-01",
            "barcode": "978-7-9008-0003-5",
            "publisher": "起点中文网 / 阅文集团",
            "packaging": "Digital",
            "edition_date": "2023-05-18",
            "country": "CHN",
            "distribution_channel": "web",
            "notes": "全书210余万字，起点中文网完结典藏版"
        },
        {
            "key": "rel_daogui_book_vol1",
            "work_key": "work_daogui",
            "publisher_artist_key": "new_star_press",
            "edition_name": "道诡异仙 1：清旺来（初版平装，新星出版社，ISBN 9787513353990）",
            "catalog_number": "NSP-DGYX-01",
            "barcode": "978-7-5133-5399-0",
            "publisher": "新星出版社",
            "packaging": "Paperback",
            "edition_date": "2024-01-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "中式克苏鲁仙侠实体第一卷"
        },

        # --- 全职高手 Releases ---
        {
            "key": "rel_quanzhi_box",
            "work_key": "work_quanzhi",
            "publisher_artist_key": "china_literature",
            "edition_name": "全职高手（十周年纪念精装典藏全套24册，知书达礼，ISBN 9787557008185）",
            "catalog_number": "QZGS-10TH-BOX",
            "barcode": "978-7-5570-0818-5",
            "publisher": "广东旅游出版社 / 知书达礼",
            "packaging": "Box Set",
            "edition_date": "2021-08-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "全职高手十周年豪华纪念典藏盒装"
        },

        # --- 沙丘 Releases ---
        {
            "key": "rel_dune_hardcover",
            "work_key": "work_dune",
            "publisher_artist_key": "thinkingdom",
            "edition_name": "沙丘（全六部精装典藏套装，江苏凤凰文艺出版社，ISBN 9787559416568）",
            "catalog_number": "DUNE-6BOX-CN",
            "barcode": "978-7-5594-1656-8",
            "publisher": "读客文化 / 江苏凤凰文艺出版社",
            "packaging": "Box Set",
            "edition_date": "2019-01-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "弗兰克·赫伯特沙丘六部曲全本译本"
        },

        # --- 百年孤独 Releases ---
        {
            "key": "rel_hundred_years_cn",
            "work_key": "work_hundred_years",
            "publisher_artist_key": "thinkingdom",
            "edition_name": "百年孤独（50周年精装纪念版，范晔译，南海出版公司，ISBN 9787544291170）",
            "catalog_number": "NH-100YRS-50TH",
            "barcode": "978-7-5442-9117-0",
            "publisher": "新经典文化 / 南海出版公司",
            "packaging": "Hardcover",
            "edition_date": "2017-08-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "马尔克斯官方正式授权中文版"
        },

        # --- 葬送的芙莉莲漫画 Releases ---
        {
            "key": "rel_frieren_manga_vol1",
            "work_key": "work_frieren_manga",
            "publisher_artist_key": "kadokawa",
            "edition_name": "葬送的芙莉莲 第1卷（小学馆 少年Sunday 单行本，ISBN 9784098501809）",
            "catalog_number": "SS-FRIEREN-01",
            "barcode": "978-4-09-850180-9",
            "publisher": "小学馆 / Shogakukan",
            "packaging": "Paperback",
            "edition_date": "2020-08-18",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "收录第1话至第7话"
        },

        # --- 电锯人 Releases ---
        {
            "key": "rel_chainsaw_manga_vol1",
            "work_key": "work_chainsaw_manga",
            "publisher_artist_key": "kadokawa",
            "edition_name": "电锯人 第1卷：狗与电锯（JUMP COMICS 单行本，ISBN 9784088817804）",
            "catalog_number": "JC-CHAINSAW-01",
            "barcode": "978-4-08-881780-4",
            "publisher": "集英社 / SHUEISHA",
            "packaging": "Paperback",
            "edition_date": "2019-03-04",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "公安对魔特异课篇开幕"
        },

        # --- 一人之下 Releases ---
        {
            "key": "rel_under_one_person_vol1",
            "work_key": "work_under_one_person",
            "publisher_artist_key": "china_literature",
            "edition_name": "一人之下 第1卷：炁体源流（浙江文艺出版社，平装单行本，ISBN 9787533948887）",
            "catalog_number": "ZJ-YRXS-01",
            "barcode": "978-7-5339-4888-7",
            "publisher": "浙江文艺出版社",
            "packaging": "Paperback",
            "edition_date": "2017-07-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "国漫经典实体单行本第1卷"
        },

        # --- 镖人 Releases ---
        {
            "key": "rel_biao_ren_vol1",
            "work_key": "work_biao_ren",
            "publisher_artist_key": "new_star_press",
            "edition_name": "镖人 第1卷（北京联合出版公司，初回限定版，ISBN 9787559612977）",
            "catalog_number": "BJ-BIAOREN-01",
            "barcode": "978-7-5596-1297-7",
            "publisher": "北京联合出版公司",
            "packaging": "Paperback",
            "edition_date": "2018-04-01",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "硬派武侠漫画第1卷"
        },

        # --- 刀剑神域 动画 Releases ---
        {
            "key": "rel_sao_bd_box",
            "work_key": "work_sao_anime",
            "publisher_artist_key": "aniplex",
            "edition_name": "刀剑神域 第一季（4K UHD 典藏蓝光BOX，ANZX-16201，Aniplex）",
            "catalog_number": "ANZX-16201",
            "barcode": "4534530112345",
            "publisher": "Aniplex",
            "packaging": "Box Set",
            "edition_date": "2018-09-12",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "收录艾恩葛朗特篇与妖精之舞篇全25话高保真重置"
        },

        # --- 孤独摇滚！动画 Releases ---
        {
            "key": "rel_bocchi_bd_box",
            "work_key": "work_bocchi_anime",
            "publisher_artist_key": "aniplex",
            "edition_name": "孤独摇滚！ 完全生产限定版 Blu-ray Disc Box（全6卷，Aniplex）",
            "catalog_number": "ANZX-16281",
            "barcode": "4534530138989",
            "publisher": "Aniplex",
            "packaging": "Box Set",
            "edition_date": "2022-12-28",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "收录TV动画全12话及特典CD、制作花絮手册"
        },

        # --- 紫罗兰永恒花园 动画 Releases ---
        {
            "key": "rel_violet_bd_box",
            "work_key": "work_violet_anime",
            "publisher_artist_key": "kyoto_animation",
            "edition_name": "紫罗兰永恒花园（京都动画官方初回限定 Blu-ray BOX，PCXE-50811）",
            "catalog_number": "PCXE-50811",
            "barcode": "4988013098510",
            "publisher": "波丽佳音 / Pony Canyon",
            "packaging": "Box Set",
            "edition_date": "2018-04-04",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "京阿尼原厂高保真压制，附赠原画设定集"
        },

        # --- 新世纪福音战士 TV Releases ---
        {
            "key": "rel_eva_bd_box",
            "work_key": "work_eva_tv",
            "publisher_artist_key": "kadokawa",
            "edition_name": "新世纪福音战士 Blu-ray BOX STANDARD EDITION（KIXA-90884，King Records）",
            "catalog_number": "KIXA-90884",
            "barcode": "4988003856502",
            "publisher": "King Records",
            "packaging": "Box Set",
            "edition_date": "2019-07-24",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "高清母带重制标准蓝光盒装，收录全26话及旧剧场版"
        },

        # --- 千与千寻 电影 Releases (日本官方初版蓝光单行本) ---
        {
            "key": "rel_spirited_away_bd",
            "work_key": "work_spirited_away",
            "publisher_artist_key": "ghibli",
            "edition_name": "千与千寻（日本院线官方初版蓝光，VWBS-1530，Walt Disney Studios Japan）",
            "catalog_number": "VWBS-1530",
            "barcode": "4959241753069",
            "publisher": "Walt Disney Studios Japan",
            "packaging": "Slipcase",
            "edition_date": "2014-07-16",
            "country": "JPN",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "《千与千寻》官方初版 Blu-ray（1 BD-50，双层 50GB，含正片及绘本分镜与剧场预告）",
            "mediums": [
                {
                    "position": 1,
                    "name": "Disc 1 (BD-50): 千与千寻 电影正片 (Feature Film)",
                    "format": "Blu-ray",
                    "media_category": "video",
                    "tracks": [
                        {"position": 1, "title": "《千与千寻》正片 (125分钟 / DTS-HD Master Audio 6.1ch / 日本语・多国语字幕)", "duration_seconds": 7500, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}
                    ]
                }
            ]
        },

        # --- 宮崎駿監督作品集 13BD 豪华限定盒装 Releases ---
        {
            "key": "rel_miyazaki_collection_box",
            "work_key": "work_miyazaki_collection",
            "publisher_artist_key": "ghibli",
            "edition_name": "宮崎駿監督作品集（13BD 豪华限定盒装，VWBS-1531，Walt Disney Studios Japan / 吉卜力工作室）",
            "catalog_number": "VWBS-1531",
            "barcode": "4959241753076",
            "publisher": "Walt Disney Studios Japan",
            "packaging": "Box Set",
            "edition_date": "2014-07-02",
            "country": "JPN",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "收录宫崎骏自1979年至2013年执导的11部长篇动画电影及2部珍贵特典盘，全13碟豪华限定蓝光盒装",
            "mediums": [
                {"position": 1, "name": "Disc 1 (BD): 《鲁邦三世 卡里奥斯特罗之城》(1979)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《鲁邦三世 卡里奥斯特罗之城》正片", "duration_seconds": 6000, "artist_credit": "导演：宫崎骏"}]},
                {"position": 2, "name": "Disc 2 (BD): 《风之谷》(1984)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《风之谷》正片", "duration_seconds": 6960, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 3, "name": "Disc 3 (BD): 《天空之城》(1986)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《天空之城》正片", "duration_seconds": 7440, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 4, "name": "Disc 4 (BD): 《龙猫》(1988)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《龙猫》正片", "duration_seconds": 5160, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 5, "name": "Disc 5 (BD): 《魔女宅急便》(1989)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《魔女宅急便》正片", "duration_seconds": 6180, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 6, "name": "Disc 6 (BD): 《红猪》(1992)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《红猪》正片", "duration_seconds": 5580, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 7, "name": "Disc 7 (BD): 《幽灵公主》(1997)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《幽灵公主》正片", "duration_seconds": 8040, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 8, "name": "Disc 8 (BD): 《千与千寻》(2001)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "work_key": "work_spirited_away", "title": "《千与千寻》正片 (VWBS-1531 Disc 8)", "duration_seconds": 7500, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 9, "name": "Disc 9 (BD): 《哈尔的移动城堡》(2004)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《哈尔的移动城堡》正片", "duration_seconds": 7140, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 10, "name": "Disc 10 (BD): 《悬崖上的金鱼姬》(2008)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《悬崖上的金鱼姬》正片", "duration_seconds": 6060, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 11, "name": "Disc 11 (BD): 《起风了》(2013)", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《起风了》正片", "duration_seconds": 7560, "artist_credit": "导演：宫崎骏 / 音乐：久石让"}]},
                {"position": 12, "name": "Disc 12 (Bonus BD): 特典盘 1（《ユキの太阳》/《On Your Mark》）", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "《ユキの太阳》试验片 (1972) / 《On Your Mark》MV (1995)", "duration_seconds": 720, "artist_credit": "监督：宫崎骏"}]},
                {"position": 13, "name": "Disc 13 (Bonus BD): 特典盘 2（宫崎骏引退记者会完整高清纪录）", "format": "Blu-ray", "media_category": "video", "tracks": [{"position": 1, "title": "宫崎骏引退记者会 (2013.9.6) 完整无剪辑高清实录", "duration_seconds": 5400, "artist_credit": "出镜：宫崎骏 / 铃木敏夫"}]}
            ]
        },

        # --- 星际穿越 电影 Releases ---
        {
            "key": "rel_interstellar_4k",
            "work_key": "work_interstellar",
            "publisher_artist_key": "sony_music",
            "edition_name": "星际穿越（4K Ultra HD + IMAX 蓝光双碟典藏版，Warner Bros.）",
            "catalog_number": "WB-INT-4K-01",
            "barcode": "883929621347",
            "publisher": "Warner Bros. Home Entertainment",
            "packaging": "Steelbook",
            "edition_date": "2017-12-19",
            "country": "USA",
            "distribution_channel": "physical",
            "notes": "IMAX 全画幅原生 4K HDR 母盘"
        },

        # --- 流浪地球 2 电影 Releases ---
        {
            "key": "rel_wandering_earth_2_4k",
            "work_key": "work_wandering_earth_2",
            "publisher_artist_key": "chongqing_press",
            "edition_name": "流浪地球 2（4K UHD + 杜比全景声 典藏铁盒限量版，中影数字）",
            "catalog_number": "CFG-WE2-4K-01",
            "barcode": "978-7-8800-2023-1",
            "publisher": "中国电影股份有限公司",
            "packaging": "Steelbook",
            "edition_date": "2023-08-15",
            "country": "CHN",
            "distribution_channel": "physical",
            "notes": "4K HDR 杜比视界高规格母盘"
        },

        # --- 诡秘之主 概念原声大碟 Releases ---
        {
            "key": "rel_lotm_ost_digital",
            "work_key": "work_lotm_ost",
            "publisher_artist_key": "china_literature",
            "edition_name": "诡秘之主 官方概念原声大碟（Hi-Res 96kHz/24bit 数字无损专辑）",
            "catalog_number": "QD-LOTM-OST-01",
            "barcode": "978-7-9008-0004-2",
            "publisher": "阅文集团",
            "packaging": "Digital",
            "edition_date": "2020-05-01",
            "country": "CHN",
            "distribution_channel": "digital",
            "notes": "官方交响概念原声集",
            "mediums": [
                {
                    "position": 1,
                    "name": "Disc 1",
                    "format": "Digital",
                    "media_category": "music",
                    "tracks": [
                        {"position": 1, "title": "灰雾之上 (Above the Gray Fog)", "duration_seconds": 210, "artist_credit": "阅文集团音乐中心"},
                        {"position": 2, "title": "塔罗会 (The Tarot Club)", "duration_seconds": 195, "artist_credit": "阅文集团音乐中心"},
                        {"position": 3, "title": "贝克兰德雾夜 (Backlund Foggy Night)", "duration_seconds": 240, "artist_credit": "阅文集团音乐中心"},
                        {"position": 4, "title": "愚者的低语 (Whisper of The Fool)", "duration_seconds": 180, "artist_credit": "阅文集团音乐中心"},
                        {"position": 5, "title": "源堡苏醒 (Sefirah Castle Awakening)", "duration_seconds": 265, "artist_credit": "阅文集团音乐中心"}
                    ]
                }
            ]
        },

        # --- 结束乐队同名专辑 Releases & Mediums & Tracks ---
        {
            "key": "rel_kessoku_cd",
            "work_key": "work_kessoku_album",
            "publisher_artist_key": "aniplex",
            "edition_name": "结束乐队（初回限定盘 CD+Blu-ray，SVWC-70613，Aniplex）",
            "catalog_number": "SVWC-70613",
            "barcode": "4534530140777",
            "publisher": "Aniplex",
            "packaging": "Digipak",
            "edition_date": "2022-12-28",
            "country": "JPN",
            "distribution_channel": "physical",
            "notes": "实体首发限定盘，附带无字 OP/ED 影像 Blu-ray",
            "mediums": [
                {
                    "position": 1,
                    "name": "Disc 1 (Audio CD)",
                    "format": "CD",
                    "media_category": "music",
                    "tracks": [
                        {"position": 1, "title": "青春コンプレックス (Seishun Complex)", "duration_seconds": 203, "artist_credit": "結束バンド"},
                        {"position": 2, "title": "ひとりぼっち东京 (Hitoribocchi Tokyo)", "duration_seconds": 232, "artist_credit": "結束バンド"},
                        {"position": 3, "title": "Distortion!!", "duration_seconds": 203, "artist_credit": "結束バンド"},
                        {"position": 4, "title": "ひみつ基地 (Secret Base)", "duration_seconds": 212, "artist_credit": "結束バンド"},
                        {"position": 5, "title": "ギターと孤独と苍い惑星 (Guitar, Loneliness and Blue Planet)", "duration_seconds": 228, "artist_credit": "結束バンド"},
                        {"position": 6, "title": "ラブソングが歌えない (I Can't Sing Love Songs)", "duration_seconds": 188, "artist_credit": "結束バンド"},
                        {"position": 7, "title": "あのバンド (That Band)", "duration_seconds": 213, "artist_credit": "結束バンド"},
                        {"position": 8, "title": "カラカラ (Karakara)", "duration_seconds": 244, "artist_credit": "結束バンド"},
                        {"position": 9, "title": "小さな海 (Small Sea)", "duration_seconds": 223, "artist_credit": "結束バンド"},
                        {"position": 10, "title": "なにが悪い (What is Wrong With Being Bad)", "duration_seconds": 207, "artist_credit": "結束バンド"},
                        {"position": 11, "title": "忘れてやらない (Never Forget)", "duration_seconds": 223, "artist_credit": "結束バンド"},
                        {"position": 12, "title": "星座になれたら (If I Could Be a Constellation)", "duration_seconds": 258, "artist_credit": "結束バンド"},
                        {"position": 13, "title": "フラッシュバッカー (Flashbacker)", "duration_seconds": 275, "artist_credit": "結束バンド"},
                        {"position": 14, "title": "転がる岩、君に朝が降る (Rockn' Roll, Morning Light Falls on You)", "duration_seconds": 271, "artist_credit": "結束バンド"}
                    ]
                }
            ]
        },

        # --- 星际穿越 原声带 Releases ---
        {
            "key": "rel_interstellar_cd",
            "work_key": "work_interstellar_ost",
            "publisher_artist_key": "sony_music",
            "edition_name": "星际穿越 电影原声带（豪华黑胶双盘，Watertower Music）",
            "catalog_number": "WTM-39562",
            "barcode": "794043181827",
            "publisher": "Watertower Music",
            "packaging": "Gatefold",
            "edition_date": "2014-11-18",
            "country": "USA",
            "distribution_channel": "physical",
            "notes": "双黑胶 180g 重盘典藏版",
            "mediums": [
                {
                    "position": 1,
                    "name": "Vinyl 1",
                    "format": "Vinyl",
                    "media_category": "music",
                    "tracks": [
                        {"position": 1, "title": "Dreaming of the Crash", "duration_seconds": 235, "artist_credit": "Hans Zimmer"},
                        {"position": 2, "title": "Cornfield Chase", "duration_seconds": 126, "artist_credit": "Hans Zimmer"},
                        {"position": 3, "title": "Dust", "duration_seconds": 341, "artist_credit": "Hans Zimmer"},
                        {"position": 4, "title": "Day One", "duration_seconds": 199, "artist_credit": "Hans Zimmer"},
                        {"position": 5, "title": "Stay", "duration_seconds": 412, "artist_credit": "Hans Zimmer"},
                        {"position": 6, "title": "Message from Home", "duration_seconds": 100, "artist_credit": "Hans Zimmer"},
                        {"position": 7, "title": "No Time for Caution", "duration_seconds": 246, "artist_credit": "Hans Zimmer"}
                    ]
                }
            ]
        }
    ],

    # -------------------------------------------------------------------------
    # 5. 演职人员关系与主体角色 (Work Relations)
    # -------------------------------------------------------------------------
    "work_relations": [
        {
            "work_key": "work_lotm",
            "relations": [
                {"artist_key": "cuttlefish", "role": "author"}
            ]
        },
        {
            "work_key": "work_coi",
            "relations": [
                {"artist_key": "cuttlefish", "role": "author"}
            ]
        },
        {
            "work_key": "work_daogui",
            "relations": [
                {"artist_key": "huwei", "role": "author"}
            ]
        },
        {
            "work_key": "work_threebody",
            "relations": [
                {"artist_key": "liu_cixin", "role": "author"}
            ]
        },
        {
            "work_key": "work_quanzhi",
            "relations": [
                {"artist_key": "butterfly_blue", "role": "author"}
            ]
        },
        {
            "work_key": "work_dune",
            "relations": [
                {"artist_key": "frank_herbert", "role": "author"}
            ]
        },
        {
            "work_key": "work_hundred_years",
            "relations": [
                {"artist_key": "garcia_marquez", "role": "author"}
            ]
        },
        {
            "work_key": "work_frieren_manga",
            "relations": [
                {"artist_key": "yamada_kanehito", "role": "author"},
                {"artist_key": "abe_tsukasa", "role": "illustrator"}
            ]
        },
        {
            "work_key": "work_chainsaw_manga",
            "relations": [
                {"artist_key": "fujimoto_tatsuki", "role": "author"}
            ]
        },
        {
            "work_key": "work_under_one_person",
            "relations": [
                {"artist_key": "mi_er", "role": "author"}
            ]
        },
        {
            "work_key": "work_biao_ren",
            "relations": [
                {"artist_key": "xu_xianzhe", "role": "author"}
            ]
        },
        {
            "work_key": "work_sao_anime",
            "relations": [
                {"artist_key": "kawahara", "role": "author"},
                {"artist_key": "kajiura_yuki", "role": "composer"},
                {"artist_key": "aniplex", "role": "producer"}
            ]
        },
        {
            "work_key": "work_bocchi_anime",
            "relations": [
                {"artist_key": "kessoku_band", "role": "performer"},
                {"artist_key": "aniplex", "role": "producer"}
            ]
        },
        {
            "work_key": "work_violet_anime",
            "relations": [
                {"artist_key": "kyoto_animation", "role": "studio"},
                {"artist_key": "evan_call", "role": "composer"}
            ]
        },
        {
            "work_key": "work_eva_tv",
            "relations": [
                {"artist_key": "anno_hideaki", "role": "director"}
            ]
        },
        {
            "work_key": "work_spirited_away",
            "relations": [
                {"artist_key": "miyazaki_hayao", "role": "director"},
                {"artist_key": "hisaishi_joe", "role": "composer"},
                {"artist_key": "ghibli", "role": "studio"}
            ]
        },
        {
            "work_key": "work_miyazaki_collection",
            "relations": [
                {"artist_key": "miyazaki_hayao", "role": "director"},
                {"artist_key": "ghibli", "role": "studio"}
            ]
        },
        {
            "work_key": "work_interstellar",
            "relations": [
                {"artist_key": "nolan", "role": "director"},
                {"artist_key": "hans_zimmer", "role": "composer"}
            ]
        },
        {
            "work_key": "work_wandering_earth_2",
            "relations": [
                {"artist_key": "guo_fan", "role": "director"},
                {"artist_key": "liu_cixin", "role": "author"}
            ]
        },
        {
            "work_key": "work_kessoku_album",
            "relations": [
                {"artist_key": "kessoku_band", "role": "performer"}
            ]
        },
        {
            "work_key": "work_interstellar_ost",
            "relations": [
                {"artist_key": "hans_zimmer", "role": "composer"}
            ]
        }
    ],

    # -------------------------------------------------------------------------
    # 6. 跨媒介图谱语义边 (Cross-Media & Franchise Graph Edges)
    # -------------------------------------------------------------------------
    "entity_relations": [
        # --- 企划归属 ---
        {"source_type": "work", "source_key": "work_lotm", "target_type": "franchise", "target_key": "fr_lotm", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_coi", "target_type": "franchise", "target_key": "fr_lotm", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_lotm_ost", "target_type": "franchise", "target_key": "fr_lotm", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_threebody", "target_type": "franchise", "target_key": "fr_threebody", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_sao_anime", "target_type": "franchise", "target_key": "fr_sao", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_frieren_manga", "target_type": "franchise", "target_key": "fr_frieren", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_bocchi_anime", "target_type": "franchise", "target_key": "fr_bocchi", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_kessoku_album", "target_type": "franchise", "target_key": "fr_bocchi", "relationship_type": "part_of_franchise"},
        {"source_type": "work", "source_key": "work_eva_tv", "target_type": "franchise", "target_key": "fr_eva", "relationship_type": "part_of_franchise"},

        # --- 作品间跨媒介关系 ---
        {"source_type": "work", "source_key": "work_coi", "target_type": "work", "target_key": "work_lotm", "relationship_type": "sequel_of"},
        {"source_type": "work", "source_key": "work_lotm_ost", "target_type": "work", "target_key": "work_lotm", "relationship_type": "soundtrack_of"},
        {"source_type": "work", "source_key": "work_kessoku_album", "target_type": "work", "target_key": "work_bocchi_anime", "relationship_type": "soundtrack_of"},
        {"source_type": "work", "source_key": "work_interstellar_ost", "target_type": "work", "target_key": "work_interstellar", "relationship_type": "soundtrack_of"},
        {"source_type": "work", "source_key": "work_bocchi_anime", "target_type": "work", "target_key": "work_frieren_manga", "relationship_type": "crossover_with", "qualifier": "监督/作画主创联动"},
        {"source_type": "work", "source_key": "work_wandering_earth_2", "target_type": "work", "target_key": "work_threebody", "relationship_type": "crossover_with", "qualifier": "同属刘慈欣宏大科幻世界观延伸"},
        {"source_type": "work", "source_key": "work_spirited_away", "target_type": "work", "target_key": "work_miyazaki_collection", "relationship_type": "included_in", "qualifier": "收录于全集盒装 (VWBS-1531 Disc 8)"}
    ],

    # -------------------------------------------------------------------------
    # 7. 社区板块真实研讨与考据主题 (Forum Topics & Markdown/LaTeX discussions)
    # -------------------------------------------------------------------------
    "topics": [
        {
            "board_code": "reviews",
            "work_key": "work_lotm",
            "title": "【深度考据】论《诡秘之主》二十二条神之途径与塔罗大阿卡那的神秘学映射",
            "language": "zh-CN",
            "tags": ["考据", "奇幻", "克苏鲁"],
            "content": """# 论《诡秘之主》二十二条途径与西方神秘学象征体系

在爱潜水的乌贼构建的《诡秘之主》世界观中，**神之途径（Pathways of the Divine）** 构成了整个超凡力量的核心框架。

---

## 一、源质与序列顶点的对应数学拓扑

每条途径共包含 10 个序列（序列 9 到序列 0），其本质可抽象为有限维状态机流形转移：

$$
\\mathcal{S} = \\{s_i \\mid i \\in [0, 9], s_i \\succ s_{i+1}\\}
$$

序列 0 融合源质（Sefirah）后升格为旧日（Great Old One），其稳定性判据遵循非阿贝尔群的自守守恒：

$$
\\lim_{t \\to \\infty} \\oint_{\\partial \\Omega} \\nabla \\Psi_{\\text{Sefirot}} \\cdot d\\mathbf{S} = \\chi(\\mathcal{M}) \\cdot 22
$$

---

## 二、占卜家途径（The Fool）与灵界信标

克莱恩·莫雷蒂所在的**占卜家途径**以命运、愚弄与历史迷雾为权柄：

1. **序列 9：占卜家 (Diviner)** — 灵视开启，接触灵界投影；
2. **序列 4：诡法师 (Bizarro Sorcerer)** — 灵体之线操控，傀儡置换；
3. **序列 1：诡秘侍者 (Attendant of Mysteries)** — 调动历史孔隙，支配概念隐秘；
4. **序列 0：愚者 (The Fool)** — 盲目痴愚，愚弄时空。

> “不属于这个时代的愚者，灰雾之上的神秘主宰，执掌好运的黄黑之王。”

欢迎各位档案员在评论区交流考证意见！
"""
        },
        {
            "board_code": "reviews",
            "work_key": "work_bocchi_anime",
            "title": "【抓轨与版本评析】结束乐队《結束バンド》初回盘 SVWC-70613 EAC 抓轨日志与动态范围 DR 分析",
            "language": "zh-CN",
            "tags": ["无损抓轨", "压制日志", "OST", "音乐"],
            "content": """# 结束乐队首张同名专辑（SVWC-70613）Hi-Res 无损母带抓轨报告

本次针对 Aniplex 发行的初回限定盘（Catalog No. `SVWC-70613`）进行 EAC 精确抓轨与动态范围（Dynamic Range）评测。

---

## 1. 抓轨环境与驱动器校验

```text
Exact Audio Copy V1.6
EAC 抓轨日志文件: 2022-12-28 結束バンド / 結束バンド [SVWC-70613]
使用驱动器: PIONEER  BD-RW   BDR-S12UHT   Adapter: 0  ID: 1
读取模式: 具备安全校验 (Secure Mode), 禁用音频缓存, C2 错误校验开启
读偏移校正: +667 采样点
AccurateRip 校验: 准确比对匹配 (v1 + v2 正确比对，100.0% 置信度)
```

## 2. 动态范围测试数据表 (DR Meter)

| Track | 标题 | 峰值电平 (Peak) | 均方根 RMS | 动态范围 DR |
|:-----:|:-----|:---------------:|:----------:|:-----------:|
| 01 | 青春コンプレックス | -0.10 dB | -8.45 dB | **DR8** |
| 05 | ギターと孤独と苍い惑星 | -0.05 dB | -7.90 dB | **DR7** |
| 07 | あのバンド | -0.10 dB | -8.12 dB | **DR8** |
| 12 | 星座になれたら | -0.15 dB | -9.20 dB | **DR9** |
| 14 | 転がる岩、君に朝が降る | -0.20 dB | -10.15 dB | **DR10** |

整体专辑官方混音非常扎实，三木真吉的贝斯低频下潜有力，喜多与波奇的双吉他声像分离度极高！
"""
        },
        {
            "board_code": "qa",
            "work_key": "work_interstellar",
            "title": "【答疑交流】MetaFusion 图书馆级 LRM 实体模型编目实操指南：Work 与 Release 的界限何在？",
            "language": "zh-CN",
            "tags": ["求助", "编目探讨", "考据"],
            "content": """# 关于 MetaFusion LRM 编目模型中 Work / Release / Medium 的界限说明

经常有新加入的档案员提问：**“一部网络小说的实体单行本和数字连载版，应该建立两个作品还是一个作品？”**

---

### ✅ 核心原则（LRM / FRBR 标准）：

1. **Work（逻辑作品）**：
   - 代表纯粹的思想创作与概念实体；
   - 题名保持最简纯净（如《三体》而非《三体1精装版》）；
   - 不管是连载版、平装书、精装典藏版还是日文译本，**全部归属于同一个 Work**。

2. **Release（发行版 / 载体表现）**：
   - 代表具体的商品形态、出版批次或数字上架规格；
   - 必须记录 ISBN-13（条形码）、出版机构（Publisher）、出版日期及装帧（Paperback/Hardcover/Digital）。

3. **Medium（物理介质盘片/分卷）**：
   - 解决单次发行包含多个光盘（如 2CD + 1BD）或分卷的问题。

欢迎大家在此帖下继续讨论更多特殊边缘案例的编目规范！
"""
        }
    ]
}


def run_catalog_seed(clean_first: bool = True):
    print("=" * 80)
    print(" MetaFusion 标准 REST API 全量编目与测试数据导入套件")
    print("=" * 80)

    client = MetaFusionApiClient()
    client.login()

    if clean_first:
        client.purge_legacy_catalog()

    # 1. 创作者与机构
    print("\n>>> [1/6] 通过 REST API (POST /catalog/artists) 创增创作者与机构主体...")
    for item in SEED_DATA["artists"]:
        key = item["key"]
        aid = client.create_artist(key, item)
        print(f"  [OK] 创建创作者 [{item['entity_type']}]: {item['name']} -> UUID: {aid}")

    # 2. 企划枢纽
    print("\n>>> [2/6] 通过 REST API (POST /catalog/franchises) 创增跨媒介世界观枢纽...")
    for item in SEED_DATA["franchises"]:
        key = item["key"]
        fid = client.create_franchise(key, item)
        print(f"  [OK] 创建企划: {item['title']} -> UUID: {fid}")

    # 3. 逻辑作品
    print("\n>>> [3/6] 通过 REST API (POST /catalog/works) 创增纯净逻辑作品 (涵盖多媒介)...")
    for item in SEED_DATA["works"]:
        key = item["key"]
        wid = client.create_work(key, item)
        print(f"  [OK] 创建作品 [{item['tags'][0]}]: {item['title']} -> UUID: {wid}")

    # 4. 发行版规格与曲目
    print("\n>>> [4/6] 通过 REST API (POST /catalog/releases & mediums) 创增 LRM 规范发行版本...")
    for item in SEED_DATA["releases"]:
        key = item["key"]
        wkey = item["work_key"]
        rid = client.create_release(key, wkey, item)
        print(f"  [OK] 创建发行版: {item['edition_name']} -> UUID: {rid}")

    # 5. 演职员关系与跨媒介语义边
    print("\n>>> [5/6] 通过 REST API (PUT /catalog/works/:id/relations & entity-relations) 织入图谱关系网络...")
    for wr in SEED_DATA["work_relations"]:
        client.set_work_relations(wr["work_key"], wr["relations"])
    print(f"  [OK] 已建立演职人员/机构关系: {client.stats['work_relations_set']} 条")

    client.set_entity_relations(SEED_DATA["entity_relations"])
    print(f"  [OK] 已建立跨媒介语义边: {client.stats['entity_relations_set']} 条")

    # 6. 社区研讨发帖
    print("\n>>> [6/6] 通过 REST API (POST /community/topics) 发布考据评注与研讨交流主题...")
    for top in SEED_DATA["topics"]:
        tid = client.create_topic(top)
        print(f"  [OK] 发布讨论帖 [{top['board_code']}]: {top['title'][:28]}... -> UUID: {tid}")

    # 汇总输出
    print("\n" + "=" * 80)
    print(" MetaFusion REST API 编目导入套件执行完毕！统计数据：")
    print("=" * 80)
    for k, v in client.stats.items():
        print(f"  • {k:28s}: {v}")
    print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MetaFusion REST API Catalog Seed Suite")
    parser.add_argument("--api-url", default=DEFAULT_API_BASE, help="Backend API base URL")
    parser.add_argument("--username", default=DEFAULT_ADMIN_USER, help="Admin username")
    parser.add_argument("--password", default=DEFAULT_ADMIN_PASS, help="Admin password")
    parser.add_argument("--no-clean", action="store_true", help="Skip purging existing legacy data before seeding")
    args = parser.parse_args()

    clean = not args.no_clean
    run_catalog_seed(clean_first=clean)
