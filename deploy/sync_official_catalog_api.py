#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MetaFusion 核心全媒体数据官方数据校准、高保真原档封面补齐与标准 REST API 同步脚本
=============================================================================
执行准则：
1. 真实高保真封面/海报：
   - 音乐 1:1（高清方封：MusicBrainz CAA / VGMdb / 官方封面）
   - 电影/动画/剧集 2:3（高清竖版海报：TMDB / Bangumi / 官方主视觉）
   - 图书/漫画/轻小说 3:4（单行本/初版高清扫图/官方书封）
2. 操作规范：
   - 必须通过后端标准 REST API（获取 JWT Token -> POST/PUT /catalog/*）
   - 每次提交附带 source_urls 与 edit_note，自动生成 entity_revisions 修订审计
3. 关系网络与官方元数据 100% 严谨完整：
   - 演职人员全谱系（author, illustrator, director, composer, lyricist, arranger, voice_actor, performer, studio, producer, orchestra）
   - 出版社/发行商/厂牌实体（publisher, label, studio）
   - 精确首发日期（YYYY-MM-DD）、规范 ISBN-13、唱片品番（如 VIZL-, DUED-, SRCL-, SVWC-, KICA-, THCA-, PCCG-, LACA-）
   - 跨媒介关系闭环（adapted_from, soundtrack_of, sequel_of, spin_off_of, part_of_franchise）
"""

import sys
import json
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

API_BASE = "http://127.0.0.1/api/v1"
ADMIN_USER = "admin"
ADMIN_PASS = "AdminPassword2026!"


class MetaFusionClient:
    def __init__(self, base_url: str = API_BASE):
        self.base_url = base_url.rstrip("/")
        self.token: Optional[str] = None
        self.stats = {
            "artists_created": 0,
            "artists_updated": 0,
            "works_created": 0,
            "works_updated": 0,
            "releases_created": 0,
            "work_relations_updated": 0,
            "entity_relations_updated": 0,
            "revisions_verified": 0,
        }

    def _request(self, method: str, path: str, data: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        encoded_data = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code} for {method} {url}: {err_body}")

    def login(self, username: str = ADMIN_USER, password: str = ADMIN_PASS) -> str:
        resp = self._request("POST", "/auth/login", {
            "email_or_username": username,
            "password": password
        })
        self.token = resp.get("token")
        if not self.token:
            raise RuntimeError("Login failed: token not found in response")
        print(f"[AUTH] Logged in successfully as {resp.get('user', {}).get('username')} (role: {resp.get('user', {}).get('role')})")
        return self.token

    def get_work(self, work_id: str) -> Optional[dict]:
        try:
            return self._request("GET", f"/catalog/works/{work_id}")
        except Exception:
            return None

    def get_artist(self, artist_id: str) -> Optional[dict]:
        try:
            resp = self._request("GET", f"/catalog/artists/{artist_id}")
            return resp.get("artist", resp)
        except Exception:
            return None

    def upsert_artist(self, artist_id: str, data: dict) -> dict:
        existing = self.get_artist(artist_id)
        if existing:
            update_payload = {
                "name": data.get("name"),
                "original_name": data.get("original_name", ""),
                "disambiguation": data.get("disambiguation", ""),
                "entity_type": data.get("entity_type", "person"),
                "country": data.get("country", ""),
                "biography": data.get("biography", ""),
                "language": data.get("language", "ja"),
                "begin_date": data.get("begin_date", ""),
                "end_date": data.get("end_date", ""),
                "ended": data.get("ended", False),
                "external_ids": data.get("external_ids", {}),
                "edit_note": data.get("edit_note", "官方校准演职人员与出版机构主体档案"),
                "source_urls": data.get("source_urls", []),
                "translations": data.get("translations", [])
            }
            res = self._request("PUT", f"/catalog/artists/{artist_id}", update_payload)
            self.stats["artists_updated"] += 1
            return res
        else:
            create_payload = {
                "id": artist_id,
                "name": data.get("name"),
                "original_name": data.get("original_name", ""),
                "disambiguation": data.get("disambiguation", ""),
                "entity_type": data.get("entity_type", "person"),
                "country": data.get("country", ""),
                "biography": data.get("biography", ""),
                "language": data.get("language", "ja"),
                "external_ids": data.get("external_ids", {}),
                "translations": data.get("translations", [])
            }
            res = self._request("POST", "/catalog/artists", create_payload)
            self.stats["artists_created"] += 1
            return res

    def upsert_work(self, work_id: str, data: dict) -> dict:
        existing = self.get_work(work_id)
        if existing:
            update_payload = {
                "title": data.get("title"),
                "original_title": data.get("original_title", ""),
                "aliases": data.get("aliases", []),
                "release_date": data.get("release_date"),
                "begin_date": data.get("begin_date", data.get("release_date", "")),
                "end_date": data.get("end_date", ""),
                "ended": data.get("ended", False),
                "country": data.get("country", ""),
                "language": data.get("language", "ja"),
                "original_language": data.get("original_language", "ja"),
                "summary": data.get("summary", ""),
                "cover_image_url": data.get("cover_image_url", ""),
                "cover_aspect": data.get("cover_aspect", "2:3"),
                "content_rating": data.get("content_rating", "general"),
                "status": data.get("status", "published"),
                "tags": data.get("tags", []),
                "catalog_metadata": data.get("catalog_metadata", {}),
                "edit_note": data.get("edit_note", "官方数据校准与高保真原档封面补齐"),
                "source_urls": data.get("source_urls", []),
                "translations": data.get("translations", [])
            }
            res = self._request("PUT", f"/catalog/works/{work_id}", update_payload)
            self.stats["works_updated"] += 1
            return res
        else:
            create_payload = {
                "id": work_id,
                "title": data.get("title"),
                "original_title": data.get("original_title", ""),
                "aliases": data.get("aliases", []),
                "release_date": data.get("release_date"),
                "country": data.get("country", ""),
                "language": data.get("language", "ja"),
                "original_language": data.get("original_language", "ja"),
                "summary": data.get("summary", ""),
                "cover_image_url": data.get("cover_image_url", ""),
                "cover_aspect": data.get("cover_aspect", "2:3"),
                "content_rating": data.get("content_rating", "general"),
                "tags": data.get("tags", []),
                "catalog_metadata": data.get("catalog_metadata", {}),
                "translations": data.get("translations", [])
            }
            res = self._request("POST", "/catalog/works", create_payload)
            self.stats["works_created"] += 1
            return res

    def set_work_relations(self, work_id: str, relations: List[dict]) -> dict:
        res = self._request("PUT", f"/catalog/works/{work_id}/relations", {"relations": relations})
        self.stats["work_relations_updated"] += 1
        return res

    def create_release(self, release_data: dict) -> dict:
        res = self._request("POST", "/catalog/releases", release_data)
        self.stats["releases_created"] += 1
        return res

    def set_entity_relations(self, relations: List[dict]) -> dict:
        res = self._request("PUT", "/catalog/entity-relations", {"relations": relations})
        self.stats["entity_relations_updated"] += len(relations)
        return res

    def verify_revisions(self, target_type: str, target_id: str) -> List[dict]:
        res = self._request("GET", f"/catalog/revisions?target_type={target_type}&target_id={target_id}")
        items = res.get("items", [])
        if items:
            self.stats["revisions_verified"] += len(items)
        return items


def run_official_calibration():
    print("=" * 80)
    print(" MetaFusion 核心全媒体数据官方数据校准 & 高保真原档封面补齐 (REST API 升级)")
    print("=" * 80)

    client = MetaFusionClient()
    client.login()

    # -------------------------------------------------------------------------
    # 1. 核心创作者与机构实体字典 (Artists: Creators, Studios, Publishers, Labels)
    # -------------------------------------------------------------------------
    print("\n>>> [1/5] 校准演职人员谱系、核心工作室与出版/唱片机构实体...")

    artists_registry = [
        # --- 刀剑神域 ---
        {
            "id": "deadbeef-0000-4000-8000-000000000201",
            "name": "川原砾",
            "original_name": "川原 礫",
            "disambiguation": "《刀剑神域》《加速世界》轻小说原作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名轻小说作家，第15届电击小说大奖大奖得主。代表作《刀剑神域》《加速世界》《绝对绝望孤岛》。",
            "language": "ja",
            "external_ids": {"official": "https://twitter.com/kunori", "wikidata": "Q553556", "bangumi": "6320"},
            "edit_note": "【官方校准】同步电击文库权威履历与 Bangumi 创作者档案",
            "source_urls": ["https://bgm.tv/person/6320", "https://www.wikidata.org/wiki/Q553556"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000202",
            "name": "abec",
            "original_name": "abec",
            "disambiguation": "《刀剑神域》轻小说插画家 / 角色原案",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本插画家、动画角色原案设计师，负责《刀剑神域》轻小说全系列插画与主要角色原案。",
            "language": "ja",
            "external_ids": {"wikidata": "Q11189445", "bangumi": "6321"},
            "edit_note": "【官方校准】完善 abec 角色设计与插画大师档案",
            "source_urls": ["https://bgm.tv/person/6321"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000203",
            "name": "伊藤智彦",
            "original_name": "伊藤 智彦",
            "disambiguation": "《刀剑神域》《只有我不存在的城市》动画监督",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本动画导演、演出家。师从细田守，执导《刀剑神域》第一季、第二季及剧场版《序列之争》，《世纪末超自然学院》《HELLO WORLD》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q11380104", "bangumi": "3394"},
            "edit_note": "【官方校准】完善监督履历与外部权威数据库标识",
            "source_urls": ["https://bgm.tv/person/3394"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000204",
            "name": "梶浦由记",
            "original_name": "梶浦 由記",
            "disambiguation": "日本著名作曲家 / 音乐制作人 / FictionJunction",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本殿堂级作曲家、音乐制作人，以独特的梶浦语与兼具古典交响与民族史诗风格闻名。代表作《刀剑神域》《Fate/Zero》《魔法少女小圆》《鬼灭之刃》配乐。",
            "language": "ja",
            "external_ids": {"official": "https://fictionjunction.com", "wikidata": "Q234407", "bangumi": "1286", "musicbrainz": "1dd415b3-3a13-43f1-b9db-564593bb28ee"},
            "edit_note": "【官方校准】同步 FictionJunction 官方网站与 MusicBrainz 音乐库档案",
            "source_urls": ["https://fictionjunction.com", "https://musicbrainz.org/artist/1dd415b3-3a13-43f1-b9db-564593bb28ee"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000205",
            "name": "松冈祯丞",
            "original_name": "松岡 禎丞",
            "disambiguation": "日本著名声优 / 桐人 CV",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名男性声优，I'm Enterprise 旗下。代表角色包括《刀剑神域》桐人、《鬼灭之刃》嘴平伊之助、《五等分的新娘》上杉风太郎。",
            "language": "ja",
            "external_ids": {"wikidata": "Q1188166", "bangumi": "5000"},
            "edit_note": "【官方校准】声优档案与角色演职映射",
            "source_urls": ["https://bgm.tv/person/5000"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000206",
            "name": "户松遥",
            "original_name": "戸松 遥",
            "disambiguation": "日本著名声优 / 亚丝娜 CV",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名女性声优、歌手，Music Ray'n 旗下，声优组合 Sphere 成员。代表角色《刀剑神域》亚丝娜（结城明日奈）、《出包王女》菈菈。",
            "language": "ja",
            "external_ids": {"wikidata": "Q236742", "bangumi": "4527"},
            "edit_note": "【官方校准】声优档案与角色演职映射",
            "source_urls": ["https://bgm.tv/person/4527"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000207",
            "name": "A-1 Pictures",
            "original_name": "株式会社A-1 Pictures",
            "disambiguation": "Aniplex 旗下动画制作工作室",
            "entity_type": "studio",
            "country": "日本",
            "biography": "索尼音乐娱乐旗下 Aniplex 的全资动画制作子公司，承制《刀剑神域》《四月是你的谎言》《辉夜大小姐想让我告白》《86 -不存在的战区-》等名作。",
            "language": "ja",
            "external_ids": {"official": "https://a1p.jp", "wikidata": "Q288289", "bangumi": "6006"},
            "edit_note": "【官方校准】动画制作工作室官方档案",
            "source_urls": ["https://a1p.jp"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000213",
            "name": "电击文库",
            "original_name": "電撃文庫",
            "disambiguation": "KADOKAWA 旗下日本第一大轻小说文库厂牌",
            "entity_type": "publisher",
            "country": "日本",
            "biography": "KADOKAWA ASCII Media Works 旗下的轻小说文库品牌，出版了《刀剑神域》《魔法禁书目录》《灼眼的夏娜》《无头骑士异闻录》等开创性作品。",
            "language": "ja",
            "external_ids": {"official": "https://dengekibunko.jp", "wikidata": "Q1152431"},
            "edit_note": "【官方校准】出版文库权威档案",
            "source_urls": ["https://dengekibunko.jp"]
        },

        # --- 葬送的芙莉莲 ---
        {
            "id": "deadbeef-0000-4000-8000-000000000208",
            "name": "山田钟人",
            "original_name": "山田 鐘人",
            "disambiguation": "《葬送的芙莉莲》漫画原作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本漫画原作者，代表作《葬送的芙莉莲》（原作）、《名副其实的孤独星人》。",
            "language": "ja",
            "external_ids": {"bangumi": "38287", "wikidata": "Q106093557"},
            "edit_note": "【官方校准】小学馆连载漫画原作者档案",
            "source_urls": ["https://bgm.tv/person/38287"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000209",
            "name": "阿部司",
            "original_name": "アベツカサ",
            "disambiguation": "《葬送的芙莉莲》漫画作画",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本漫画家、插画家，以精细恬淡的线条与极具表现力的神态刻画著称，代表作《葬送的芙莉莲》（作画）。",
            "language": "ja",
            "external_ids": {"bangumi": "38288", "wikidata": "Q106093563"},
            "edit_note": "【官方校准】漫画作画家权威档案",
            "source_urls": ["https://bgm.tv/person/38288"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000210",
            "name": "斋藤圭一郎",
            "original_name": "斎藤 圭一郎",
            "disambiguation": "《孤独摇滚！》《葬送的芙莉莲》新锐动画监督",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本新生代顶级动画导演、演出家。执导《孤独摇滚！》与《葬送的芙莉莲》均引发全球现象级热潮，以极具创造力的演出技巧与情绪捕捉闻名漫坛。",
            "language": "ja",
            "external_ids": {"bangumi": "29193", "wikidata": "Q115049386"},
            "edit_note": "【官方校准】动画监督权威履历与作品映射",
            "source_urls": ["https://bgm.tv/person/29193"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000211",
            "name": "Evan Call",
            "original_name": "Evan Call",
            "disambiguation": "《紫罗兰永恒花园》《葬送的芙莉莲》配乐作曲家",
            "entity_type": "person",
            "country": "美国",
            "biography": "居住于日本的美国作曲家、编曲家，伯克利音乐学院出身，曾所属 Elements Garden。为《紫罗兰永恒花园》《葬送的芙莉莲》《战姬绝唱》等作品谱写了宏大感人的交响乐章。",
            "language": "en-US",
            "external_ids": {"official": "https://www.evancall.info", "bangumi": "14681", "musicbrainz": "1f8e1ba4-6a06-444f-a496-d2ca0199e52e"},
            "edit_note": "【官方校准】同步 Evan Call 官方网站与 MusicBrainz 音乐库",
            "source_urls": ["https://www.evancall.info", "https://musicbrainz.org/artist/1f8e1ba4-6a06-444f-a496-d2ca0199e52e"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000212",
            "name": "种崎敦美",
            "original_name": "種﨑 敦美",
            "disambiguation": "日本著名声优 / 芙莉莲 / 安妮亚 CV",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本实力派女性声优，东京俳优生活协同组合所属，声优奖最佳主演声优与配角声优双料得主。代表角色《葬送的芙莉莲》芙莉莲、《间谍过家家》安妮亚、《薇薇 -萤石眼之歌-》薇薇。",
            "language": "ja",
            "external_ids": {"wikidata": "Q11649984", "bangumi": "8755"},
            "edit_note": "【官方校准】声优档案与角色配音关联",
            "source_urls": ["https://bgm.tv/person/8755"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000214",
            "name": "MADHOUSE",
            "original_name": "株式会社マッドハウス",
            "disambiguation": "日本老牌老字号动画制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "日本老牌动画制作公司，成立于1972年，制作了《葬送的芙莉莲》《一拳超人 第一季》《死亡笔记》《红辣椒》《穿越时空的少女》等殿堂级名作。",
            "language": "ja",
            "external_ids": {"official": "https://www.madhouse.co.jp", "wikidata": "Q656608", "bangumi": "599"},
            "edit_note": "【官方校准】动画工作室官方档案",
            "source_urls": ["https://www.madhouse.co.jp"]
        },
        {
            "id": "beefc031-0000-4000-8000-000000000103",
            "name": "小学馆",
            "original_name": "株式会社小学館",
            "disambiguation": "日本大型综合出版社 / Sunday系",
            "entity_type": "publisher",
            "country": "日本",
            "biography": "日本综合出版社，旗下拥有《周刊少年Sunday》《Big Comic Spirits》《月刊Sunday-GX》等著名刊物，出版《葬送的芙莉莲》《名侦探柯南》《犬夜叉》等经典漫画。",
            "language": "ja",
            "external_ids": {"official": "https://www.shogakukan.co.jp", "wikidata": "Q271816"},
            "edit_note": "【官方校准】小学馆官方档案",
            "source_urls": ["https://www.shogakukan.co.jp"]
        },

        # --- 孤独摇滚 ---
        {
            "id": "deadbeef-0000-4000-8000-000000000215",
            "name": "滨路晶",
            "original_name": "はまじあき",
            "disambiguation": "《孤独摇滚！》漫画作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本漫画家，在芳文社《Manga Time Kirara MAX》连载《孤独摇滚！》，凭借对社恐心理与独立摇滚文化的精湛融合爆火出圈。",
            "language": "ja",
            "external_ids": {"official": "https://twitter.com/hamazi__", "bangumi": "34994", "wikidata": "Q115049380"},
            "edit_note": "【官方校准】漫画家官方推特与权威条目",
            "source_urls": ["https://bgm.tv/person/34994"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000216",
            "name": "芳文社",
            "original_name": "株式会社芳文社",
            "disambiguation": "日本 Kirara 系萌系日常与四格漫画出版社",
            "entity_type": "publisher",
            "country": "日本",
            "biography": "日本知名漫画出版社，旗下《Manga Time Kirara》系列杂志孕育了《孤独摇滚！》《轻音少女》《摇曳露营△》《请问您今天要来点兔子吗？》等超级IP。",
            "language": "ja",
            "external_ids": {"official": "http://houbunsha.co.jp", "wikidata": "Q1152438"},
            "edit_note": "【官方校准】出版机构官方档案",
            "source_urls": ["http://houbunsha.co.jp"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000217",
            "name": "CloverWorks",
            "original_name": "株式会社CloverWorks",
            "disambiguation": "Aniplex 旗下顶级动画制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "索尼音乐娱乐旗下 Aniplex 动画制作子公司，代表作《孤独摇滚！》《间谍过家家》《更衣人偶坠入爱河》《约定的梦幻岛》。",
            "language": "ja",
            "external_ids": {"official": "https://cloverworks.co.jp", "wikidata": "Q51268305", "bangumi": "30467"},
            "edit_note": "【官方校准】动画制作公司官方档案",
            "source_urls": ["https://cloverworks.co.jp"]
        },

        # --- 紫罗兰永恒花园 ---
        {
            "id": "deadbeef-0000-4000-8000-000000000218",
            "name": "晓佳奈",
            "original_name": "暁 佳奈",
            "disambiguation": "《紫罗兰永恒花园》《春夏秋冬代行者》轻小说作家",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本轻小说作家，凭借《紫罗兰永恒花园》荣获第5届京都动画大奖小说部门大奖（唯一大奖得主）。",
            "language": "ja",
            "external_ids": {"wikidata": "Q30932599", "bangumi": "22472"},
            "edit_note": "【官方校准】晓佳奈小说家权威档案",
            "source_urls": ["https://bgm.tv/person/22472"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000220",
            "name": "京都动画",
            "original_name": "株式会社京都アニメーション",
            "disambiguation": "日本著名动画制作公司 / 京阿尼",
            "entity_type": "studio",
            "country": "日本",
            "biography": "日本殿堂级动画制作公司，以极致作画质量与深刻情感细腻刻画享誉世界。代表作《紫罗兰永恒花园》《CLANNAD》《冰菓》《吹响！上低音号》《轻音少女》。",
            "language": "ja",
            "external_ids": {"official": "https://www.kyotoanimation.co.jp", "wikidata": "Q850125", "bangumi": "1940"},
            "edit_note": "【官方校准】京都动画制作社官方档案",
            "source_urls": ["https://www.kyotoanimation.co.jp"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000221",
            "name": "石立太一",
            "original_name": "石立 太一",
            "disambiguation": "《紫罗兰永恒花园》《境界的彼方》动画监督",
            "entity_type": "person",
            "country": "日本",
            "biography": "京都动画所属资深动画监督、演出家。执导《紫罗兰永恒花园》TV动画与剧场版长片、《境界的彼方》《日常》主要演出。",
            "language": "ja",
            "external_ids": {"wikidata": "Q11586524", "bangumi": "3391"},
            "edit_note": "【官方校准】石立太一监督权威档案",
            "source_urls": ["https://bgm.tv/person/3391"]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000222",
            "name": "石川由依",
            "original_name": "石川 由依",
            "disambiguation": "薇尔莉特 / 三笠 CV / 日本知名声优",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名女性声优、舞台剧演员。声演《紫罗兰永恒花园》薇尔莉特·伊芙加登、《进击的巨人》三笠·阿克曼、《尼尔：机械纪元》2B。",
            "language": "ja",
            "external_ids": {"official": "https://mittworld.com/talent/yui-ishikawa/", "wikidata": "Q8968478", "bangumi": "5119"},
            "edit_note": "【官方校准】石川由依声优档案与角色映射",
            "source_urls": ["https://bgm.tv/person/5119"]
        },

        # --- 进击的巨人 ---
        {
            "id": "beefc031-0000-4000-8000-000000000234",
            "name": "谏山创",
            "original_name": "諫山 創",
            "disambiguation": "《进击的巨人》漫画原作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名漫画家，代表作《进击的巨人》（Attack on Titan），全球发行量突破1.4亿册，讲谈社漫画奖得主。",
            "language": "ja",
            "external_ids": {"wikidata": "Q2415174", "bangumi": "6323"},
            "edit_note": "【官方校准】漫画家权威档案",
            "source_urls": ["https://bgm.tv/person/6323"]
        },
        {
            "id": "beefc031-0000-4000-8000-000000000235",
            "name": "荒木哲郎",
            "original_name": "荒木 哲郎",
            "disambiguation": "《进击的巨人》《死亡笔记》《罪恶王冠》动画监督",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本知名动画监督、演出家，WIT STUDIO 所属核心导演，以凌厉的立体机动镜头语言与高强度戏剧张力享誉国际。",
            "language": "ja",
            "external_ids": {"wikidata": "Q3543949", "bangumi": "2055"},
            "edit_note": "【官方校准】动画监督权威履历",
            "source_urls": ["https://bgm.tv/person/2055"]
        },
        {
            "id": "beefc031-0000-4000-8000-000000000236",
            "name": "泽野弘之",
            "original_name": "澤野 弘之",
            "disambiguation": "《进击的巨人》《机动战士高达UC》《罪恶王冠》配乐大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名作曲家、编曲家、音乐制作人，以宏大震撼的交响摇滚乐风与人声合唱被称为“燃曲教父”。代表作《进击的巨人》《高达UC》《青之驱魔师》《Kill la Kill》配乐。",
            "language": "ja",
            "external_ids": {"official": "https://www.sawanohiroyuki.com", "wikidata": "Q1188337", "bangumi": "3045", "musicbrainz": "439cf5c7-9750-4df2-a9b0-4dbb83e6027c"},
            "edit_note": "【官方校准】同步泽野弘之官方网站与 MusicBrainz 音乐库",
            "source_urls": ["https://www.sawanohiroyuki.com", "https://musicbrainz.org/artist/439cf5c7-9750-4df2-a9b0-4dbb83e6027c"]
        },
        {
            "id": "beefc031-0000-4000-8000-000000000237",
            "name": "WIT STUDIO",
            "original_name": "株式会社ウィットスタジオ",
            "disambiguation": "《进击的巨人》《间谍过家家》《冰海战记》动画制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "IG Port 旗下著名动画制作公司，制作了《进击的巨人》前三季、《甲铁城的卡巴内利》《冰海战记》《国王排名》等高水准动画。",
            "language": "ja",
            "external_ids": {"official": "https://www.witstudio.co.jp", "wikidata": "Q11352528", "bangumi": "8782"},
            "edit_note": "【官方校准】动画制作公司官方档案",
            "source_urls": ["https://www.witstudio.co.jp"]
        },

        # --- 新世纪福音战士 ---
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000240",
            "name": "庵野秀明",
            "original_name": "庵野 秀明",
            "disambiguation": "《新世纪福音战士》《新·哥斯拉》总监督 / 动画大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本殿堂级动画导演、电影导演、实业家，Studio Khara 创始人。开创《新世纪福音战士》神话，执导《飞跃巅峰》《新·假面骑士》《新·奥特曼》。",
            "language": "ja",
            "external_ids": {"official": "https://www.khara.co.jp", "wikidata": "Q285130", "bangumi": "194"},
            "edit_note": "【官方校准】庵野秀明大师权威档案",
            "source_urls": ["https://www.khara.co.jp", "https://bgm.tv/person/194"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000241",
            "name": "鹭巢诗郎",
            "original_name": "鷺巣 詩郎",
            "disambiguation": "《新世纪福音战士》《死神 BLEACH》配乐作曲家",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名作曲家、编曲家、音乐制作人，以宏伟的古典宗教合唱与爵士管弦乐闻名。代表作《EVA》全系列配乐、《死神》《新·哥斯拉》《蓝宝石之谜》。",
            "language": "ja",
            "external_ids": {"official": "https://ro-jam.blog.ss-blog.jp", "wikidata": "Q1194301", "bangumi": "1284", "musicbrainz": "c356247c-7a91-4cf1-8302-3c8eb72e21b7"},
            "edit_note": "【官方校准】EVA 配乐大师官方档案与 MusicBrainz",
            "source_urls": ["https://musicbrainz.org/artist/c356247c-7a91-4cf1-8302-3c8eb72e21b7"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000242",
            "name": "Studio Khara",
            "original_name": "株式会社カラー",
            "disambiguation": "庵野秀明创立之 EVA 新剧场版制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "由庵野秀明于2006年创立的动画制作公司，主导制作《福音战士新剧场版》四部曲（序、破、Q、终）。",
            "language": "ja",
            "external_ids": {"official": "https://www.khara.co.jp", "wikidata": "Q1140924", "bangumi": "3146"},
            "edit_note": "【官方校准】Studio Khara 官方工作室档案",
            "source_urls": ["https://www.khara.co.jp"]
        },

        # --- 星际穿越 ---
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000201",
            "name": "克里斯托弗·诺兰",
            "original_name": "Christopher Nolan",
            "disambiguation": "英国电影导演 / 编剧 / 奥斯卡最佳导演",
            "entity_type": "person",
            "country": "英国",
            "biography": "世界殿堂级当代电影导演、编剧与制片人。以实拍哲学、非线性叙事与硬科幻探索著称。代表作《星际穿越》《奥本海默》《盗梦空间》《黑暗骑士三部曲》《记忆碎片》。",
            "language": "en-US",
            "external_ids": {"wikidata": "Q25142", "imdb": "nm0634240", "tmdb": "525"},
            "edit_note": "【官方校准】诺兰导演权威档案与 TMDB 标识",
            "source_urls": ["https://www.themoviedb.org/person/525-christopher-nolan"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000202",
            "name": "汉斯·季默",
            "original_name": "Hans Zimmer",
            "disambiguation": "世界级电影配乐大师 / 奥斯卡最佳原创配乐",
            "entity_type": "person",
            "country": "德国",
            "biography": "传奇德国电影配乐作曲家，奥斯卡奖与格莱美奖得主。代表作《星际穿越》《沙丘》《狮子王》《盗梦空间》《角斗士》《加勒比海盗》配乐。",
            "language": "en-US",
            "external_ids": {"official": "https://hans-zimmer.com", "wikidata": "Q76364", "musicbrainz": "e6ca5241-097c-4141-86db-7a62d466caee"},
            "edit_note": "【官方校准】配乐大师官网档案与 MusicBrainz",
            "source_urls": ["https://hans-zimmer.com", "https://musicbrainz.org/artist/e6ca5241-097c-4141-86db-7a62d466caee"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000203",
            "name": "华纳兄弟影业",
            "original_name": "Warner Bros. Pictures",
            "disambiguation": "美国好莱坞百年制片与发行巨头",
            "entity_type": "publisher",
            "country": "美国",
            "biography": "华纳兄弟探索旗下核心电影制片厂与全球发行机构，成立于1923年，出品无数世界影史丰碑作品。",
            "language": "en-US",
            "external_ids": {"official": "https://www.warnerbros.com", "wikidata": "Q376150"},
            "edit_note": "【官方校准】电影发行商官方档案",
            "source_urls": ["https://www.warnerbros.com"]
        },

        # --- 攻壳机动队 ---
        {
            "id": "beefc031-0000-4000-8000-000000000229",
            "name": "士郎正宗",
            "original_name": "士郎 正宗",
            "disambiguation": "《攻壳机动队》《苹果核战记》漫画原作者",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名硬科幻与赛博朋克漫画家，深刻探讨义体化、网络意识与灵魂（Ghost）哲学，对全球赛博朋克科幻产生极其深远的影响。",
            "language": "ja",
            "external_ids": {"wikidata": "Q360662", "bangumi": "1931"},
            "edit_note": "【官方校准】漫画家权威档案",
            "source_urls": ["https://bgm.tv/person/1931"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000239",
            "name": "押井守",
            "original_name": "押井 守",
            "disambiguation": "《攻壳机动队》《机动警察》电影导演 / 哲思宗师",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本殿堂级电影与动画导演，以极具哲学深度的意象、长镜头与声画结合著称。执导1995版《攻壳机动队》《攻壳机动队2：无罪》《机动警察》剧场版。",
            "language": "ja",
            "external_ids": {"wikidata": "Q285097", "bangumi": "224"},
            "edit_note": "【官方校准】押井守导演权威档案",
            "source_urls": ["https://bgm.tv/person/224"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000249",
            "name": "川井宪次",
            "original_name": "川井 憲次",
            "disambiguation": "《攻壳机动队》《机动警察》《叶问》配乐作曲家",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本著名配乐作曲家、音乐制作人。为《攻壳机动队》谱写了融合保加利亚民歌合唱与日本神道大鼓的传世经典《傀儡谣》。",
            "language": "ja",
            "external_ids": {"official": "https://www.kenjikawai.com", "wikidata": "Q439634", "bangumi": "787", "musicbrainz": "172ea250-93bf-4f11-8be8-75b4dbf4ecab"},
            "edit_note": "【官方校准】川井宪次官方网站与 MusicBrainz 档案",
            "source_urls": ["https://www.kenjikawai.com", "https://musicbrainz.org/artist/172ea250-93bf-4f11-8be8-75b4dbf4ecab"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000259",
            "name": "Production I.G",
            "original_name": "株式会社プロダクション・アイジー",
            "disambiguation": "《攻壳机动队》《排球少年！！》《心理测量者》动画制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "日本顶级动画制作公司，成立于1987年，以极致的数码作画与高科技动画制作水准享誉全球。",
            "language": "ja",
            "external_ids": {"official": "https://www.production-ig.co.jp", "wikidata": "Q737860", "bangumi": "454"},
            "edit_note": "【官方校准】Production I.G 官方档案",
            "source_urls": ["https://www.production-ig.co.jp"]
        },

        # --- 千与千寻 ---
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000236",
            "name": "宫崎骏",
            "original_name": "宮﨑 駿",
            "disambiguation": "吉卜力工作室联合创始人 / 奥斯卡终身成就奖动画大师",
            "entity_type": "person",
            "country": "日本",
            "biography": "世界动画电影泰斗、漫画家，吉卜力工作室核心领袖。代表作《千与千寻》《幽灵公主》《风之谷》《龙猫》《哈尔的移动城堡》《你想活出怎样的人生》。",
            "language": "ja",
            "external_ids": {"wikidata": "Q55400", "bangumi": "193"},
            "edit_note": "【官方校准】宫崎骏大师权威档案",
            "source_urls": ["https://bgm.tv/person/193"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000237",
            "name": "久石让",
            "original_name": "久石 譲",
            "disambiguation": "世界级配乐大师 / 钢琴家 / 指挥家",
            "entity_type": "person",
            "country": "日本",
            "biography": "日本国宝级作曲家、钢琴家、指挥家，与宫崎骏、北野武长期深度合作。代表作《千与千寻》《幽灵公主》《菊次郎的夏天》《天空之城》《哈尔的移动城堡》配乐。",
            "language": "ja",
            "external_ids": {"official": "https://joehisaishi.com", "wikidata": "Q275900", "bangumi": "1190", "musicbrainz": "1a69ea1e-cf61-46ab-a50d-6161474ec800"},
            "edit_note": "【官方校准】久石让官方网站与 MusicBrainz 音乐库",
            "source_urls": ["https://joehisaishi.com", "https://musicbrainz.org/artist/1a69ea1e-cf61-46ab-a50d-6161474ec800"]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000238",
            "name": "吉卜力工作室",
            "original_name": "株式会社スタジオジブリ",
            "disambiguation": "日本殿堂级手绘动画电影制作公司",
            "entity_type": "studio",
            "country": "日本",
            "biography": "由宫崎骏、高畑勋、铃木敏夫创立的手绘动画电影公司，两次斩获奥斯卡最佳动画长片奖。",
            "language": "ja",
            "external_ids": {"official": "https://www.ghibli.jp", "wikidata": "Q182744", "bangumi": "452"},
            "edit_note": "【官方校准】吉卜力工作室官方档案",
            "source_urls": ["https://www.ghibli.jp"]
        },

        # --- 三体 ---
        {
            "id": "00000000-0000-0000-0000-000000000201",
            "name": "刘慈欣",
            "original_name": "刘慈欣",
            "disambiguation": "中国科幻第一人 / 雨果奖最佳长篇小说得主",
            "entity_type": "person",
            "country": "中国",
            "biography": "中国当代著名科幻作家，首位荣获雨果奖最佳长篇小说的亚洲作家。代表作《三体》三部曲、《流浪地球》《乡村教师》《球状闪电》。",
            "language": "zh-CN",
            "external_ids": {"wikidata": "Q607584", "bangumi": "19491"},
            "edit_note": "【官方校准】刘慈欣作家权威档案",
            "source_urls": ["https://bgm.tv/person/19491"]
        },
        {
            "id": "00000000-0000-0000-0000-000000000202",
            "name": "重庆出版社",
            "original_name": "重庆出版社",
            "disambiguation": "《三体》中文原版出版机构",
            "entity_type": "publisher",
            "country": "中国",
            "biography": "中国知名综合性出版社，策划出版了中国科幻基石《三体》三部曲单行本。",
            "language": "zh-CN",
            "external_ids": {"wikidata": "Q10874558"},
            "edit_note": "【官方校准】出版社官方档案",
            "source_urls": ["http://www.cqph.com"]
        }
    ]

    for artist_info in artists_registry:
        client.upsert_artist(artist_info["id"], artist_info)

    print(f"-> 创作者主体校准完成，更新/建立: {client.stats['artists_updated'] + client.stats['artists_created']} 个主体")

    # -------------------------------------------------------------------------
    # 2. 核心作品数据校准与高保真封面补齐 (Works)
    # -------------------------------------------------------------------------
    print("\n>>> [2/5] 校准全媒体作品元数据、精准日期、官方多语言与高保真黄金比例原档封面...")

    works_registry = [
        # ==========================================
        # 1. 刀剑神域 (Sword Art Online)
        # ==========================================
        {
            "id": "deadbeef-0000-4000-8000-000000000101",
            "title": "刀剑神域",
            "original_title": "ソードアート・オンライン",
            "aliases": ["Sword Art Online", "SAO", "刀剑"],
            "release_date": "2009-04-10",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "川原砾创作、abec插画的科幻轻小说开山之作。以完全潜行虚拟现实技术为背景，讲述近万名玩家被囚禁于死亡游戏「艾恩葛朗特」中展开的生死冒险。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/7b/d2/3352_9W1jU.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["轻小说", "科幻", "冒险", "虚拟现实", "刀剑神域"],
            "edit_note": "【官方校准】电击文库首发出版档案(2009-04-10)、abec原画初版封面(3:4比例)与Bangumi权威文献条目",
            "source_urls": ["https://www.swordart-online.net", "https://bgm.tv/subject/3352", "https://dengekibunko.jp/title/sao/"],
            "translations": [
                {"locale": "zh-CN", "title": "刀剑神域", "summary": "以完全潜行VRMMORPG为舞台的开创性轻小说史诗。"},
                {"locale": "en-US", "title": "Sword Art Online", "summary": "Legendary sci-fi VRMMORPG light novel series written by Reki Kawahara with illustrations by abec."},
                {"locale": "ja", "title": "ソードアート・オンライン", "summary": "川原礫による日本のライトノベル。イラストはabecが担当。電撃文庫刊。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000102",
            "title": "刀剑神域",
            "original_title": "ソードアート・オンライン",
            "aliases": ["Sword Art Online Anime", "SAO S1"],
            "release_date": "2012-07-08",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "由 A-1 Pictures 制作、伊藤智彦执导的 TV 动画第1季。涵盖艾恩葛朗特篇与妖精之舞篇，梶浦由记操刀史诗级配乐，全球现象级动画杰作。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/f5/a8/23837_vMv7v.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "科幻", "冒险", "热血", "刀剑神域"],
            "edit_note": "【官方校准】TV动画官方首播公映日、Aniplex 官方主视觉海报(2:3竖版)与演职人员关联",
            "source_urls": ["https://www.swordart-online.net/aincrad/", "https://bgm.tv/subject/23837"],
            "translations": [
                {"locale": "zh-CN", "title": "刀剑神域", "summary": "A-1 Pictures 制作的经典 TV 动画第一季。"},
                {"locale": "en-US", "title": "Sword Art Online (Anime Series)", "summary": "Hit anime television series produced by A-1 Pictures, directed by Tomohiko Ito with music by Yuki Kajiura."},
                {"locale": "ja", "title": "ソードアート・オンライン (アニメ)", "summary": "A-1 Pictures制作によるTVアニメ第1期。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000103",
            "title": "刀剑神域：序列之争",
            "original_title": "劇場版 ソードアート・オンライン -オーディナル・スケール-",
            "aliases": ["Ordinal Scale", "刀剑神域 剧场版"],
            "release_date": "2017-02-18",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "川原砾全新原创故事的剧场版长片动画。描绘 AR 增强现实专用终端「Augma」风靡的次世代东京，桐人等人卷入致命阴谋的决战。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/7f/75/150125_bI7gB.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["动画电影", "科幻", "冒险", "剧场版", "刀剑神域"],
            "edit_note": "【官方校准】剧场版日本官方上映日(2017-02-18)、原厂主海报(2:3比例)与演职全谱系",
            "source_urls": ["https://sao-movie.net/", "https://bgm.tv/subject/150125"],
            "translations": [
                {"locale": "zh-CN", "title": "刀剑神域：序列之争", "summary": "以 AR 增强现实为舞台的原创高燃剧场版。"},
                {"locale": "en-US", "title": "Sword Art Online: Ordinal Scale", "summary": "Theatrical anime film set after SAO II, centering on the AR device Augma."},
                {"locale": "ja", "title": "劇場版 ソードアート・オンライン -オーディナル・スケール-", "summary": "川原礫書き下ろし完全新作ストーリーによる劇場アニメ。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000104",
            "title": "Sword Art Online Music Collection",
            "original_title": "ソードアート・オンライン ミュージックコレクション",
            "aliases": ["SAO OST", "刀剑神域 原声音乐典藏"],
            "release_date": "2016-01-27",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "收录梶浦由记为《刀剑神域》第一季、第二季及 Extra Edition 谱写的全部131首原声交响与配乐，包含全彩册与高清母带重制。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/2a/2d/154743_jp.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "原声带", "交响原声", "刀剑神域"],
            "edit_note": "【官方校准】Aniplex 4CD限定版官方品番(SVWC-70116~9)、方封原档(1:1)与VGMdb权威档案",
            "source_urls": ["https://vgmdb.net/album/55122", "https://bgm.tv/subject/154743"],
            "translations": [
                {"locale": "zh-CN", "title": "Sword Art Online Music Collection", "summary": "梶浦由记操刀的刀剑神域 4CD 原声音乐大典。"},
                {"locale": "en-US", "title": "Sword Art Online Music Collection", "summary": "Complete 4-disc soundtrack compilation composed by Yuki Kajiura."},
                {"locale": "ja", "title": "ソードアート・オンライン ミュージックコレクション", "summary": "劇伴作家・梶浦由記が手掛けた劇伴全131曲を収録した決定盤。"}
            ]
        },

        # ==========================================
        # 2. 葬送的芙莉莲 (Frieren)
        # ==========================================
        {
            "id": "deadbeef-0000-4000-8000-000000000105",
            "title": "葬送的芙莉莲",
            "original_title": "葬送のフリーレン",
            "aliases": ["Frieren: Beyond Journey's End", "芙莉莲"],
            "release_date": "2020-04-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "山田钟人原作、阿部司作画的现象级奇幻后日谈漫画。讲述打倒魔王后的精灵魔法使芙莉莲在漫长岁月中追寻逝去勇者记忆与人类情感的宏大史诗。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/55/54/304417_F5j6m.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["漫画", "奇幻", "冒险", "治愈", "葬送的芙莉莲"],
            "edit_note": "【官方校准】小学馆少年Sunday连载首发(2020-04-28)、单行本初版高清扫图(3:4比例)与Bangumi权威档案",
            "source_urls": ["https://websunday.net/work/708/", "https://bgm.tv/subject/304417"],
            "translations": [
                {"locale": "zh-CN", "title": "葬送的芙莉莲", "summary": "荣获漫画大奖2021第一名的后日谈奇幻史诗。"},
                {"locale": "en-US", "title": "Frieren: Beyond Journey's End", "summary": "Acclaimed fantasy manga by Kanehito Yamada and Tsukasa Abe."},
                {"locale": "ja", "title": "葬送のフリーレン", "summary": "山田鐘人原作、アベツカサ作画による日本の漫画作品。『週刊少年サンデー』連載。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000106",
            "title": "葬送的芙莉莲",
            "original_title": "葬送のフリーレン",
            "aliases": ["Frieren Anime", "葬送的芙莉莲 TV动画"],
            "release_date": "2023-09-29",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "MADHOUSE 制作、斋藤圭一郎执导、Evan Call 配乐的殿堂级 TV 动画。以极高水准的作画、镜头语言与悠扬交响乐征服全球观众，斩获评分榜首。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/6a/a2/399868_W126q.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "奇幻", "冒险", "治愈", "葬送的芙莉莲"],
            "edit_note": "【官方校准】日本电视台首播公映(2023-09-29)、东宝官方主视觉海报(2:3竖版)与演职人员关联",
            "source_urls": ["https://frieren-anime.jp/", "https://bgm.tv/subject/399868"],
            "translations": [
                {"locale": "zh-CN", "title": "葬送的芙莉莲", "summary": "MADHOUSE 与斋藤圭一郎监督倾力打造的动画杰作。"},
                {"locale": "en-US", "title": "Frieren: Beyond Journey's End (Anime)", "summary": "Masterpiece anime adaptation directed by Keiichiro Saito and animated by MADHOUSE."},
                {"locale": "ja", "title": "葬送のフリーレン (アニメ)", "summary": "マッドハウス制作、斎藤圭一郎監督によるテレビアニメーション。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000107",
            "title": "TV 动画「葬送的芙莉莲」Original Soundtrack",
            "original_title": "TVアニメ『葬送のフリーレン』Original Soundtrack",
            "aliases": ["Frieren OST", "葬送的芙莉莲 原声带"],
            "release_date": "2024-04-17",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "Evan Call 倾心谱写并远赴欧洲交响乐团实录的2CD原声大碟，包含《Zoltraak》《Time Flows Ever Onward》等全70首经典配乐。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/c5/4b/472852_9qK9V.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "原声带", "管弦乐", "交响原声", "葬送的芙莉莲"],
            "edit_note": "【官方校准】东宝 TOHO animation RECORDS 品番(THCA-60288)、高清方封(1:1)与VGMdb权威档案",
            "source_urls": ["https://vgmdb.net/album/134444", "https://bgm.tv/subject/472852"],
            "translations": [
                {"locale": "zh-CN", "title": "TV 动画「葬送的芙莉莲」Original Soundtrack", "summary": "Evan Call 谱写的欧洲交响实录 2CD 原声大碟。"},
                {"locale": "en-US", "title": "Frieren: Beyond Journey's End Original Soundtrack", "summary": "Breathtaking orchestral score composed by Evan Call for the anime adaptation."},
                {"locale": "ja", "title": "TVアニメ『葬送のフリーレン』Original Soundtrack", "summary": "Evan Callによる珠玉の劇伴全70曲を収録したオリジナルサウンドトラック。"}
            ]
        },

        # ==========================================
        # 3. 孤独摇滚！(Bocchi the Rock!)
        # ==========================================
        {
            "id": "deadbeef-0000-4000-8000-000000000108",
            "title": "孤独摇滚！",
            "original_title": "ぼっち・ざ・ろっく！",
            "aliases": ["Bocchi the Rock!", "波奇酱", "结束乐队"],
            "release_date": "2017-12-19",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "滨路晶创作的四格音乐漫画。极度社恐的吉他少女后藤一里加入下北泽女高乐队「结束乐队」，在 Livehouse 挥洒青春的爆笑励志物语。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/9b/65/274457_0e6Z9.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["漫画", "日常", "流行摇滚", "搞笑", "孤独摇滚"],
            "edit_note": "【官方校准】芳文社首发连载(2017-12-19)、第1卷高清单行本封面(3:4比例)与Bangumi权威档案",
            "source_urls": ["http://www.dokidokivisual.com/comics/book/past.php?cid=1443", "https://bgm.tv/subject/274457"],
            "translations": [
                {"locale": "zh-CN", "title": "孤独摇滚！", "summary": "芳文社现象级少女摇滚四格漫画。"},
                {"locale": "en-US", "title": "Bocchi the Rock!", "summary": "Hit 4-panel manga by Aki Hamaji about an anxious guitarist and her indie rock band."},
                {"locale": "ja", "title": "ぼっち・ざ・ろっく！", "summary": "はまじあきによる日本の4コマ漫画作品。『まんがタイムきららMAX』連載。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000109",
            "title": "孤独摇滚！",
            "original_title": "ぼっち・ざ・ろっく！",
            "aliases": ["BOCCHI THE ROCK! Anime"],
            "release_date": "2022-10-09",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "CloverWorks 制作、斋藤圭一郎监督的现象级音乐动画。凭借天马行空的实拍定格实验演出、硬核 J-Rock 现场重现与精准社恐共鸣风靡全球。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/54/12/328114_Y73q7.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "日常", "流行摇滚", "搞笑", "孤独摇滚"],
            "edit_note": "【官方校准】TOKYO MX 官方首播日(2022-10-09)、Aniplex 官方竖版海报(2:3)与演职全谱系",
            "source_urls": ["https://bocchi.rocks/", "https://bgm.tv/subject/328114"],
            "translations": [
                {"locale": "zh-CN", "title": "孤独摇滚！", "summary": "CloverWorks 制作的现象级摇滚音乐动画。"},
                {"locale": "en-US", "title": "Bocchi the Rock! (Anime Series)", "summary": "Critically acclaimed music anime by CloverWorks directed by Keiichiro Saito."},
                {"locale": "ja", "title": "ぼっち・ざ・ろっく！ (アニメ)", "summary": "CloverWorks制作によるテレビアニメ。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000110",
            "title": "結束バンド",
            "original_title": "結束バンド",
            "aliases": ["Kessoku Band", "结束乐队同名专辑"],
            "release_date": "2022-12-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "动画《孤独摇滚！》中结束乐队的出道录音室同名大碟。收录《若能化为星座》《青春情结》《忘却之歌》《吉他、孤独与蓝色星球》等全14首热单，问鼎日本 Billboard 榜首。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/7f/73/404285_8wS88.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "流行摇滚", "独立音乐", "孤独摇滚"],
            "edit_note": "【官方校准】Aniplex 初版实体CD品番(SVWC-70613)、方封原档(1:1)与MusicBrainz/Oricon权威榜单",
            "source_urls": ["https://bocchi.rocks/music/cd.html", "https://bgm.tv/subject/404285"],
            "translations": [
                {"locale": "zh-CN", "title": "結束バンド", "summary": "登顶日本 Billboard 榜首的结束乐队首张全长同名大碟。"},
                {"locale": "en-US", "title": "Kessoku Band", "summary": "Chart-topping debut full-length album by Kessoku Band featuring 14 hit tracks."},
                {"locale": "ja", "title": "結束バンド (アルバム)", "summary": "TVアニメ『ぼっち・ざ・ろっく！』の劇中バンド「結束バンド」によるフルアルバム。"}
            ]
        },

        # ==========================================
        # 4. 进击的巨人 (Attack on Titan)
        # ==========================================
        {
            "id": "deadbeef-0000-4000-8000-000000000117",
            "title": "进击的巨人",
            "original_title": "進撃の巨人",
            "aliases": ["Attack on Titan", "AOT", "巨人"],
            "release_date": "2009-09-09",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "谏山创创作的黑暗奇幻史诗漫画。讲述人类被围困于三重高墙之内，少年艾伦·耶格尔目睹母亲被巨人吞食后誓要驱逐所有巨人的悲壮抗争史诗。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/21/df/4774_XpC1c.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["漫画", "热血", "暗黑", "冒险", "进击的巨人"],
            "edit_note": "【官方校准】讲谈社别册少年Magazine创刊号首发(2009-09-09)、第1卷初版封面(3:4比例)与Bangumi权威档案",
            "source_urls": ["https://shonenmagazine.com/special_page/shingeki", "https://bgm.tv/subject/4774"],
            "translations": [
                {"locale": "zh-CN", "title": "进击的巨人", "summary": "谏山创全球销量突破1.4亿册的黑暗奇幻漫画神作。"},
                {"locale": "en-US", "title": "Attack on Titan", "summary": "Global phenomenon dark fantasy manga series by Hajime Isayama."},
                {"locale": "ja", "title": "進撃の巨人", "summary": "諫山創による日本のダークファンタジー漫画。『別冊少年マガジン』連載。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000118",
            "title": "进击的巨人",
            "original_title": "進撃の巨人",
            "aliases": ["Attack on Titan Season 1", "巨人动画第一季"],
            "release_date": "2013-04-07",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "WIT STUDIO 制作、荒木哲郎监督、泽野弘之配乐的 TV 动画第1季。以极其惊艳的立体机动装置动作戏、震撼人心的交响燃曲引爆全球风潮。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/b8/0a/55122_Ggw9Q.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "热血", "暗黑", "冒险", "进击的巨人"],
            "edit_note": "【官方校准】MBS 首播公映(2013-04-07)、波丽佳音官方超清巨壁海报(2:3竖版)与演职全谱系",
            "source_urls": ["https://shingeki.tv/", "https://bgm.tv/subject/55122"],
            "translations": [
                {"locale": "zh-CN", "title": "进击的巨人", "summary": "WIT STUDIO 打造的现象级 TV 动画第1季。"},
                {"locale": "en-US", "title": "Attack on Titan (Anime Season 1)", "summary": "Blockbuster anime television series produced by WIT STUDIO and directed by Tetsuro Araki."},
                {"locale": "ja", "title": "進撃の巨人 (アニメ第1期)", "summary": "WIT STUDIO制作、荒木哲郎監督によるTVアニメ第1期。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000119",
            "title": "「進撃の巨人」Original Soundtrack",
            "original_title": "「進撃の巨人」オリジナルサウンドトラック",
            "aliases": ["Attack on Titan OST", "巨人原声带", "Vogel im Käfig"],
            "release_date": "2013-06-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "泽野弘之作曲的史诗级原声大碟。收录《ətˈæk 0N tάɪtn》《Vogel im Käfig》《立body機motion》等16首宏大交响合唱名曲。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/8e/3c/69877_jp.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "原声带", "交响原声", "进击的巨人"],
            "edit_note": "【官方校准】波丽佳音 Pony Canyon 品番(PCCG-01351)、方封原档(1:1)与VGMdb权威档案",
            "source_urls": ["https://vgmdb.net/album/38827", "https://bgm.tv/subject/69877"],
            "translations": [
                {"locale": "zh-CN", "title": "「進撃の巨人」Original Soundtrack", "summary": "泽野弘之燃曲交响巅峰之作。"},
                {"locale": "en-US", "title": "Attack on Titan Original Soundtrack", "summary": "Epic orchestral and vocal score composed by Hiroyuki Sawano."},
                {"locale": "ja", "title": "「進撃の巨人」オリジナルサウンドトラック", "summary": "澤野弘之によるTVアニメ『進撃の巨人』劇伴を収録したサウンドトラック。"}
            ]
        },

        # ==========================================
        # 5. 新世纪福音战士 (Neon Genesis Evangelion)
        # ==========================================
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000140",
            "title": "新世纪福音战士",
            "original_title": "新世紀エヴァンゲリオン",
            "aliases": ["Neon Genesis Evangelion", "EVA", "新世纪天鹰战士"],
            "release_date": "1995-10-04",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "庵野秀明监督、GAINAX 制作的日本动画史划时代丰碑神作。以人类补完计划、使徒袭击与少年内心情感困境开创了后现代心理意识流动画新纪元。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/34/00/265_J6J6z.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "科幻", "机战", "暗黑", "新世纪福音战士"],
            "edit_note": "【官方校准】东京电视台首播日(1995-10-04)、King Records 官方主视觉海报(2:3竖版)与演职全谱系",
            "source_urls": ["https://www.evangelion.co.jp/", "https://bgm.tv/subject/265"],
            "translations": [
                {"locale": "zh-CN", "title": "新世纪福音战士", "summary": "日本动画史上里程碑级哲学意识流神作。"},
                {"locale": "en-US", "title": "Neon Genesis Evangelion", "summary": "Landmark mecha psychological anime series created by Hideaki Anno and GAINAX."},
                {"locale": "ja", "title": "新世紀エヴァンゲリオン", "summary": "庵野秀明監督、GAINAX制作による伝説的SFアニメーション作品。"}
            ]
        },
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000150",
            "title": "新·福音战士剧场版：终",
            "original_title": "シン・エヴァンゲリオン劇場版:||",
            "aliases": ["Evangelion: 3.0+1.0 Thrice Upon a Time", "EVA终", "新剧场版终"],
            "release_date": "2021-03-08",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "庵野秀明总监督、Studio Khara 制作的新剧场版四部曲完结篇。为历时26年的《新世纪福音战士》传奇画上温柔圆满的终章，日本本土票房斩获102.8亿日元。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/21/cf/4379_t9j5r.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["动画电影", "科幻", "机战", "剧场版", "新世纪福音战士"],
            "edit_note": "【官方校准】日本院线首映日(2021-03-08)、白沙滩官方最终版主海报(2:3比例)与演职全谱系",
            "source_urls": ["https://www.evangelion.co.jp/final.html", "https://bgm.tv/subject/4379"],
            "translations": [
                {"locale": "zh-CN", "title": "新·福音战士剧场版：终", "summary": "EVA 跨越26载传奇历程的盛大终章。"},
                {"locale": "en-US", "title": "Evangelion: 3.0+1.0 Thrice Upon a Time", "summary": "Epic conclusion to the Rebuild of Evangelion film tetralogy directed by Hideaki Anno."},
                {"locale": "ja", "title": "シン・エヴァンゲリオン劇場版:||", "summary": "『ヱヴァンゲリヲン新劇場版』シリーズ全4部作の完結編。"}
            ]
        },

        # ==========================================
        # 6. 星际穿越 (Interstellar)
        # ==========================================
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000101",
            "title": "星际穿越",
            "original_title": "Interstellar",
            "aliases": ["星际效应", "星际启示录"],
            "release_date": "2014-11-07",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "克里斯托弗·诺兰执导、马修·麦康纳与安妮·海瑟薇主演的硬科幻史诗巨制。基于诺贝尔奖物理学家基普·索恩虫洞与黑洞引力理论，讲述人类为寻找宜居星球跨越时空与五维空间的爱与奉献。",
            "cover_image_url": "https://image.tmdb.org/t/p/original/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["电影", "科幻", "冒险", "硬科幻", "太空"],
            "edit_note": "【官方校准】华纳兄弟/派拉蒙全球公映档案(2014-11-07)、TMDB 原版高清海报(2:3竖版)与演职人员关联",
            "source_urls": ["https://www.warnerbros.com/movies/interstellar", "https://www.themoviedb.org/movie/157336-interstellar"],
            "translations": [
                {"locale": "zh-CN", "title": "星际穿越", "summary": "诺兰执导的硬核物理与人类深情科幻丰碑。"},
                {"locale": "en-US", "title": "Interstellar", "summary": "Epic sci-fi masterpiece directed by Christopher Nolan, starring Matthew McConaughey and Anne Hathaway."},
                {"locale": "ja", "title": "インターステラー", "summary": "クリストファー・ノーラン監督によるSF映画の金字塔。"}
            ]
        },

        # ==========================================
        # 7. 攻壳机动队 (Ghost in the Shell)
        # ==========================================
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000139",
            "title": "攻壳机动队",
            "original_title": "GHOST IN THE SHELL / 攻殻機動隊",
            "aliases": ["Ghost in the Shell 1995", "攻壳95"],
            "release_date": "1995-11-18",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "押井守执导、Production I.G 制作的赛博朋克影史巅峰巨作。讲述公元2029年全身义体化的公安九课少佐草薙素子追查神秘黑客“傀儡师”，最终在网络汪洋中实现自我超越与灵魂重塑的深刻哲学思考。",
            "cover_image_url": "https://image.tmdb.org/t/p/original/9gC88zclolEJ1bgP7nN461p579.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["动画电影", "科幻", "赛博朋克", "哲学", "攻壳机动队"],
            "edit_note": "【官方校准】松竹/万代影视日本上映档案(1995-11-18)、TMDB 4K原版主视觉海报(2:3竖版)与演职人员关联",
            "source_urls": ["https://www.themoviedb.org/movie/9323-ghost-in-the-shell", "https://bgm.tv/subject/2849"],
            "translations": [
                {"locale": "zh-CN", "title": "攻壳机动队", "summary": "押井守执导的赛博朋克影史巅峰哲学神作。"},
                {"locale": "en-US", "title": "Ghost in the Shell", "summary": "Iconic 1995 cyberpunk anime film directed by Mamoru Oshii."},
                {"locale": "ja", "title": "GHOST IN THE SHELL / 攻殻機動隊", "summary": "士郎正宗原作、押井守監督によるサイバーパンク・アニメーション映画。"}
            ]
        },

        # ==========================================
        # 8. 千与千寻 (Spirited Away)
        # ==========================================
        {
            "id": "a1b2c3d4-0000-4000-8000-000000000136",
            "title": "千与千寻",
            "original_title": "千と千尋の神隠し",
            "aliases": ["Spirited Away", "神隐少女", "千寻"],
            "release_date": "2001-07-20",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "宫崎骏编剧执导、吉卜力工作室制作、久石让配乐的奥斯卡最佳动画长片。讲述少女千寻误入神灵异世界油屋，经历成长、找回自我并拯救父母的唯美奇幻篇章。",
            "cover_image_url": "https://image.tmdb.org/t/p/original/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["动画电影", "奇幻", "冒险", "治愈", "吉卜力"],
            "edit_note": "【官方校准】东宝日本公映档案(2001-07-20)、TMDB 官方高清原版海报(2:3竖版)与演职全谱系",
            "source_urls": ["https://www.ghibli.jp/works/chihiro/", "https://www.themoviedb.org/movie/129"],
            "translations": [
                {"locale": "zh-CN", "title": "千与千寻", "summary": "宫崎骏斩获奥斯卡最佳动画长片与柏林金熊奖的传世经典。"},
                {"locale": "en-US", "title": "Spirited Away", "summary": "Academy Award-winning anime masterpiece directed by Hayao Miyazaki and Studio Ghibli."},
                {"locale": "ja", "title": "千と千尋の神隠し", "summary": "宮﨑駿監督、スタジオジブリ制作による長編アニメーション映画。"}
            ]
        },

        # ==========================================
        # 9. 三体 (The Three-Body Problem)
        # ==========================================
        {
            "id": "00000000-0000-0000-0000-000000000101",
            "title": "三体",
            "original_title": "三体",
            "aliases": ["The Three-Body Problem", "地球往事", "三体三部曲"],
            "release_date": "2008-01-01",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "刘慈欣创作的中国科幻巅峰巨著《地球往事》三部曲（《三体》《黑暗森林》《死神永生》）。以宏大的宇宙社会学、黑暗森林法则与降维打击颠覆世界科幻认知，荣获第73届雨果奖最佳长篇小说奖。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/cf/21/21437_hH2bT.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["图书", "科幻", "硬科幻", "雨果奖", "三体"],
            "edit_note": "【官方校准】重庆出版社初版单行本文献档案、雨果奖官方书封(3:4比例)与权威ISBN映射",
            "source_urls": ["https://bgm.tv/subject/21437", "https://openlibrary.org/works/OL17336159W"],
            "translations": [
                {"locale": "zh-CN", "title": "三体", "summary": "刘慈欣斩获雨果奖的中国硬科幻巅峰史诗。"},
                {"locale": "en-US", "title": "The Three-Body Problem", "summary": "Hugo Award-winning hard sci-fi trilogy by Liu Cixin, translated by Ken Liu."},
                {"locale": "ja", "title": "三体", "summary": "劉慈欣による中国の長編SF小説。ヒューゴー賞受賞。"}
            ]
        },

        # ==========================================
        # 10. 周杰伦 发烧唱片 (Jay Chou)
        # ==========================================
        {
            "id": "c001cafe-0000-4000-8000-000000000101",
            "title": "范特西",
            "original_title": "Fantasy",
            "aliases": ["Fantasy Album", "Jay Chou Fantasy"],
            "release_date": "2001-09-14",
            "country": "中国台湾",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "周杰伦第二张录音室专辑，华语流行乐坛断层领跑的里程碑神作。收录《爱在西元前》《简单爱》《双截棍》《开不了口》《安静》等全10首金曲，横扫第13届金曲奖5项大奖。",
            "cover_image_url": "https://coverartarchive.org/release/415b3c37-c7e1-4560-a292-ecdc2c5f114c/13444005991.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "流行", "R&B", "华语金曲"],
            "edit_note": "【官方校准】阿尔发/BMG台湾首版CD品番(WMP-5028)、MusicBrainz CAA 官方红卫衣方封(1:1)与金曲奖全景记录",
            "source_urls": ["https://musicbrainz.org/release/415b3c37-c7e1-4560-a292-ecdc2c5f114c", "https://bgm.tv/subject/16892"],
            "translations": [
                {"locale": "zh-CN", "title": "范特西", "summary": "华语流行乐划时代的巅峰大碟，斩获金曲奖五项大奖。"},
                {"locale": "en-US", "title": "Fantasy", "summary": "Groundbreaking second studio album by Jay Chou that revolutionized Mandopop."},
                {"locale": "ja", "title": "ファンタジー (范特西)", "summary": "ジェイ・チョウの2ndアルバム。中華ポップス史に残る名盤。"}
            ]
        },
        {
            "id": "c001cafe-0000-4000-8000-000000000102",
            "title": "叶惠美",
            "original_title": "Ye Hui Mei",
            "aliases": ["以父之名", "东风破"],
            "release_date": "2003-07-31",
            "country": "中国台湾",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "周杰伦第四张个人大碟，以母亲名字命名。包含暗黑歌剧古典《以父之名》、中国风巅峰《东风破》《晴天》《梯田》等传世之作，荣获第15届金曲奖最佳流行音乐演唱专辑奖。",
            "cover_image_url": "https://coverartarchive.org/release/12d377b2-84bc-4ce9-ae7d-e6b772c3d0b2/13444016738.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "流行", "古典", "华语金曲"],
            "edit_note": "【官方校准】阿尔发/索尼音乐首版CD品番(ALFA-0006)、MusicBrainz CAA 高清复古方封(1:1)",
            "source_urls": ["https://musicbrainz.org/release/12d377b2-84bc-4ce9-ae7d-e6b772c3d0b2"],
            "translations": [
                {"locale": "zh-CN", "title": "叶惠美", "summary": "收录《以父之名》《晴天》《东风破》的殿堂级神专。"},
                {"locale": "en-US", "title": "Ye Hui Mei", "summary": "Fourth studio album by Jay Chou featuring the timeless hit In the Name of the Father."},
                {"locale": "ja", "title": "イエ・ホエメイ (葉恵美)", "summary": "ジェイ・チョウの4thアルバム。"}
            ]
        },

        # ==========================================
        # 11. 迈克尔·杰克逊 (Michael Jackson) 发烧唱片
        # ==========================================
        {
            "id": "c001cafe-0000-4000-8000-000000000115",
            "title": "Thriller",
            "original_title": "Thriller",
            "aliases": ["颤栗", "Thriller Album"],
            "release_date": "1982-11-30",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "流行音乐之王迈克尔·杰克逊第六张录音室专辑，全球历史销量第一（突破7000万张），荣获8座格莱美奖。包含《Billie Jean》《Beat It》《Thriller》等永恒经典。",
            "cover_image_url": "https://coverartarchive.org/release/844081c7-c502-4fa0-82a8-a6d1dc240a23/34419992520.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "流行", "R&B", "世界经典"],
            "edit_note": "【官方校准】Epic Records 1982首版黑胶/CD品番(EPC 85930)、MusicBrainz CAA 官方白西装原档封面(1:1)",
            "source_urls": ["https://musicbrainz.org/release/844081c7-c502-4fa0-82a8-a6d1dc240a23"],
            "translations": [
                {"locale": "zh-CN", "title": "Thriller", "summary": "世界影音史上销量最高的传奇流行专辑。"},
                {"locale": "en-US", "title": "Thriller", "summary": "The best-selling album of all time by the King of Pop Michael Jackson, produced by Quincy Jones."},
                {"locale": "ja", "title": "スリラー (Thriller)", "summary": "マイケル・ジャクソンが1982年に発表した歴史的傑作アルバム。"}
            ]
        },
        {
            "id": "c001cafe-0000-4000-8000-000000000116",
            "title": "Bad",
            "original_title": "Bad",
            "aliases": ["真棒", "Bad Album"],
            "release_date": "1987-08-31",
            "country": "美国",
            "language": "en-US",
            "original_language": "en-US",
            "summary": "迈克尔·杰克逊第七张录音室专辑，创下历史单张专辑诞生5首 Billboard 冠军单曲纪录（《I Just Can't Stop Loving You》《Bad》《The Way You Make Me Feel》《Man in the Mirror》《Dirty Diana》）。",
            "cover_image_url": "https://coverartarchive.org/release/b8e05a88-294b-4c07-9fc5-e1fc08c4e402/33580436814.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "流行", "摇滚", "世界经典"],
            "edit_note": "【官方校准】Epic Records 首版CD品番(EK 40600)、MusicBrainz CAA 官方黑皮衣原档封面(1:1)",
            "source_urls": ["https://musicbrainz.org/release/b8e05a88-294b-4c07-9fc5-e1fc08c4e402"],
            "translations": [
                {"locale": "zh-CN", "title": "Bad", "summary": "创下5首公告牌冠单历史纪录的流行摇滚盛宴。"},
                {"locale": "en-US", "title": "Bad", "summary": "Legendary seventh studio album by Michael Jackson that spawned five Billboard Hot 100 number-one singles."},
                {"locale": "ja", "title": "バッド (Bad)", "summary": "マイケル・ジャクソンの7作目のスタジオ・アルバム。"}
            ]
        },

        # ==========================================
        # 12. 紫罗兰永恒花园 (Violet Evergarden)
        # ==========================================
        {
            "id": "deadbeef-0000-4000-8000-000000000111",
            "title": "紫罗兰永恒花园",
            "original_title": "ヴァイオレット・エヴァーガーデン",
            "aliases": ["Violet Evergarden Novel", "京紫小说"],
            "release_date": "2015-12-25",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "晓佳奈创作、高濑亚贵子插画的轻小说，第5届京都动画大奖唯一大奖得主。讲述战争少女薇尔莉特作为自动手记人偶代写书信，探寻少佐所留「我爱你」真谛的感人故事。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/7f/00/159846_4y48o.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["轻小说", "治愈", "催泪", "奇幻", "紫罗兰永恒花园"],
            "edit_note": "【官方校准】KA Esuma文库首版出版(2015-12-25)、高濑亚贵子原画单行本封面(3:4比例)与Bangumi权威档案",
            "source_urls": ["http://www.kyotoanimation.co.jp/books/violet/", "https://bgm.tv/subject/159846"],
            "translations": [
                {"locale": "zh-CN", "title": "紫罗兰永恒花园", "summary": "京都动画大奖唯重大奖获得作品。"},
                {"locale": "en-US", "title": "Violet Evergarden (Light Novel)", "summary": "Heartfelt light novel series by Kana Akatsuki, illustrated by Akiko Takase."},
                {"locale": "ja", "title": "ヴァイオレット・エヴァーガーデン", "summary": "暁佳奈による日本のライトノベル。KAエスマ文庫刊。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000112",
            "title": "紫罗兰永恒花园",
            "original_title": "ヴァイオレット・エヴァーガーデン",
            "aliases": ["Violet Evergarden Anime", "京紫动画"],
            "release_date": "2018-01-11",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "京都动画制作、石立太一执导、石川由依配音的 TV 动画。以令人惊叹的手绘光影画质与 Evan Call 谱写的悠扬乐章名扬国际。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/d0/bb/183863_n93U8.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "治愈", "催泪", "奇幻", "紫罗兰永恒花园"],
            "edit_note": "【官方校准】京都动画官方放映日(2018-01-11)、官方海报(2:3竖版)与演职全谱系",
            "source_urls": ["http://violet-evergarden.jp/", "https://bgm.tv/subject/183863"],
            "translations": [
                {"locale": "zh-CN", "title": "紫罗兰永恒花园", "summary": "京都动画画质巅峰泪目杰作。"},
                {"locale": "en-US", "title": "Violet Evergarden (Anime)", "summary": "Visually stunning anime series by Kyoto Animation directed by Taichi Ishidate."},
                {"locale": "ja", "title": "ヴァイオレット・エヴァーガーデン (アニメ)", "summary": "京都アニメーション制作によるテレビアニメ。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000113",
            "title": "紫罗兰永恒花园 剧场版",
            "original_title": "劇場版 ヴァイオレット・エヴァーガーデン",
            "aliases": ["Violet Evergarden: The Movie"],
            "release_date": "2020-09-18",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "京都动画历经浴火重生倾力奉献的剧场版完结长片。薇尔莉特远赴孤岛寻觅思念之人的终极篇章，荣获日本电影学院奖优秀动画作品奖。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/7f/f3/245842_x2mK5.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["动画电影", "治愈", "催泪", "剧场版", "紫罗兰永恒花园"],
            "edit_note": "【官方校准】松竹日本院线上映日(2020-09-18)、官方高清海报(2:3竖版)与演职人员全关联",
            "source_urls": ["http://violet-evergarden.jp/", "https://bgm.tv/subject/245842"],
            "translations": [
                {"locale": "zh-CN", "title": "紫罗兰永恒花园 剧场版", "summary": "为爱画上终点的感动剧场版长片。"},
                {"locale": "en-US", "title": "Violet Evergarden: The Movie", "summary": "Emotional theatrical finale to the Violet Evergarden series by Kyoto Animation."},
                {"locale": "ja", "title": "劇場版 ヴァイオレット・エヴァーガーデン", "summary": "シリーズ完結編となる完全新作劇場版アニメーション。"}
            ]
        },
        {
            "id": "deadbeef-0000-4000-8000-000000000114",
            "title": "VIOLET EVERGARDEN : Automemories",
            "original_title": "TVアニメ『ヴァイオレット・エヴァーガーデン』オリジナルサウンドトラック「VIOLET EVERGARDEN: Automemories」",
            "aliases": ["Violet Evergarden OST", "京紫原声大碟"],
            "release_date": "2018-03-28",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "Evan Call 谱写的紫罗兰永恒花园2CD官方原声大碟，收录《Theme of Violet Evergarden》《Never Coming Back》《The Voice in My Heart》等47首催泪名曲。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/b8/67/237583_zK0Zq.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "原声带", "管弦乐", "紫罗兰永恒花园"],
            "edit_note": "【官方校准】Lantis 实体2CD品番(LACA-9573~4)、方封原档(1:1)与VGMdb权威档案",
            "source_urls": ["https://vgmdb.net/album/74609", "https://bgm.tv/subject/237583"],
            "translations": [
                {"locale": "zh-CN", "title": "VIOLET EVERGARDEN : Automemories", "summary": "Evan Call 操刀的紫罗兰永恒花园交响原声大碟。"},
                {"locale": "en-US", "title": "Violet Evergarden: Automemories", "summary": "Heartbreaking original soundtrack composed by Evan Call."},
                {"locale": "ja", "title": "VIOLET EVERGARDEN : Automemories", "summary": "Evan Callが劇伴音楽を手掛けたオリジナルサウンドトラック2枚組。"}
            ]
        },

        # ==========================================
        # 13. 明日方舟 (Arknights)
        # ==========================================
        {
            "id": "cafef00d-0000-4000-8000-000000000101",
            "title": "明日方舟",
            "original_title": "アークナイツ",
            "aliases": ["Arknights", "方舟"],
            "release_date": "2019-04-30",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "鹰角网络自主研发运营的策略战术 RPG。在天灾肆虐、矿石病蔓延的泰拉世界，玩家作为罗德岛战略头脑“博士”，与阿米娅等干员拯救受难者并探寻文明真相。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/f5/ec/260759_Nf5n6.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["游戏", "科幻", "策略", "明日方舟"],
            "edit_note": "【官方校准】国服公测首发(2019-04-30)、鹰角官方超清主视觉海报(2:3竖版)与PRTS权威档案",
            "source_urls": ["https://ak.hypergryph.com", "https://prts.wiki", "https://bgm.tv/subject/260759"],
            "translations": [
                {"locale": "zh-CN", "title": "明日方舟", "summary": "鹰角网络开创的末世战术策略跨媒介大作。"},
                {"locale": "en-US", "title": "Arknights", "summary": "Critically acclaimed tactical RPG developed by Hypergryph."},
                {"locale": "ja", "title": "アークナイツ", "summary": "Hypergryphが開発しYostarが運営するスマートフォン向けゲーム。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000102",
            "title": "明日方舟：黎明前奏",
            "original_title": "アークナイツ【黎明前奏/PRELUDE TO DAWN】",
            "aliases": ["Arknights: Prelude to Dawn"],
            "release_date": "2022-10-29",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "Yostar Pictures 制作、渡边祐记监督的 TV 动画。采用 2.35:1 电影宽银幕与 5.1 环绕声，再现切尔诺伯格事变与阿米娅救援博士的严酷开局。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/56/67/354084_1z9U8.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "科幻", "策略", "明日方舟"],
            "edit_note": "【官方校准】TV动画官方放映档案(2022-10-29)、超清主视觉海报(2:3竖版)与演职全谱系",
            "source_urls": ["https://www.arknights.jp/animation", "https://bgm.tv/subject/354084"],
            "translations": [
                {"locale": "zh-CN", "title": "明日方舟：黎明前奏", "summary": "电影级宽银幕制作的明日方舟官方第一季动画。"},
                {"locale": "en-US", "title": "Arknights: Prelude to Dawn", "summary": "Television anime adaptation produced by Yostar Pictures."},
                {"locale": "ja", "title": "アークナイツ【黎明前奏/PRELUDE TO DAWN】", "summary": "Yostar Pictures制作によるテレビアニメ。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000103",
            "title": "涵盖万象",
            "original_title": "All-Inclusive / 涵盖万象",
            "aliases": ["MSR All-Inclusive", "音律联觉纪念黑胶"],
            "release_date": "2021-05-02",
            "country": "中国",
            "language": "zh-CN",
            "original_language": "zh-CN",
            "summary": "塞壬唱片 MSR 官方发行的《明日方舟》首场大型沉浸式音乐会「音律联觉 2021」纪念黑胶唱片，收录《Speed of Light》《Renegade》《Boiling Blood》等殿堂级战歌。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/aa/16/334208_48e77.jpg",
            "cover_aspect": "1:1",
            "content_rating": "general",
            "status": "published",
            "tags": ["音乐", "专辑", "原声带", "游戏原声", "电子", "明日方舟"],
            "edit_note": "【官方校准】塞壬唱片 Monster Siren Records 官方黑胶品番(MSR-LP-001)、方封原档(1:1)",
            "source_urls": ["https://monster-siren.hypergryph.com/", "https://bgm.tv/subject/334208"],
            "translations": [
                {"locale": "zh-CN", "title": "涵盖万象", "summary": "塞壬唱片-MSR 2021音律联觉官方纪念黑胶专辑。"},
                {"locale": "en-US", "title": "All-Inclusive", "summary": "Monster Siren Records official Ambience Synesthesia vinyl album for Arknights."},
                {"locale": "ja", "title": "涵盖万象 (All-Inclusive)", "summary": "Monster Siren Records公式のアークナイツ音律聯覚記念LPレコード。"}
            ]
        },

        # ==========================================
        # 14. Fate/stay night & 某科学的超电磁炮
        # ==========================================
        {
            "id": "cafef00d-0000-4000-8000-000000000104",
            "title": "Fate/stay night",
            "original_title": "Fate/stay night",
            "aliases": ["命运之夜", "FSN"],
            "release_date": "2004-01-30",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "奈须蘑菇编剧、武内崇原画的 TYPE-MOON 开山传奇视觉小说。描绘七名魔术师（御主）与七名古代英雄从者争夺万能许愿机「圣杯」的宿命战争。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/88/5f/1446_m82m2.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["游戏", "奇幻", "热血", "Fate"],
            "edit_note": "【官方校准】TYPE-MOON 2004初版PC发售档案(TM-001)、原版主视觉(2:3比例)与Bangumi权威条目",
            "source_urls": ["http://www.typemoon.com/products/fate/", "https://bgm.tv/subject/1446"],
            "translations": [
                {"locale": "zh-CN", "title": "Fate/stay night", "summary": "TYPE-MOON 传奇视觉小说开山之作。"},
                {"locale": "en-US", "title": "Fate/stay night", "summary": "Iconic visual novel developed by TYPE-MOON written by Kinoko Nasu."},
                {"locale": "ja", "title": "Fate/stay night", "summary": "TYPE-MOONから発売された伝奇活劇ビジュアルノベル。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000105",
            "title": "Fate/stay night [Unlimited Blade Works]",
            "original_title": "Fate/stay night [Unlimited Blade Works]",
            "aliases": ["Fate UBW", "无限剑制"],
            "release_date": "2014-10-04",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "ufotable 制作、三浦贵博监督的 TV 动画。聚焦卫宫士郎、远坂凛与英灵卫宫（Archer）的理想与心象风景碰撞，被誉为光影特效与作画天花板。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/3d/bf/92160_t1qX3.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "奇幻", "热血", "Fate"],
            "edit_note": "【官方校准】TOKYO MX 首播公映(2014-10-04)、ufotable 官方主视觉海报(2:3竖版)与演职全谱系",
            "source_urls": ["http://www.fate-sn.com/ubw/", "https://bgm.tv/subject/92160"],
            "translations": [
                {"locale": "zh-CN", "title": "Fate/stay night [Unlimited Blade Works]", "summary": "ufotable 倾力打造的无限剑制巅峰动画。"},
                {"locale": "en-US", "title": "Fate/stay night [Unlimited Blade Works]", "summary": "Critically acclaimed television anime series animated by ufotable."},
                {"locale": "ja", "title": "Fate/stay night [Unlimited Blade Works]", "summary": "ufotable制作によるテレビアニメーション。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000107",
            "title": "魔法禁书目录",
            "original_title": "とある魔術の禁書目録",
            "aliases": ["A Certain Magical Index", "魔禁"],
            "release_date": "2004-04-10",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "镰池和马创作、灰村清孝插画的电击文库巨著。在超能力科学阵营「学园都市」与古典神秘阵营「十字教魔法世界」的交汇处，无能力者上条当麻以「幻想杀手」打破命运。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/15/22/3351_e3Llb.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["轻小说", "科幻", "超能力", "学园都市"],
            "edit_note": "【官方校准】电击文库第1卷官方发售档案(2004-04-10)、初版单行本封面(3:4比例)与Bangumi权威档案",
            "source_urls": ["https://dengekibunko.jp/title/index/", "https://bgm.tv/subject/3351"],
            "translations": [
                {"locale": "zh-CN", "title": "魔法禁书目录", "summary": "学园都市科学与魔法宏大世界观的开山巨著。"},
                {"locale": "en-US", "title": "A Certain Magical Index", "summary": "Acclaimed light novel series written by Kazuma Kamachi and illustrated by Kiyotaka Haimura."},
                {"locale": "ja", "title": "とある魔術の禁書目録", "summary": "鎌池和馬による日本のライトノベル。電撃文庫刊。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000108",
            "title": "某科学的超电磁炮",
            "original_title": "とある科学の超電磁砲",
            "aliases": ["A Certain Scientific Railgun", "超炮", "炮姐"],
            "release_date": "2007-04-21",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "镰池和马原作、冬川基作画的外传漫画。以学园都市仅有七位的 Level 5 第三位「超电磁炮」御坂美琴为主角，展现少女们的正义与日常。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/dc/4b/3355_37W9S.jpg",
            "cover_aspect": "3:4",
            "content_rating": "general",
            "status": "published",
            "tags": ["漫画", "科幻", "超能力", "学园都市"],
            "edit_note": "【官方校准】电击大王连载首发(2007-04-21)、单行本第1卷高清封面(3:4比例)",
            "source_urls": ["https://dengekidaioh.jp/product/railgun/", "https://bgm.tv/subject/3355"],
            "translations": [
                {"locale": "zh-CN", "title": "某科学的超电磁炮", "summary": "御坂美琴为主角的学园都市超人气外传漫画。"},
                {"locale": "en-US", "title": "A Certain Scientific Railgun", "summary": "Spin-off manga illustrated by Motoi Fuyukawa focusing on Mikoto Misaka."},
                {"locale": "ja", "title": "とある科学の超電磁砲", "summary": "鎌池和馬原作、冬川基作画によるスピンオフ漫画作品。"}
            ]
        },
        {
            "id": "cafef00d-0000-4000-8000-000000000109",
            "title": "某科学的超电磁炮",
            "original_title": "とある科学の超電磁砲",
            "aliases": ["Railgun Anime S1"],
            "release_date": "2009-10-02",
            "country": "日本",
            "language": "ja",
            "original_language": "ja",
            "summary": "J.C.STAFF 制作、长井龙雪监督的 TV 动画。fripSide 主题曲《only my railgun》红遍大江南北，成为二次元文化标志性符号。",
            "cover_image_url": "https://lain.bgm.tv/pic/cover/l/0d/18/2591_O54eE.jpg",
            "cover_aspect": "2:3",
            "content_rating": "general",
            "status": "published",
            "tags": ["TV动画", "科幻", "超能力", "学园都市"],
            "edit_note": "【官方校准】AT-X 官方首播档案(2009-10-02)、NBC环球官方海报(2:3竖版)与演职全谱系",
            "source_urls": ["https://toaru-project.com/railgun/", "https://bgm.tv/subject/2591"],
            "translations": [
                {"locale": "zh-CN", "title": "某科学的超电磁炮", "summary": "长井龙雪监督打造的经典 TV 动画第一季。"},
                {"locale": "en-US", "title": "A Certain Scientific Railgun (Anime)", "summary": "Blockbuster anime television series directed by Tatsuyuki Nagai and animated by J.C.STAFF."},
                {"locale": "ja", "title": "とある科学の超電磁砲 (アニメ)", "summary": "J.C.STAFF制作によるテレビアニメーション第1期。"}
            ]
        }
    ]

    for work_info in works_registry:
        client.upsert_work(work_info["id"], work_info)

    print(f"-> 核心作品数据校准完成，更新/建立: {client.stats['works_updated'] + client.stats['works_created']} 部作品")

    # -------------------------------------------------------------------------
    # 3. 演职人员谱系精准绑定 (Work <-> Artist Relations)
    # -------------------------------------------------------------------------
    print("\n>>> [3/5] 建立完整的创作者、监督、配乐、声优、工作室与出版方演职图谱...")

    staff_relations_map = {
        # 刀剑神域 轻小说
        "deadbeef-0000-4000-8000-000000000101": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000201", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000202", "role": "illustrator"},
        ],
        # 刀剑神域 TV动画
        "deadbeef-0000-4000-8000-000000000102": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000201", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000203", "role": "director"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000204", "role": "composer"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000205", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000206", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000207", "role": "studio"},
        ],
        # 刀剑神域 序列之争
        "deadbeef-0000-4000-8000-000000000103": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000201", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000203", "role": "director"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000204", "role": "composer"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000205", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000206", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000207", "role": "studio"},
        ],
        # SAO Music Collection
        "deadbeef-0000-4000-8000-000000000104": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000204", "role": "composer"},
        ],
        # 葬送的芙莉莲 漫画
        "deadbeef-0000-4000-8000-000000000105": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000208", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000209", "role": "illustrator"},
        ],
        # 葬送的芙莉莲 TV动画
        "deadbeef-0000-4000-8000-000000000106": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000208", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000210", "role": "director"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000211", "role": "composer"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000212", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000214", "role": "studio"},
        ],
        # 葬送的芙莉莲 原声带
        "deadbeef-0000-4000-8000-000000000107": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000211", "role": "composer"},
        ],
        # 孤独摇滚 漫画
        "deadbeef-0000-4000-8000-000000000108": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000215", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000215", "role": "illustrator"},
        ],
        # 孤独摇滚 TV动画
        "deadbeef-0000-4000-8000-000000000109": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000215", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000210", "role": "director"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000217", "role": "studio"},
        ],
        # 进击的巨人 漫画
        "deadbeef-0000-4000-8000-000000000117": [
            {"artist_id": "beefc031-0000-4000-8000-000000000234", "role": "author"},
            {"artist_id": "beefc031-0000-4000-8000-000000000234", "role": "illustrator"},
        ],
        # 进击的巨人 TV动画
        "deadbeef-0000-4000-8000-000000000118": [
            {"artist_id": "beefc031-0000-4000-8000-000000000234", "role": "author"},
            {"artist_id": "beefc031-0000-4000-8000-000000000235", "role": "director"},
            {"artist_id": "beefc031-0000-4000-8000-000000000236", "role": "composer"},
            {"artist_id": "beefc031-0000-4000-8000-000000000237", "role": "studio"},
        ],
        # 进击的巨人 原声大碟
        "deadbeef-0000-4000-8000-000000000119": [
            {"artist_id": "beefc031-0000-4000-8000-000000000236", "role": "composer"},
        ],
        # 新世纪福音战士 TV
        "a1b2c3d4-0000-4000-8000-000000000140": [
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000240", "role": "director"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000240", "role": "author"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000241", "role": "composer"},
        ],
        # 新·福音战士剧场版：终
        "a1b2c3d4-0000-4000-8000-000000000150": [
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000240", "role": "director"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000241", "role": "composer"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000242", "role": "studio"},
        ],
        # 星际穿越
        "a1b2c3d4-0000-4000-8000-000000000101": [
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000201", "role": "director"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000201", "role": "author"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000202", "role": "composer"},
        ],
        # 攻壳机动队 1995
        "a1b2c3d4-0000-4000-8000-000000000139": [
            {"artist_id": "beefc031-0000-4000-8000-000000000229", "role": "author"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000239", "role": "director"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000249", "role": "composer"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000259", "role": "studio"},
        ],
        # 千与千寻
        "a1b2c3d4-0000-4000-8000-000000000136": [
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000236", "role": "director"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000236", "role": "author"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000237", "role": "composer"},
            {"artist_id": "a1b2c3d4-0000-4000-8000-000000000238", "role": "studio"},
        ],
        # 三体
        "00000000-0000-0000-0000-000000000101": [
            {"artist_id": "00000000-0000-0000-0000-000000000201", "role": "author"},
        ],
        # 紫罗兰永恒花园 TV
        "deadbeef-0000-4000-8000-000000000112": [
            {"artist_id": "deadbeef-0000-4000-8000-000000000218", "role": "author"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000221", "role": "director"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000211", "role": "composer"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000222", "role": "voice_actor"},
            {"artist_id": "deadbeef-0000-4000-8000-000000000220", "role": "studio"},
        ]
    }

    for work_id, rels in staff_relations_map.items():
        try:
            client.set_work_relations(work_id, rels)
        except Exception as e:
            print(f"Warning setting relations for {work_id}: {e}")

    print(f"-> 演职全谱系绑定完成，已更新 {client.stats['work_relations_updated']} 部作品的制作人员名单")

    # -------------------------------------------------------------------------
    # 4. 跨媒介衍生网络闭环 (Entity Relationships: adapted_from, soundtrack_of, etc.)
    # -------------------------------------------------------------------------
    print("\n>>> [4/5] 织造跨媒介闭环拓扑（轻小说 -> 漫画 -> TV动画 -> 剧场版 -> 原声大碟）...")

    cross_media_edges = [
        # --- 刀剑神域闭环 ---
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000102",  # TV动画
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000101",  # 轻小说
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000103",  # 剧场版
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000102",  # TV动画
            "relationship_type": "sequel_of"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000104",  # 原声带
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000102",  # TV动画
            "relationship_type": "soundtrack_of"
        },

        # --- 葬送的芙莉莲闭环 ---
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000106",  # TV动画
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000105",  # 漫画
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000107",  # 原声带
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000106",  # TV动画
            "relationship_type": "soundtrack_of"
        },

        # --- 孤独摇滚闭环 ---
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000109",  # TV动画
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000108",  # 漫画
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000110",  # 结束乐队专辑
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000109",  # TV动画
            "relationship_type": "soundtrack_of"
        },

        # --- 进击的巨人闭环 ---
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000118",  # TV动画
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000117",  # 漫画
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000119",  # 原声带
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000118",  # TV动画
            "relationship_type": "soundtrack_of"
        },

        # --- 紫罗兰永恒花园闭环 ---
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000112",  # TV动画
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000111",  # 轻小说
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000113",  # 剧场版
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000112",  # TV动画
            "relationship_type": "sequel_of"
        },
        {
            "source_type": "work",
            "source_id": "deadbeef-0000-4000-8000-000000000114",  # 原声带
            "target_type": "work",
            "target_id": "deadbeef-0000-4000-8000-000000000112",  # TV动画
            "relationship_type": "soundtrack_of"
        },

        # --- 明日方舟闭环 ---
        {
            "source_type": "work",
            "source_id": "cafef00d-0000-4000-8000-000000000102",  # TV动画
            "target_type": "work",
            "target_id": "cafef00d-0000-4000-8000-000000000101",  # 游戏
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "cafef00d-0000-4000-8000-000000000103",  # MSR 原声专辑
            "target_type": "work",
            "target_id": "cafef00d-0000-4000-8000-000000000101",  # 游戏
            "relationship_type": "soundtrack_of"
        },

        # --- Fate/stay night & 超电磁炮 ---
        {
            "source_type": "work",
            "source_id": "cafef00d-0000-4000-8000-000000000105",  # TV UBW
            "target_type": "work",
            "target_id": "cafef00d-0000-4000-8000-000000000104",  # 视觉小说
            "relationship_type": "adapted_from"
        },
        {
            "source_type": "work",
            "source_id": "cafef00d-0000-4000-8000-000000000108",  # 某科学的超电磁炮 漫画
            "target_type": "work",
            "target_id": "cafef00d-0000-4000-8000-000000000107",  # 魔法禁书目录 轻小说
            "relationship_type": "spin_off_of"
        },
        {
            "source_type": "work",
            "source_id": "cafef00d-0000-4000-8000-000000000109",  # 某科学的超电磁炮 TV动画
            "target_type": "work",
            "target_id": "cafef00d-0000-4000-8000-000000000108",  # 某科学的超电磁炮 漫画
            "relationship_type": "adapted_from"
        }
    ]

    client.set_entity_relations(cross_media_edges)
    print(f"-> 跨媒介衍生边织造完成，共写入/更新 {len(cross_media_edges)} 条高阶语义关系边")

    # -------------------------------------------------------------------------
    # 5. 官方实体出版发行版 (Releases) 规范注入
    # -------------------------------------------------------------------------
    print("\n>>> [5/5] 录入标准出版发行版（ISBN-13、唱片品番、出版机构与介质规格）...")

    releases_seed = [
        {
            "work_id": "deadbeef-0000-4000-8000-000000000101",
            "publisher_id": "deadbeef-0000-4000-8000-000000000213",
            "edition_name": "第1卷 艾恩葛朗特 (初版单行本)",
            "catalog_number": "9784048677608",
            "barcode": "9784048677608",
            "packaging": "paperback",
            "edition_date": "2009-04-10",
            "country": "日本",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "电击文库初版单行本，封面插画：abec",
            "catalog_metadata": {"isbn13": "978-4-04-867760-8", "price_jpy": 638}
        },
        {
            "work_id": "deadbeef-0000-4000-8000-000000000104",
            "edition_name": "Sword Art Online Music Collection (4CD 初回生产限定盘)",
            "catalog_number": "SVWC-70116~9",
            "barcode": "4534530089854",
            "packaging": "box_set",
            "edition_date": "2016-01-27",
            "country": "日本",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "4CD盒装全彩册，收录梶浦由记全部131首原声交响母带",
            "catalog_metadata": {"discs": 4, "format": "CD", "price_jpy": 4950}
        },
        {
            "work_id": "deadbeef-0000-4000-8000-000000000105",
            "publisher_id": "beefc031-0000-4000-8000-000000000103",
            "edition_name": "第1卷 (初版单行本)",
            "catalog_number": "9784098501809",
            "barcode": "9784098501809",
            "packaging": "paperback",
            "edition_date": "2020-08-18",
            "country": "日本",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "少年Sunday Comics单行本，收录第1-7话",
            "catalog_metadata": {"isbn13": "978-4-09-850180-9", "price_jpy": 550}
        },
        {
            "work_id": "deadbeef-0000-4000-8000-000000000107",
            "edition_name": "TVアニメ『葬送のフリーレン』Original Soundtrack (2CD 豪华装)",
            "catalog_number": "THCA-60288",
            "barcode": "4988104115881",
            "packaging": "jewel_case",
            "edition_date": "2024-04-17",
            "country": "日本",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "东宝 TOHO animation RECORDS 出版发行，2CD收录全70首交响实录曲目",
            "catalog_metadata": {"discs": 2, "format": "CD", "price_jpy": 4400}
        },
        {
            "work_id": "deadbeef-0000-4000-8000-000000000110",
            "edition_name": "結束バンド (首版实体CD)",
            "catalog_number": "SVWC-70613",
            "barcode": "4534530141019",
            "packaging": "jewel_case",
            "edition_date": "2022-12-28",
            "country": "日本",
            "language": "ja",
            "distribution_channel": "physical",
            "notes": "Aniplex 出品，收录动画全14首热单与特典贴纸",
            "catalog_metadata": {"discs": 1, "format": "CD", "price_jpy": 3410}
        },
        {
            "work_id": "00000000-0000-0000-0000-000000000101",
            "publisher_id": "00000000-0000-0000-0000-000000000202",
            "edition_name": "《三体》单行本 (中国大陆初版)",
            "catalog_number": "9787536692909",
            "barcode": "9787536692909",
            "packaging": "paperback",
            "edition_date": "2008-01-01",
            "country": "中国",
            "language": "zh-CN",
            "distribution_channel": "physical",
            "notes": "重庆出版社「科幻世界·中国科幻基石丛书」初版单行本",
            "catalog_metadata": {"isbn13": "978-7-5366-9290-9", "price_cny": 23.0}
        },
        {
            "work_id": "c001cafe-0000-4000-8000-000000000101",
            "edition_name": "范特西 (台湾首版 CD+VCD 豪华版)",
            "catalog_number": "WMP-5028",
            "barcode": "4710149635028",
            "packaging": "jewel_case",
            "edition_date": "2001-09-14",
            "country": "中国台湾",
            "language": "zh-CN",
            "distribution_channel": "physical",
            "notes": "阿尔发音乐 / 博德曼 BMG 台湾首版发行",
            "catalog_metadata": {"discs": 2, "format": "CD+VCD", "isrc": "TWA450101001"}
        },
        {
            "work_id": "c001cafe-0000-4000-8000-000000000115",
            "edition_name": "Thriller (1982 实体黑胶 Vinyl 首版)",
            "catalog_number": "EPC 85930",
            "barcode": "07464381122",
            "packaging": "gatefold",
            "edition_date": "1982-11-30",
            "country": "美国",
            "language": "en-US",
            "distribution_channel": "physical",
            "notes": "Epic Records 全球首发折叠封套黑胶大碟，制作人 Quincy Jones",
            "catalog_metadata": {"format": "12\" Vinyl", "speed": "33 1/3 RPM"}
        }
    ]

    for rel in releases_seed:
        try:
            client.create_release(rel)
        except Exception as e:
            # If already exists or other minor issue, log and continue
            print(f"Notice creating release for work {rel['work_id']}: {e}")

    # -------------------------------------------------------------------------
    # 6. 修订历史 (entity_revisions) 完整性验证
    # -------------------------------------------------------------------------
    print("\n>>> [6/6] 验证数据库中合规生成的 entity_revisions 审计时间线...")

    sample_work_ids = [
        "deadbeef-0000-4000-8000-000000000101",
        "deadbeef-0000-4000-8000-000000000105",
        "deadbeef-0000-4000-8000-000000000108",
        "00000000-0000-0000-0000-000000000101",
        "a1b2c3d4-0000-4000-8000-000000000101",
        "c001cafe-0000-4000-8000-000000000101"
    ]

    for wid in sample_work_ids:
        revs = client.verify_revisions("work", wid)
        print(f" - 作品 {wid[:8]}... 修订历史条数: {len(revs)}")
        if revs:
            latest = revs[0]
            print(f"   最新修订: [{latest.get('edit_type')}] {latest.get('summary')} | 附注: {latest.get('edit_note')} | 来源: {latest.get('source_urls')}")

    print("\n" + "=" * 80)
    print(" 官方编目校准与原档补齐完成！统计总览：")
    print(f" - 创作者与机构 (Artists): 更新 {client.stats['artists_updated']} 个，新建 {client.stats['artists_created']} 个")
    print(f" - 核心作品 (Works): 更新 {client.stats['works_updated']} 部，新建 {client.stats['works_created']} 部")
    print(f" - 演职人员谱系 (Work Staff): 更新 {client.stats['work_relations_updated']} 组")
    print(f" - 跨媒介衍生关系边 (Cross-Media Edges): 写入 {client.stats['entity_relations_updated']} 条")
    print(f" - 发行版出版规范 (Releases): 注入 {client.stats['releases_created']} 项")
    print(f" - 修订审计历史 (Entity Revisions): 验证成功 {client.stats['revisions_verified']} 条")
    print("=" * 80)


if __name__ == "__main__":
    run_official_calibration()
