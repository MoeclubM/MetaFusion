"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import {
  DownloadCloud,
  HardDrive,
  FileCheck,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Layers,
  Disc,
  Clock,
  Copy,
  Check,
} from "lucide-react";

interface ResourceItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
  created_at: string;
  entity_id: string;
}

function DownloadsInner() {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [archiveEnabled, setArchiveEnabled] = useState<boolean | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(true);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v2/capabilities", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { modules: [] }))
      .then((d) => {
        const archiveMod = d.modules?.find((m: any) => m.id === "archive");
        setArchiveEnabled(!!archiveMod?.enabled);
      })
      .catch(() => setArchiveEnabled(false))
      .finally(() => setLoadingCaps(false));
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 w-full flex-1">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/[0.06]">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-xs font-mono text-gray-400 mb-3">
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              <span>{locale === "zh-CN" ? "独立外围模块" : "Detached Peripheral"}</span>
              <span className="text-white/20">•</span>
              <span>SHA-256 CAS</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <DownloadCloud className="w-7 h-7 text-primary" />
              <span>{locale === "zh-CN" ? "资源存储与下载管理中心" : "Storage & Download Center"}</span>
            </h1>
            <p className="text-sm text-gray-400 mt-1 max-w-2xl leading-relaxed">
              {locale === "zh-CN"
                ? "物理文件归档与元数据核心严格解耦。下载基于实体权限授权，提供端到端内容哈希校验。"
                : "Decoupled CAS storage and download delivery with SHA-256 hash verification."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/explore"
              className="px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-mono text-gray-300 transition-colors"
            >
              {locale === "zh-CN" ? "浏览关联条目 →" : "Explore Entities →"}
            </Link>
          </div>
        </div>

        {loadingCaps ? (
          <div className="py-20 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span>{locale === "zh-CN" ? "检测下载服务状态..." : "Checking archive capabilities..."}</span>
          </div>
        ) : !archiveEnabled ? (
          <div className="p-8 rounded-2xl border border-white/10 bg-white/[0.02] text-center max-w-xl mx-auto my-12">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">
              {locale === "zh-CN" ? "资源归档模块当前处于停用状态" : "Storage Module is Disabled"}
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed mb-6">
              {locale === "zh-CN"
                ? "根据 MetaFusion 的解耦设计，元数据核心在零文件环境下独立运行。物理资源存储与下载服务当前已安全关闭。管理员可在后台一键开启该模块。"
                : "Metadata core operates standalone. Physical storage is currently disabled and can be enabled by an administrator in the admin console."}
            </p>

            {user?.role === "admin" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium"
              >
                <span>{locale === "zh-CN" ? "前往后台管理开启模块" : "Manage in Admin Panel"}</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="p-5 rounded-xl border border-white/[0.06] bg-emerald-500/[0.03] flex items-center gap-3.5">
              <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
              <div className="text-xs text-gray-300 leading-relaxed">
                <span className="font-semibold text-white">
                  {locale === "zh-CN" ? "归档模块正常运行：" : "Storage Service Online: "}
                </span>
                {locale === "zh-CN"
                  ? "支持内容寻址存储（CAS）与 S3 对象存储驱动。资源下载在条目详情页内按需挂载并进行权限验证。"
                  : "Content Addressable Storage (CAS) is active. Downloads are mounted contextually on entity pages."}
              </div>
            </div>

            <div className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.01]">
              <h2 className="text-base font-semibold text-white mb-2">
                {locale === "zh-CN" ? "如何进行文件下载与校验？" : "How to Download & Verify Files?"}
              </h2>
              <ol className="list-decimal list-inside space-y-2 text-xs text-gray-400 leading-relaxed">
                <li>
                  {locale === "zh-CN"
                    ? "在作品或发行版本详情页面中，展开底部的“物理资源与下载”面板。"
                    : "Navigate to any Work or Release entity and open the detached Resources panel."}
                </li>
                <li>
                  {locale === "zh-CN"
                    ? "公开资源的下载链接直接开放；私有资源需所有者或具备归档权限的账号登录后下载。"
                    : "Public resources are openly accessible. Private resources require authentication."}
                </li>
                <li>
                  {locale === "zh-CN"
                    ? "每个文件均提供官方 SHA-256 校验哈希，下载完成后可使用 sha256sum 核对文件完整性。"
                    : "Every file provides a canonical SHA-256 hash. Verify integrity using sha256sum."}
                </li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">Loading...</div>}>
      <DownloadsInner />
    </Suspense>
  );
}
