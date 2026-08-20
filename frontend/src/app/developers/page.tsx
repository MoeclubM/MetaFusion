"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import {
  Code2,
  KeyRound,
  Search,
  BookOpen,
  Layers,
  Users,
  Disc,
  Database,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  Shield,
  Zap,
  Globe,
  FileJson,
  ArrowRight,
  Sparkles,
  Bot,
  Box,
  MessageSquare,
} from "lucide-react";

const API_BASE = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_BASE || "/api/v1") : "/api/v1";

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="relative group rounded-md bg-black/90 border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/10">
        <span className="font-mono text-[11px] text-white/50 uppercase tracking-widest">{lang}</span>
        <button onClick={copy} className="inline-flex items-center gap-1 text-[11px] font-mono text-white/60 hover:text-white transition-colors">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-emerald-300/90 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">{code}</pre>
    </div>
  );
}

function Section({ id, title, icon: Icon, children }: { id?: string; title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white tracking-tight">
        {Icon && <Icon className="w-4 h-4 text-primary" />}
        <span>{title}</span>
      </h2>
      <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/70 backdrop-blur p-4 space-y-3">{children}</div>
    </section>
  );
}

export default function DevelopersPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [playQ, setPlayQ] = useState("攻壳机动队");
  const [playType, setPlayType] = useState("work");
  const [playResult, setPlayResult] = useState<string>("");
  const [playLoading, setPlayLoading] = useState(false);

  const runPlay = async () => {
    setPlayLoading(true);
    setPlayResult("");
    try {
      const base = (process.env.NEXT_PUBLIC_API_BASE as string) || "/api/v1";
      const url = `${base}/search?q=${encodeURIComponent(playQ)}&type=${playType}&limit=3`;
      const res = await fetch(url, { headers: { "User-Agent": "MetaFusion Playground/1.0 (developers demo)" } });
      const j = await res.json();
      setPlayResult(JSON.stringify(j, null, 2));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPlayResult(msg);
    } finally {
      setPlayLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Hero */}
        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/70 backdrop-blur p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] tracking-widest text-primary uppercase">
                <Terminal className="w-3.5 h-3.5" />
                <span>MetaFusion Open API — MusicBrainz WS/2 Inspired</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">为应用与 Agent 构建的开放编目 API</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 max-w-3xl leading-relaxed">
                类似 MusicBrainz WS/2 的 Lookup / Browse / Search 三元组，支持 <span className="font-mono text-xs bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">inc</span> 展开、
                <span className="font-mono text-xs bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">fmt=json</span>、
                <span className="font-mono text-xs bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">User-Agent</span> 识别与 PAT 机器令牌。游客可浏览元数据，写入与媒体需认证 — 网页端全部功能均可经 API 复现。
              </p>
            </div>
            <div className="flex flex-col gap-2 min-w-[220px]">
              <a
                href="/api/v1/openapi.json"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 h-9 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                <FileJson className="w-4 h-4" />
                <span>OpenAPI 3.1 JSON</span>
                <ExternalLink className="w-3 h-3 opacity-70" />
              </a>
              <div className="flex gap-2">
                <Link href={user ? "/settings?tab=tokens" : "/login"} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-xs font-medium hover:bg-black/[0.06] dark:hover:bg-white/[0.10] transition-colors">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{user ? "管理 PAT" : "登录创建 PAT"}</span>
                </Link>
                <a href="#playground" className="inline-flex items-center gap-1 px-3 h-8 rounded-md bg-white dark:bg-white text-black text-xs font-semibold hover:bg-gray-100 transition-colors">
                  <span>Try it</span>
                  <ArrowRight className="w-3 h-3" />
                </a>
              </div>
              <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Base URL: /api/v1</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-sky-500" />
              <span>Metadata 开放</span>
            </div>
            <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span>Media 需认证</span>
            </div>
            <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-emerald-500" />
              <span>60→600 req/min</span>
            </div>
            <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 flex items-center gap-2">
              <Bot className="w-3.5 h-3.5 text-purple-500" />
              <span>Agent Friendly</span>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar nav */}
          <aside className="hidden lg:block sticky top-16 self-start rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/70 backdrop-blur p-3 space-y-1 font-mono text-xs">
            <div className="text-[11px] tracking-widest text-gray-500 uppercase px-2 py-1">目录</div>
            {[
              ["auth", "认证与 PAT"],
              ["lookup", "Lookup 查询"],
              ["browse", "Browse 浏览"],
              ["search", "Search 检索"],
              ["edit", "新建与编辑"],
              ["community", "社区与私聊"],
              ["storage", "上传与下载"],
              ["agent", "Agent 接入"],
              ["playground", "在线试玩"],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                {label}
              </a>
            ))}
            <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-1">
              <div className="text-[11px] tracking-widest text-gray-500 uppercase px-2 py-1">资源</div>
              <a href="/api/v1/openapi.json" target="_blank" className="block px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1">
                <FileJson className="w-3 h-3" />
                <span>openapi.json</span>
              </a>
              <Link href="/explore" className="block px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1">
                <Search className="w-3 h-3" />
                <span>站内探索</span>
              </Link>
            </div>
          </aside>

          <div className="space-y-6">
            <Section id="auth" title="认证与 PAT（MusicBrainz 机器接入对等）" icon={KeyRound}>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                两种凭证均写入 <span className="font-mono bg-black/5 dark:bg-white/10 px-1 rounded">Authorization: Bearer &lt;token&gt;</span>，也支持 <span className="font-mono bg-black/5 dark:bg-white/10 px-1 rounded">X-API-Key: mfp_...</span>。匿名可读，写入一律需认证。
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 space-y-1">
                  <div className="font-mono text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500" />
                    <span>JWT Bearer（短期，7天）</span>
                  </div>
                  <p className="text-[11px] text-gray-500">登录获取：POST /api/v1/auth/login</p>
                  <CodeBlock lang="bash" code={`curl -X POST /api/v1/auth/login \\\n  -H "Content-Type: application/json" \\\n  -d '{"email_or_username":"alice","password":"***"}'\n# => { user, token }`} />
                </div>
                <div className="p-3 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 space-y-1">
                  <div className="font-mono text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>PAT mfp_（长期，供应用/Agent）</span>
                  </div>
                  <p className="text-[11px] text-gray-500">登录后创建：POST /api/v1/auth/tokens（JWT 鉴权）</p>
                  <CodeBlock lang="bash" code={`curl -X POST /api/v1/auth/tokens \\\n  -H "Authorization: Bearer $JWT" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"my-agent","scopes":["read","write"]}'\n# => { token: "mfp_..." }  # 明文仅此一次！`} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="font-mono text-xs font-semibold">调用示例（PAT）</div>
                <CodeBlock
                  code={`# 读：游客或 PAT 均可\ncurl "/api/v1/catalog/works?inc=artists&page=1&page_size=5" \\\n  -H "User-Agent: MyApp/1.0 (me@example.com)"\n\n# 写：需 PAT/JWT\ncurl -X POST /api/v1/catalog/works \\\n  -H "Authorization: Bearer mfp_..." \\\n  -H "User-Agent: MyApp/1.0 (me@example.com)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"新作品","media_type":"anime","edit_note":"initial import","source_urls":["https://..."]}'`}
                />
                <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                  <span className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">scopes: read</span>
                  <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20">write</span>
                  <span className="px-2 py-1 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/20">edit</span>
                  <span className="px-2 py-1 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/20">upload</span>
                  <span className="px-2 py-1 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/20">community</span>
                </div>
                <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" />
                  <span>限流：匿名 60/min，认证 600/min；未设置有意义 User-Agent 的写入请求将返回 400。响应头包含 X-RateLimit-*。</span>
                </p>
              </div>
            </Section>

            <Section id="lookup" title="Lookup — 实体详情与 inc 展开" icon={BookOpen}>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                单实体查询，对应网页端详情页。MusicBrainz 风格 <span className="font-mono bg-black/5 dark:bg-white/10 px-1 rounded">inc</span> 控制关联展开，<span className="font-mono bg-black/5 dark:bg-white/10 px-1 rounded">fmt=json</span> 固定为 JSON。
              </p>
              <CodeBlock code={`GET /api/v1/catalog/works/{id}?inc=releases+relations+revisions&fmt=json\nGET /api/v1/catalog/releases/{id}?inc=relations+revisions\nGET /api/v1/catalog/artists/{id}?inc=works+releases\nGET /api/v1/catalog/mediums/{id}\n# WS/2 兼容别名\nGET /api/v1/ws/2/work/{id}?inc=releases+artists\nGET /api/v1/ws/2/release/{id}\nGET /api/v1/ws/2/artist/{id}`} />
              <CodeBlock lang="bash" code={`curl "/api/v1/catalog/works/<work_id>?inc=releases+artists" \\\n  -H "User-Agent: MyApp/1.0 (me@example.com)" | jq .`} />
              <div className="grid sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-black/5 dark:bg-white/5">inc=artists → ArtistRelations 展开</div>
                <div className="p-2 rounded bg-black/5 dark:bg-white/5">inc=releases → 首 50 发行版</div>
                <div className="p-2 rounded bg-black/5 dark:bg-white/5">inc=relations → EntityRelationship 图谱边</div>
                <div className="p-2 rounded bg-black/5 dark:bg-white/5">inc=revisions → 最近 20 条修订</div>
              </div>
            </Section>

            <Section id="browse" title="Browse — 按关联实体枚举" icon={Layers}>
              <p className="text-xs text-gray-600 dark:text-gray-400">对应网页端探索页与关联列表，支持分页与 inc。</p>
              <CodeBlock code={`GET /api/v1/browse/works?artist=<artist_id>&tag=<tag>&category=<code>&page=1&page_size=24&inc=artists\nGET /api/v1/browse/releases?artist=<artist_id>&work=<work_id>&inc=work\nGET /api/v1/browse/artists?work=<work_id>&collaborator=<artist_id>&q=keyword`} />
              <CodeBlock lang="javascript" code={`// JS SDK 风格\nconst works = await fetchApi("/browse/works?artist=" + artistId + "&inc=artists");\nconst releases = await fetchApi("/browse/releases?work=" + workId);\nconst collaborators = await fetchApi("/browse/artists?work=" + workId);`} />
            </Section>

            <Section id="search" title="Search — 全文检索（ES 优先，SQL 降级）" icon={Search}>
              <p className="text-xs text-gray-600 dark:text-gray-400">游客开放，支持 type 过滤，与站内搜索同源。</p>
              <CodeBlock code={`GET /api/v1/search?q=攻壳机动队&type=work&limit=10&offset=0\nGET /api/v1/search?q=久石让&type=artist&limit=10\nGET /api/v1/search?q=VIZL&type=release\nGET /api/v1/search?q=keyword&type=all&limit=5`} />
              <CodeBlock lang="bash" code={`curl "/api/v1/search?q=blade+runner&type=work&limit=5" \\\n  -H "User-Agent: MyApp/1.0 (me@example.com)"`} />
            </Section>

            <Section id="edit" title="新建与编辑 — 网页端完整功能对等" icon={Code2}>
              <p className="text-xs text-gray-600 dark:text-gray-400">所有创建/编辑均需认证，自动写入 EntityRevision（edit_note/source_urls），与前端 Универсальный编辑器一致。</p>
              <div className="space-y-2">
                <div className="font-mono text-xs font-semibold">新建</div>
                <CodeBlock code={`POST /api/v1/catalog/artists        { name, entity_type, ... , edit_note, source_urls }\nPOST /api/v1/catalog/works          { title, media_type, catalog_metadata, edit_note }\nPOST /api/v1/catalog/releases       { work_id, edition_name, catalog_number, ... }\nPOST /api/v1/catalog/mediums        { release_id, position, name, format }\nPOST /api/v1/catalog/tracks         { medium_id, canonical_entry_id, position }\nPOST /api/v1/catalog/submit         # 一站式综合提交（Work+Release+Medium+Track+Relations）`} />
                <div className="font-mono text-xs font-semibold">编辑</div>
                <CodeBlock code={`PUT /api/v1/catalog/works/{id}      { title?, summary?, edit_note, source_urls }\nPUT /api/v1/catalog/artists/{id}    { name?, biography?, edit_note }\nPUT /api/v1/catalog/releases/{id}   { edition_name?, edit_note }\nPUT /api/v1/catalog/works/{id}/relations  { relations: [...] }\nPOST /api/v1/catalog/merge          { source_type, source_id, target_id, edit_note }\nGET  /api/v1/catalog/revisions?target_type=work&target_id={id}`} />
                <CodeBlock lang="bash" code={`curl -X PUT /api/v1/catalog/works/<id> \\\n  -H "Authorization: Bearer mfp_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"修正标题","edit_note":"fix typo per official site","source_urls":["https://example.com"]}'`} />
              </div>
            </Section>

            <Section id="community" title="社区与私聊" icon={MessageSquare}>
              <CodeBlock code={`GET  /api/v1/community/boards\nGET  /api/v1/community/topics?board_code=announcement&page=1\nGET  /api/v1/community/topics/{id}   # 含 posts 流\nPOST /api/v1/community/topics        { board_code, title, content, work_id?, tag_ids? }  # 需认证\nPOST /api/v1/community/topics/{id}/posts  { content, reply_to_post_number? }  # 需认证\nPOST /api/v1/messages/with/{user_id}  { content }\nGET  /api/v1/messages/with/{user_id}?page=1\nGET  /api/v1/messages/conversations\nGET  /api/v1/users/{id}\nGET  /api/v1/users/{id}/contributions`} />
            </Section>

            <Section id="storage" title="上传与下载（媒体受控）" icon={Box}>
              <p className="text-xs text-gray-600 dark:text-gray-400">全部需认证，预签名直传 S3，与前端上传器同链路。</p>
              <CodeBlock code={`POST /api/v1/storage/upload/initiate  { file_name, file_size, sha256_hash, mime_type, release_id? } -> { s3_key, upload_urls, dedup }\nPOST /api/v1/storage/upload/complete  { s3_key, file_name, ... }\nGET  /api/v1/storage/download/{asset_id} -> { download_url }  # 2h 预签名`} />
            </Section>

            <Section id="agent" title="Agent 接入（LLM 工具调用）" icon={Bot}>
              <p className="text-xs text-gray-600 dark:text-gray-400">将 OpenAPI 作为工具描述喂给模型，或按以下 prompt 模板让 Agent 自主编目。</p>
              <CodeBlock lang="json" code={`{\n  "tools": [{\n    "name": "metafusion_search",\n    "description": "Search works/artists/releases",\n    "parameters": { "q": "string", "type": "work|artist|release|all" },\n    "endpoint": "GET /api/v1/search"\n  }, {\n    "name": "metafusion_lookup_work",\n    "description": "Lookup work with inc",\n    "parameters": { "id": "uuid", "inc": "releases+relations" }\n  }]\n}`} />
              <CodeBlock lang="python" code={`# Python Agent 示例\nimport requests\nBASE="https://your-host/api/v1"\nH={"Authorization":"Bearer mfp_...","User-Agent":"MyAgent/1.0 (agent@example.com)"}\n# 搜索\nr=requests.get(f"{BASE}/search", params={"q":"千与千寻","type":"work"}, headers=H).json()\nwork_id=r["works"][0]["id"]\n# 详情展开\nwork=requests.get(f"{BASE}/catalog/works/{work_id}", params={"inc":"releases+artists"}, headers=H).json()\n# 编辑（需 edit_note）\nrequests.put(f"{BASE}/catalog/works/{work_id}", headers=H, json={\n  "summary":"新概要","edit_note":"agent enrichment","source_urls":["https://..."]\n})`} />
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-100">
                <div className="font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Agent 准则</span>
                </div>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-amber-800 dark:text-amber-200/90">
                  <li>每次写入必须带 edit_note 与 source_urls（可追溯）</li>
                  <li>优先搜索复用现存实体，避免重复创建</li>
                  <li>遵守限流与 User-Agent 标识，批量任务间隔 ≥1s</li>
                </ul>
              </div>
            </Section>

            <Section id="playground" title="在线试玩（无需登录）" icon={Zap}>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={playQ} onChange={(e) => setPlayQ(e.target.value)} placeholder="关键词，如 攻壳机动队" className="flex-1 h-9 px-3 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:border-primary" />
                <select value={playType} onChange={(e) => setPlayType(e.target.value)} className="h-9 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm">
                  <option value="work">work</option>
                  <option value="artist">artist</option>
                  <option value="release">release</option>
                  <option value="all">all</option>
                </select>
                <button onClick={runPlay} disabled={playLoading} className="px-4 h-9 rounded-md bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {playLoading ? "请求中…" : "搜索"}
                </button>
              </div>
              {playResult && (
                <div className="rounded-md bg-black/90 border border-white/10 p-3 overflow-auto max-h-[400px]">
                  <pre className="text-xs font-mono text-emerald-300/90 whitespace-pre-wrap break-words">{playResult}</pre>
                </div>
              )}
              <p className="text-[11px] text-gray-500">等效 curl：GET /api/v1/search?q={playQ}&type={playType} — 游客开放</p>
            </Section>

            <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/70 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-gray-600 dark:text-gray-400">
                网页端全部功能均已开放为 API：浏览 / 新建 / 编辑 / 合并 / 修订历史 / 社区 / 私聊 / 上传 / 下载。
              </div>
              <div className="flex gap-2">
                <a href="/api/v1/openapi.json" target="_blank" className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-black text-white text-xs font-medium hover:bg-black/80">
                  <FileJson className="w-3.5 h-3.5" />
                  <span>查看 OpenAPI</span>
                </a>
                <Link href="/explore" className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-primary text-white text-xs font-semibold hover:opacity-90">
                  <Database className="w-3.5 h-3.5" />
                  <span>去探索站内数据</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
