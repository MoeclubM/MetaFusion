"use client";

import React from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useI18n } from "@/i18n/I18nProvider";
import { BrandMark } from "@/components/Logo";
import {
  Compass,
  Layers,
  Disc,
  Users,
  Database,
  ShieldCheck,
  HardDrive,
  MessageSquare,
  FileCode,
  ArrowRight,
  GitCompare,
  Sparkles,
  BookOpen,
} from "lucide-react";

export default function AboutPage() {
  const { t, locale } = useI18n();

  const subsystems = [
    {
      title_zh: "元数据编目系统 (Catalog)",
      title_en: "Metadata Catalog System",
      desc_zh: "固定实体骨架（Agent、Work、ContentUnit、Expression、Release、Medium、Track），支持多版本发行比对、曲目收录映射与动态关系定义。",
      desc_en: "Fixed entity backbone supporting multi-edition releases, track mapping, and configurable relations.",
      icon: Layers,
      color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
      href: "/explore",
      action_zh: "探索目录 ↗",
      action_en: "Explore Catalog ↗",
    },
    {
      title_zh: "统一身份与账号中心 (Auth / Identity)",
      title_en: "Identity & Account Center",
      desc_zh: "独立账号认证系统，支持标准 OAuth2 / OIDC 授权码与客户端凭证流，为元数据、社区论坛与资源站提供统一单点登录与权限管理。",
      desc_en: "Decoupled authentication providing OAuth2/OIDC SSO across catalog, forum, and resource portals.",
      icon: ShieldCheck,
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      href: "/account",
      action_zh: "账号中心 ↗",
      action_en: "Account Center ↗",
    },
    {
      title_zh: "社区与论坛系统 (Community / Forum)",
      title_en: "Community & Forum System",
      desc_zh: "围绕作品、角色、创作者与版本的深度探讨、条目审校与交流板块。通过实体 UUID 与核心元数据松耦合关联。",
      desc_en: "In-depth discussions and editorial review boards loosely coupled to catalog entities via UUID.",
      icon: MessageSquare,
      color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
      href: "/community",
      action_zh: "进入社区 ↗",
      action_en: "Enter Forum ↗",
    },
    {
      title_zh: "资源归档与下载中心 (Storage / Downloads)",
      title_en: "Archive & Storage Center",
      desc_zh: "多节点对象存储与文件归档中心，支持哈希校验、去重存储与下载管理。完全与元数据解耦，不影响公开档案浏览。",
      desc_en: "Multi-node object storage with hash verification and download delivery, decoupled from metadata.",
      icon: HardDrive,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      href: "/downloads",
      action_zh: "下载管理 ↗",
      action_en: "Downloads ↗",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-gray-100 relative selection:bg-primary selection:text-white">
      {/* Background ambient light */}
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[150px] pointer-events-none" aria-hidden />

      <Navbar />

      {/* Hero Core */}
      <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-12 pb-16 text-center space-y-6">
        {/* BrandMark Glowing Logo */}
        <div className="inline-block relative group mb-2">
          <div className="absolute inset-0 bg-primary/25 rounded-full blur-2xl transform scale-125 group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
          <BrandMark size={88} withGlow={true} idSuffix="about-hero" className="relative z-10 drop-shadow-2xl mx-auto" />
        </div>

        {/* Tagline Badge */}
        <div>
          <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-primary/10 border border-primary/25 font-mono text-xs uppercase tracking-widest text-primary font-semibold">
            <Database className="w-3.5 h-3.5" />
            <span>METAFUSION PLATFORM</span>
          </span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
          {locale === "zh-CN" ? (
            <>
              跨媒介开放元数据与 <span className="text-primary">多模块解耦架构</span>
            </>
          ) : (
            <>
              Open Cross-Media Metadata & <span className="text-primary">Modular Architecture</span>
            </>
          )}
        </h1>

        <p className="text-base sm:text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
          {locale === "zh-CN"
            ? "MetaFusion 致力于构建严谨、纯净且灵活的多媒体元数据体系。采用固定实体骨架保障引用完整，配合动态分类货架驱动浏览；四大核心服务彻底解耦，独立运行。"
            : "MetaFusion builds a strict yet flexible cross-media metadata platform with fixed entity integrity and dynamic shelves, separating core catalog from peripheral modules."}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            <Sparkles className="w-4 h-4" />
            <span>{locale === "zh-CN" ? "浏览分类货架" : "Browse Virtual Shelves"}</span>
          </Link>

          <Link
            href="/explore"
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-200 font-medium text-sm transition-all"
          >
            <Compass className="w-4 h-4 text-sky-400" />
            <span>{locale === "zh-CN" ? "全域目录检索" : "Explore Catalog"}</span>
          </Link>

          <a
            href="/docs/catalog"
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-400 hover:text-white font-medium text-sm transition-all"
          >
            <BookOpen className="w-4 h-4" />
            <span>{locale === "zh-CN" ? "编目规范指南" : "Catalog Guidelines"}</span>
          </a>
        </div>
      </section>

      {/* Decoupled Subsystems Grid */}
      <section className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-10 w-full">
        <div className="border-b border-white/[0.06] pb-4 mb-8 text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {locale === "zh-CN" ? "四系统解耦与微服务边界" : "Four Decoupled Subsystems"}
          </h2>
          <p className="text-xs text-gray-400 mt-1 max-w-xl mx-auto">
            {locale === "zh-CN"
              ? "统一网关路由反代，服务间数据与运行时完全独立，支持单独水平扩展与灾备。"
              : "Unified gateway routing with fully detached runtime services and storage schemas."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {subsystems.map((sys, idx) => {
            const Icon = sys.icon;
            return (
              <div
                key={idx}
                className="p-6 rounded-2xl border border-white/[0.08] bg-surface/80 backdrop-blur-md flex flex-col justify-between hover:border-primary/40 transition-all shadow-sm group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={"w-10 h-10 rounded-xl border flex items-center justify-center " + sys.color}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-[11px] text-gray-500 uppercase tracking-widest">
                      SERVICE 0{idx + 1}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-primary transition-colors">
                    {locale === "zh-CN" ? sys.title_zh : sys.title_en}
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {locale === "zh-CN" ? sys.desc_zh : sys.desc_en}
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-white/[0.04] flex justify-end">
                  <Link
                    href={sys.href}
                    className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors"
                  >
                    <span>{locale === "zh-CN" ? sys.action_zh : sys.action_en}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Architectural Pillars */}
      <section className="relative z-10 border-t border-white/[0.06] bg-white/[0.01] py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-xl font-bold text-white mb-2">
              {locale === "zh-CN" ? "多媒体编目与数据拓扑模型" : "Data Topology & Modeling Rules"}
            </h2>
            <p className="text-xs text-gray-400 max-w-xl mx-auto">
              {locale === "zh-CN"
                ? "借鉴 FRBR / LRM 实体关系理论，解决音乐多版本、单曲聚合、特典赠品与分集剪辑的业界难题。"
                : "Inspired by FRBR/LRM standards, cleanly solving multi-edition, single reuse, and bonus packaging challenges."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-5 rounded-2xl border border-white/[0.06] bg-black/20 space-y-2.5">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
                <Disc className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white text-sm">
                {locale === "zh-CN" ? "单曲与专辑收录关系" : "Singles as Standalone Works"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "单曲是独立 Work，拥有自己的创作身份与发售历史。其录音母版（Expression）可同时被单曲 CD、后续完整专辑以及精选黑胶精准引用，绝不虚构重复作品。"
                  : "Singles maintain unique Work identity. Their Master Recording Expression is directly linked by both original Single CDs and later Albums via TrackContent."}
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/[0.06] bg-black/20 space-y-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <GitCompare className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white text-sm">
                {locale === "zh-CN" ? "多版本与实体特典拆解" : "Multi-Edition & Tokuten Bonuses"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "区分普通盘、附送 MV BD 的限定盘及豪华盒装。盒内盘片（Medium）与外部店铺连动购买特典（Promotional Release）严格分明，支持精确版本比对。"
                  : "Strictly separates Regular, BD-included Limited, and Boxset editions. Boxed discs and external store bonus CDs are modeled cleanly."}
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-white/[0.06] bg-black/20 space-y-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-white text-sm">
                {locale === "zh-CN" ? "个人创作与独立作品建档" : "Personal & Indie Creations"}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {locale === "zh-CN"
                  ? "摄影写真、同人画集、独立游戏路线以及翻唱作品均可零门槛建档。无需上传商业出版号或大文件即可独立建立结构化档案。"
                  : "Photobooks, indie games, doujin albums, and covers can be cataloged seamlessly without forced commercial publisher IDs or mandatory file uploads."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-6 text-center text-xs font-mono text-gray-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>© 2026 MetaFusion · Open Metadata Platform</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "分类货架" : "Home"}
            </Link>
            <Link href="/explore" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "探索中心" : "Explore"}
            </Link>
            <Link href="/community" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "社区论坛" : "Community"}
            </Link>
            <Link href="/downloads" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "下载中心" : "Downloads"}
            </Link>
            <a href="/docs/catalog" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "编目规范" : "Docs"}
            </a>
            <a href="/api/docs" className="hover:text-gray-300 transition-colors">
              {locale === "zh-CN" ? "API 接口" : "OpenAPI"}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
