"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import {
  DownloadCloud,
  HardDrive,
  ShieldCheck,
  ExternalLink,
  KeyRound,
  FileCheck,
  Share2,
  Search,
  ArrowRight,
} from "lucide-react";

function DownloadsInner() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subject_id") || searchParams.get("ref") || "";

  const resourceBaseUrl = process.env.NEXT_PUBLIC_RESOURCE_STATION_URL || "https://resources.findverse.cc";
  const targetUrl = subjectId ? `${resourceBaseUrl}/subject/${encodeURIComponent(subjectId)}` : resourceBaseUrl;

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12 w-full flex-1">
        {/* Header Badge */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/[0.08] border border-sky-500/20 text-xs font-mono text-sky-400 mb-4">
            <HardDrive className="w-3.5 h-3.5" />
            <span>{locale === "zh-CN" ? "独立外围系统 · 资源存储与分发" : "Standalone Peripheral · Storage & Hub"}</span>
            <span className="text-white/20">•</span>
            <span>OAuth 2.0 SSO</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white flex items-center justify-center gap-3">
            <DownloadCloud className="w-8 h-8 text-primary" />
            <span>{t("catalogV2.resourceGatewayTitle")}</span>
          </h1>

          <p className="text-sm text-gray-400 mt-3 leading-relaxed">
            {t("catalogV2.resourceGatewayDesc")}
          </p>
        </div>

        {/* Contextual Jump for specific entity if subjectId is given */}
        {subjectId && (
          <div className="mb-8 p-6 rounded-2xl border border-primary/30 bg-primary/[0.04] shadow-lg">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-primary mb-1">
                  <Search className="w-3.5 h-3.5" />
                  <span>{locale === "zh-CN" ? "关联元数据条目资源检索" : "Contextual Entity Resource Lookup"}</span>
                </div>
                <div className="text-sm font-semibold text-white break-all">
                  UUID: <span className="font-mono text-gray-300">{subjectId}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {locale === "zh-CN"
                    ? "已自动捕获当前条目标识，点击右侧按钮直接在资源站打开该条目的专属下载镜像。"
                    : "Entity identifier detected. Click to navigate directly to its dedicated download mirrors in the Resource Station."}
                </p>
              </div>

              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-surface font-semibold text-sm transition-all shadow-md shrink-0"
              >
                <span>{locale === "zh-CN" ? "检索条目物理资源" : "Search Entity Assets"}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}

        {/* Main Gateway Card */}
        <div className="p-8 rounded-2xl border border-white/[0.08] bg-surface/60 backdrop-blur-xl shadow-xl text-center mb-10">
          <div className="max-w-xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 text-primary flex items-center justify-center mx-auto mb-5 shadow-inner">
              <ExternalLink className="w-7 h-7" />
            </div>

            <h2 className="text-xl font-bold text-white mb-3">
              {locale === "zh-CN" ? "访问独立资源存储中心" : "Access Independent Resource Hub"}
            </h2>

            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed mb-6">
              {locale === "zh-CN"
                ? "元数据站点（MetaFusion Core）专注于纯粹开放的创作元数据编目，不直接内嵌或托管用户大文件资源。物理文件存储、做种分流、高防 CDN 与下载管理全部由独立的资源存储中心统一驱动，基于 SHA-256 CAS 与 S3 对象存储集群运行。"
                : "The Metadata Core strictly handles cataloging and entity graphs without storing heavy binaries. Large physical assets, peer-to-peer distribution, CDN caching, and bandwidth management are completely handled by the independent Resource Station."}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href={resourceBaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-xl bg-primary hover:bg-primary/90 text-surface font-semibold text-sm transition-all shadow-lg hover:shadow-primary/20"
              >
                <span>{t("catalogV2.resourceGatewayVisit")}</span>
                <ArrowRight className="w-4 h-4" />
              </a>

              <Link
                href="/explore"
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 text-sm font-medium transition-colors"
              >
                <span>{locale === "zh-CN" ? "返回知识库浏览" : "Back to Catalog Explore"}</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.01]">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              {locale === "zh-CN" ? "统一 OAuth 2.0 单点登录" : "Unified OAuth 2.0 SSO"}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              {locale === "zh-CN"
                ? "资源站、元数据站与论坛三站使用统一通行证系统，一次登录即可无缝通行。"
                : "Resource Hub, Metadata Core, and Community Forum are all integrated via standard OAuth 2.0 for single sign-on."}
            </p>
          </div>

          <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.01]">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mb-3">
              <FileCheck className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              {locale === "zh-CN" ? "SHA-256 CAS 内容寻址" : "SHA-256 CAS Verification"}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              {locale === "zh-CN"
                ? "所有归档资源均生成规范的哈希校验值，防篡改并支持多源去重与断点续传。"
                : "Every physical asset is indexed by its canonical cryptographic hash, guaranteeing tamper-proof content delivery."}
            </p>
          </div>

          <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.01]">
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
              <Share2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              {locale === "zh-CN" ? "多元分流下载矩阵" : "Multi-protocol Distribution"}
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              {locale === "zh-CN"
                ? "支持 HTTP 高速直链分流、BitTorrent/WebTorrent 做种分发及第三方网盘镜像。"
                : "Supports high-speed HTTP downloads, BitTorrent/WebTorrent peer delivery, and distributed community mirrors."}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">
          Loading...
        </div>
      }
    >
      <DownloadsInner />
    </Suspense>
  );
}
