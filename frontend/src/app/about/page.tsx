"use client";

import React from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import {
  Layers,
  GitCompare,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  Code2,
  Compass,
} from "lucide-react";

export default function AboutLandingPage() {
  const { locale } = useI18n();

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100">
      <Navbar />

      {/* Hero Showcase */}
      <section className="relative overflow-hidden pt-12 pb-16 md:pt-20 md:pb-24 border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-mono text-gray-300 mb-6">
            <BrandMark size={16} withGlow={false} />
            <span>METAFUSION PLATFORM</span>
            <span className="text-white/20">•</span>
            <span className="text-primary font-semibold">
              {locale === "zh-CN" ? "固定实体骨架 · 动态属性与关系" : "Fixed Core · Dynamic Definitions"}
            </span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white mb-5 leading-[1.15]">
            {locale === "zh-CN" ? (
              <>
                跨媒介开放媒体 <span className="text-primary">元数据平台与知识图谱</span>
              </>
            ) : (
              <>
                Open Cross-Media <span className="text-primary">Metadata & Knowledge Graph</span>
              </>
            )}
          </h1>

          <p className="text-base sm:text-lg text-gray-400 max-w-3xl mx-auto mb-8 leading-relaxed">
            {locale === "zh-CN"
              ? "MetaFusion 彻底抛弃硬编码媒体树，采用 9 大固定骨架支撑所有艺术形式。商业专辑、限定附录、分季动画、轻小说章节、独立游戏与个人写真，皆以清晰严谨的图谱关系相互联结。"
              : "MetaFusion eliminates hardcoded media trees, using a 9-entity core skeleton to express all creative works. Commercial albums, limited editions with BDs, serial anime, novel chapters, indie games, and personal creations form a coherent knowledge graph."}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-sm transition-all shadow-md shadow-primary/20"
            >
              <span>{locale === "zh-CN" ? "进入主页分类货架" : "Enter Categorized Shelves"}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-medium text-sm transition-all"
            >
              <Compass className="w-4 h-4 text-sky-400" />
              <span>{locale === "zh-CN" ? "全域探索中心" : "Explore Archive"}</span>
            </Link>

            <a
              href="/docs/catalog"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 font-medium text-sm transition-all"
            >
              <BookOpen className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "编目指南" : "Curation Guide"}</span>
            </a>

            <a
              href="/api/docs"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-300 font-medium text-sm transition-all"
            >
              <Code2 className="w-4 h-4" />
              <span>{locale === "zh-CN" ? "OpenAPI 交互式文档" : "API Reference"}</span>
            </a>
          </div>
        </div>
      </section>

      {/* Architecture Deep Dive */}
      <section className="py-16 md:py-20 border-b border-white/[0.06] bg-surface/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              {locale === "zh-CN" ? "三大架构革新" : "Three Architectural Innovations"}
            </h2>
            <p className="text-sm text-gray-400 max-w-xl mx-auto">
              {locale === "zh-CN"
                ? "解决传统媒体数据库条目冗余、限定版表达僵化与商业偏向排他的结构性缺陷"
                : "Addressing redundant entries, rigid editions, and commercial exclusivity"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center border border-sky-500/20">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base">
                {locale === "zh-CN" ? "创作身份与物理发售分离" : "Creation Identity vs. Releases"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "歌曲独立成作品，录音独立为 Expression。同一首歌曲的母带录音，可被单曲 CD、后续正规专辑、十周年黑胶 LP 与数字精选集同时收录，通过反向收录矩阵一眼溯源，绝无重复数据。"
                  : "Tracks exist as independent works with master expressions. A single recording can be included across single CDs, full albums, vinyl LPs, and digital releases with automatic reverse lookup."}
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                <GitCompare className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base">
                {locale === "zh-CN" ? "多版本发售与复合介质收录" : "Multi-Edition & Disc Sets"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "严谨刻画同一作品的通常盘、送 MV/Live 蓝光盘的限定盘与海外版。物理载体 CD 与 BD 明确分离并各自挂载独立创作者阵容，盘内曲目与外部店铺特典界限分明。"
                  : "Rigorous distinction of regular discs, BD-included limited sets, and regional releases. CDs and BDs carry distinct production credits, with store bonuses decoupled from physical media."}
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base">
                {locale === "zh-CN" ? "外围解耦 · 纯元数据自洽运行" : "Decoupled Outer Ecosystem"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "元数据核心只依赖 PostgreSQL，无需上传文件也能为个人写真或独立游戏完整建档。文件归档、媒体转码、在线播放、社区论坛与下载管理均为外围可选模块，互相隔离、互不拖垮。"
                  : "Core metadata operates autonomously on PostgreSQL without files. S3 archiving, transcode workers, player sessions, and forum discussions are pluggable peripherals."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 9 Core Entities */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-white">
            {locale === "zh-CN" ? "9 大固定实体骨架" : "The 9 Core Entities"}
          </h2>
          <p className="text-xs text-gray-400">
            {locale === "zh-CN"
              ? "结构固定严谨保证引用完整，类型与属性由后台 GUI 动态定义"
              : "Fixed skeleton guaranteeing integrity, dynamic types designed via GUI"}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 text-xs font-mono">
          {[
            { name: "Collection (集合)", desc: "跨媒介企划、系列与概念聚合" },
            { name: "Work (作品)", desc: "独立创作身份实体（单曲、专辑、小说、游戏）" },
            { name: "ContentUnit (内容单元)", desc: "分卷、分集、篇目与路线节点" },
            { name: "Expression (内容表达)", desc: "具体录音母带、译文、剪辑版本" },
            { name: "Release (发行版本)", desc: "具体公开发售或发布的版本（通常盘、限定盘）" },
            { name: "Medium (物理载体)", desc: "发行内的实际承载单元（CD、BD、平装书、数字包）" },
            { name: "Track (收录位置)", desc: "盘面曲目序、光盘章节、篇目位置" },
            { name: "Agent (主体)", desc: "创作者、团体、角色、厂商、组织" },
            { name: "TrackContent (收录映射)", desc: "将位置精确映射至具体创作表达，支持跨作品复用" },
          ].map((item, idx) => (
            <div key={idx} className="p-3.5 rounded-xl border border-white/10 bg-white/[0.02]">
              <div className="font-bold text-white mb-1 text-sm">{item.name}</div>
              <div className="text-gray-400 font-sans text-xs">{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center text-xs font-mono text-gray-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>© 2026 MetaFusion · Open Metadata Platform</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "分类货架" : "Shelves"}
            </Link>
            <Link href="/explore" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "探索中心" : "Explore"}
            </Link>
            <Link href="/community" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "社区论坛" : "Community"}
            </Link>
            <Link href="/downloads" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "资源中心" : "Downloads"}
            </Link>
            <a href="/docs/catalog" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "编目指南" : "Docs"}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
