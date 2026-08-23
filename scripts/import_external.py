#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MetaFusion OmniSource Importer CLI
===================================
A powerful, elegant command-line tool to batch or single-shot import music, anime,
movies, and manga from MusicBrainz, TMDB, IMDb, and Bangumi directly into MetaFusion.

Usage:
  python scripts/import_external.py --url "https://musicbrainz.org/release/4b9b9c02-d96a-4933-9133-149b3dc33989"
  python scripts/import_external.py --source tmdb --id 157336 --token "YOUR_JWT_TOKEN"
  python scripts/import_external.py --url "https://bgm.tv/subject/364450" --preview
  python scripts/import_external.py --batch ids.txt --username admin --password adminpassword
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional, Dict, Any, List

API_BASE_DEFAULT = os.getenv("METAFUSION_API_BASE", "http://localhost:8080/api/v1")


class TerminalColor:
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"


def print_banner():
    art = r"""
  __  __      _        ______          _             
 |  \/  |    | |      |  ____|        (_)            
 | \  / | ___| |_ __ _| |__ _   _ ___ _  ___  _ __   
 | |\/| |/ _ \ __/ _` |  __| | | / __| |/ _ \| '_ \  
 | |  | |  __/ || (_| | |  | |_| \__ \ | (_) | | | | 
 |_|  |_|\___|\__\__,_|_|   \__,_|___/_|\___/|_| |_| 
       OmniSource Importer Suite (CLI v1.0)"""
    banner = f"{TerminalColor.CYAN}{TerminalColor.BOLD}{art}\n{TerminalColor.RESET}{TerminalColor.DIM}MusicBrainz · TMDB / IMDb · Bangumi (bgm.tv){TerminalColor.RESET}\n"
    print(banner)


def send_request(url: str, method: str = "GET", data: Optional[dict] = None, token: Optional[str] = None, api_key: Optional[str] = None) -> dict:
    headers = {
        "User-Agent": "MetaFusion-OmniImporter-CLI/1.0",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key:
        headers["X-API-Key"] = api_key

    payload = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            if body:
                return json.loads(body)
            return {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("error", err_body)
        except Exception:
            msg = err_body or str(e)
        raise RuntimeError(f"HTTP {e.code}: {msg}")
    except Exception as e:
        raise RuntimeError(f"Network error: {e}")


def login_for_token(api_base: str, username: str, password: str) -> str:
    url = f"{api_base}/auth/login"
    res = send_request(url, method="POST", data={"username": username, "password": password})
    token = res.get("token")
    if not token:
        raise RuntimeError("Login failed: no token returned.")
    return token


def preview_import(api_base: str, url_or_id: str, source: str = "auto", hint: str = "") -> dict:
    url = f"{api_base}/importer/preview"
    data = {
        "source": source,
        "url_or_id": url_or_id,
        "media_type_hint": hint,
    }
    return send_request(url, method="POST", data=data)


def execute_import(
    api_base: str,
    preview_data: Optional[dict] = None,
    url_or_id: str = "",
    source: str = "auto",
    token: Optional[str] = None,
    api_key: Optional[str] = None,
    download_cover: bool = True,
    is_master_verified: bool = False,
    edit_note: str = ""
) -> dict:
    url = f"{api_base}/importer/import"
    if preview_data:
        data = {
            "source": preview_data.get("source"),
            "url_or_id": preview_data.get("external_url") or url_or_id,
            "work": preview_data.get("work"),
            "artists": preview_data.get("artists"),
            "release": preview_data.get("release"),
            "mediums": preview_data.get("mediums"),
            "download_cover": download_cover,
            "is_master_verified": is_master_verified,
            "edit_note": edit_note,
        }
    else:
        data = {
            "source": source,
            "url_or_id": url_or_id,
            "download_cover": download_cover,
            "is_master_verified": is_master_verified,
            "edit_note": edit_note,
        }

    return send_request(url, method="POST", data=data, token=token, api_key=api_key)


def display_preview(data: dict):
    work = data.get("work", {})
    release = data.get("release", {})
    artists = data.get("artists", [])
    mediums = data.get("mediums", [])
    tags = data.get("tags", [])

    print(f"\n{TerminalColor.BOLD}=== 解析预览 (Parsed Preview) ==={TerminalColor.RESET}")
    print(f"数据源 (Source)    : {TerminalColor.CYAN}{data.get('source', '').upper()}{TerminalColor.RESET} ({data.get('external_url')})")
    print(f"作品题名 (Title)   : {TerminalColor.BOLD}{work.get('title')}{TerminalColor.RESET}")
    if work.get("original_title") and work.get("original_title") != work.get("title"):
        print(f"原始题名 (Original): {work.get('original_title')}")
    print(f"发行年代 (Date)    : {work.get('release_date') or '未知'}")
    print(f"国家/语言 (Country): {work.get('country') or '-'} / {work.get('language') or '-'}")
    print(f"封面图 (Cover URL) : {work.get('cover_image_url') or '-'}")
    print(f"标签分类 (Tags)    : {', '.join(tags[:8])}")

    if artists:
        print(f"\n{TerminalColor.BOLD}演职员与创作者 (Artists):{TerminalColor.RESET}")
        for a in artists:
            role = a.get("role", "Creator")
            disamb = f" ({a.get('disambiguation')})" if a.get("disambiguation") else ""
            print(f"  - [{role}] {a.get('name')}{disamb}")

    print(f"\n{TerminalColor.BOLD}发行版本规格 (Release):{TerminalColor.RESET}")
    print(f"  版本名: {release.get('edition_name')}")
    if release.get("publisher"):
        print(f"  发行方: {release.get('publisher')}")
    if release.get("barcode"):
        print(f"  条码/ISBN: {release.get('barcode')}")

    if mediums:
        print(f"\n{TerminalColor.BOLD}载体介质与曲目/分集 (Mediums & Tracks):{TerminalColor.RESET}")
        for med in mediums:
            tracks = med.get("tracks", [])
            print(f"  [{med.get('format', 'Digital')}] {med.get('name')} (共 {len(tracks)} 项)")
            for trk in tracks[:5]:
                dur = trk.get("duration_seconds", 0)
                dur_str = f"{dur // 60}:{dur % 60:02d}" if dur > 0 else ""
                print(f"    {trk.get('position', 1)}. {trk.get('title')} {TerminalColor.DIM}{dur_str}{TerminalColor.RESET}")
            if len(tracks) > 5:
                print(f"    ... 以及另外 {len(tracks) - 5} 项")
    print("")


def main():
    parser = argparse.ArgumentParser(description="MetaFusion OmniSource Importer CLI")
    parser.add_argument("--url", "-u", help="URL of external item (MusicBrainz / TMDB / IMDb / Bangumi)")
    parser.add_argument("--id", "-i", help="External ID (MBID / TMDB ID / IMDb ID / Bangumi Subject ID)")
    parser.add_argument("--source", "-s", default="auto", choices=["auto", "musicbrainz", "tmdb", "imdb", "bangumi"], help="Source catalog")
    parser.add_argument("--hint", choices=["music", "movie", "tv", "book", "anime", "game"], default="", help="Media type hint")
    parser.add_argument("--batch", "-b", help="File containing URLs or IDs to batch import (one per line)")
    parser.add_argument("--preview", "-p", action="store_true", help="Preview extracted metadata only without saving")
    parser.add_argument("--no-cover", action="store_true", help="Do not download cover into object storage")
    parser.add_argument("--verified", action="store_true", help="Mark release as master verified")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT, help="MetaFusion API base URL")
    parser.add_argument("--token", help="JWT authentication token")
    parser.add_argument("--api-key", help="PAT or API Key for MetaFusion")
    parser.add_argument("--username", help="Username for auto-login")
    parser.add_argument("--password", help="Password for auto-login")
    parser.add_argument("--note", default="", help="Custom edit note")

    args = parser.parse_args()
    print_banner()

    target = args.url or args.id
    if not target and not args.batch:
        parser.print_help()
        sys.exit(1)

    # 处理鉴权 Token
    token = args.token or os.getenv("METAFUSION_TOKEN")
    api_key = args.api_key or os.getenv("METAFUSION_API_KEY")

    if not token and not api_key and args.username and args.password:
        try:
            print(f"{TerminalColor.DIM}Logging in as {args.username}...{TerminalColor.RESET}")
            token = login_for_token(args.api_base, args.username, args.password)
            print(f"{TerminalColor.GREEN}Login successful!{TerminalColor.RESET}")
        except Exception as e:
            print(f"{TerminalColor.RED}Login failed: {e}{TerminalColor.RESET}")
            sys.exit(1)

    targets = []
    if args.batch:
        if not os.path.exists(args.batch):
            print(f"{TerminalColor.RED}Batch file not found: {args.batch}{TerminalColor.RESET}")
            sys.exit(1)
        with open(args.batch, "r", encoding="utf-8") as f:
            for line in f:
                l = line.strip()
                if l and not l.startswith("#"):
                    targets.append(l)
    elif target:
        targets.append(target)

    print(f"待处理条目数 (Total Targets): {len(targets)}")
    success_count = 0
    fail_count = 0

    for idx, item in enumerate(targets, 1):
        print(f"\n{TerminalColor.BOLD}[{idx}/{len(targets)}] 正在处理: {item}{TerminalColor.RESET}")
        try:
            # 1. 抓取预览
            preview_res = preview_import(args.api_base, item, source=args.source, hint=args.hint)
            display_preview(preview_res)

            if args.preview:
                print(f"{TerminalColor.GREEN}Preview completed (--preview specified, skipping save).{TerminalColor.RESET}")
                continue

            if not token and not api_key:
                print(f"{TerminalColor.YELLOW}Notice: No auth token provided. Please specify --token or --username/--password to execute write import.{TerminalColor.RESET}")
                continue

            # 2. 确认入库
            print(f"{TerminalColor.DIM}正在导入并存入数据库与 RustFS...{TerminalColor.RESET}")
            import_res = execute_import(
                api_base=args.api_base,
                preview_data=preview_res,
                url_or_id=item,
                source=args.source,
                token=token,
                api_key=api_key,
                download_cover=not args.no_cover,
                is_master_verified=args.verified,
                edit_note=args.note,
            )

            work_id = import_res.get("work_id")
            counts = import_res.get("imported_counts", {})
            print(f"{TerminalColor.GREEN}{TerminalColor.BOLD}入库成功 (Import Success)!{TerminalColor.RESET}")
            print(f"  Work ID     : {TerminalColor.CYAN}{work_id}{TerminalColor.RESET}")
            print(f"  Release ID  : {import_res.get('release_id')}")
            print(f"  详情页地址  : {args.api_base.replace('/api/v1', '')}{import_res.get('redirect_url')}")
            print(f"  导入统计    : {counts.get('artists', 0)} 位创作者, {counts.get('mediums', 0)} 介质, {counts.get('tracks', 0)} 音轨/分集")
            success_count += 1

        except Exception as e:
            print(f"{TerminalColor.RED}导入失败 (Import Failed): {e}{TerminalColor.RESET}")
            fail_count += 1

        if len(targets) > 1 and idx < len(targets):
            time.sleep(1.0)

    print(f"\n{TerminalColor.BOLD}=== 导入作业完成 ==={TerminalColor.RESET}")
    print(f"成功: {TerminalColor.GREEN}{success_count}{TerminalColor.RESET}, 失败: {TerminalColor.RED}{fail_count}{TerminalColor.RESET}")


if __name__ == "__main__":
    main()
