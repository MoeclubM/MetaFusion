"use client";

import React, { useState } from "react";
import { Zap, Play, Check, Copy, FileJson, KeyRound, ExternalLink } from "lucide-react";

export function ApiPlayground() {
  const [q, setQ] = useState("攻壳机动队");
  const [type, setType] = useState("work");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const runSearch = async () => {
    setLoading(true);
    setResult("");
    try {
      const url = `/api/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=3`;
      const res = await fetch(url, {
        headers: { "User-Agent": "MetaFusion Docs Playground/1.0" },
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const curlCmd = `curl "/api/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=3" \\\n  -H "User-Agent: MyApp/1.0 (you@example.com)"`;

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curlCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="my-6 rounded-xl border border-primary/20 bg-primary/[0.03] dark:bg-primary/[0.05] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 dark:border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary text-white grid place-items-center">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-900 dark:text-white">API 在线试玩（Playground）</div>
            <div className="font-mono text-[11px] text-gray-500">免登录 · 直接发起真实 API 请求</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-mono transition-colors"
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>OpenAPI JSON</span>
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
          <a
            href="/settings?tab=tokens"
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 text-xs font-mono transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>管理 PAT</span>
          </a>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入检索关键词，如 攻壳机动队 / 久石让"
          className="flex-1 h-9 px-3 rounded-md bg-white dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:border-primary font-mono"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 px-2.5 rounded-md bg-white dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-sm font-mono"
        >
          <option value="work">work (作品)</option>
          <option value="artist">artist (创作者)</option>
          <option value="release">release (发行版)</option>
          <option value="all">all (全部)</option>
        </select>
        <button
          type="button"
          onClick={runSearch}
          disabled={loading}
          className="px-4 h-9 rounded-md bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-xs transition-opacity"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{loading ? "请求中…" : "发送请求"}</span>
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-gray-500">
          <span>等效 cURL 命令：</span>
          <button onClick={copyCurl} className="hover:text-primary transition-colors flex items-center gap-1">
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "已复制" : "复制命令"}</span>
          </button>
        </div>
        <pre className="p-2.5 rounded-md bg-black/90 text-emerald-400 font-mono text-xs overflow-x-auto leading-relaxed border border-white/10">{curlCmd}</pre>
      </div>

      {result && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-mono text-gray-500">响应结果（Response JSON）：</div>
          <pre className="p-3 rounded-md bg-black/90 text-emerald-300 font-mono text-xs overflow-auto max-h-[300px] leading-relaxed border border-white/10 whitespace-pre-wrap break-words">{result}</pre>
        </div>
      )}
    </div>
  );
}
