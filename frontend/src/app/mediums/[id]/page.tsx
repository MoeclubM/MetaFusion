"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Entity, fetchAllPages, mapLimit, title as entityTitle } from "@/components/catalog/api";
import { fetchApi } from "@/lib/api";
import { useDefinitions, getTermName } from "@/lib/definitions";
import { WorkFacts } from "@/components/work/WorkFacts";
import { EntityResourceFiles } from "@/components/storage/EntityResourceFiles";
import { GroupAttributeInline, LocatorInline } from "@/components/catalog/TemplateAttributeSections";
import { orderedTracksWithDepth } from "@/lib/trackTree";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, ArrowRight, FileText, HardDrive, Layers } from "lucide-react";

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

type TrackRow = {
  track: Entity;
  /** 树内层级：0 为根轨，>0 为章/子轨，按 depth 缩进呈现。 */
  depth: number;
  duration: number;
  contents: {
    key: string;
    id: string;
    /** 表达标题；取不回来时为空串，渲染占位而不是丢弃该条收录。 */
    title: string;
    locator: Record<string, any>;
    attributes: Record<string, any>;
  }[];
};

// 载体详情页：统一 DTO 数据源（/catalog/entities）。面包屑 作品 → 发行版 → 载体，
// 曲目按 medium_id 列出，其收录内容（表达）逐条解析出标题。
export default function MediumDetailPage() {
  const params = useParams();
  const mediumId = params.id as string;
  const { t, locale } = useI18n();
  const { definitions: defs } = useDefinitions();
  const [medium, setMedium] = useState<Entity | null>(null);
  const [release, setRelease] = useState<Entity | null>(null);
  const [work, setWork] = useState<Entity | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!mediumId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const m = await fetchApi<Entity>(`/catalog/entities/${mediumId}`);
        if (cancelled) return;
        setMedium(m);
        if (m.release_id) {
          const rel = await fetchApi<Entity>(`/catalog/entities/${m.release_id}`);
          if (cancelled) return;
          setRelease(rel);
          const workId = rel.subjects?.[0]?.work_id;
          if (workId) {
            const w = await fetchApi<Entity>(`/catalog/entities/${workId}`);
            if (!cancelled) setWork(w);
          }
        }
        const trackEntities = await fetchAllPages<Entity>(`/catalog/entities?kind=track&medium_id=${encodeURIComponent(mediumId)}`);
        // 曲目的收录（表达）标题解析：先收集唯一表达 id，再受控并发逐条取。
        const exprIds = Array.from(new Set(trackEntities.flatMap((tr) => (tr.contents || []).map((c) => c.expression_id)).filter(Boolean) as string[]));
        const exprTitles = new Map<string, string>();
        await mapLimit(exprIds, 8, async (id) => {
          try {
            const e = await fetchApi<Entity>(`/catalog/entities/${id}`);
            exprTitles.set(id, entityTitle(e, locale) || e.title || "");
          } catch { /* 缺失的表达跳过 */ }
        });
        if (cancelled) return;
        // 与发行页共用同一棵曲目树：保留父子层级与 position 次序，
        // 不再拍平成一层列表。收录条目保留定位与附加属性；
        // 表达取不回来（缺权限/已删除）时保留占位，不能整条丢掉映射关系。
        setTracks(
          orderedTracksWithDepth(trackEntities).map(({ track: tr, depth }) => ({
            track: tr,
            depth,
            duration: Number(tr.attributes?.duration) || 0,
            contents: (tr.contents || []).map((c, i) => ({
              key: `${c.expression_id}-${i}`,
              id: c.expression_id,
              title: exprTitles.get(c.expression_id) || "",
              locator: c.locator || {},
              attributes: c.attributes || {},
            })),
          })),
        );
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediumId, locale]);

  const mediumTitle = useMemo(() => (medium ? entityTitle(medium, locale) || medium.title || mediumId : ""), [medium, locale]);
  const formatCode = String(medium?.attributes?.format || "");
  const formatLabel = formatCode ? getTermName(defs, "format", formatCode, locale) : "";
  const roleCode = String(medium?.attributes?.role || "");
  const roleLabel = roleCode ? getTermName(defs, "role", roleCode, locale) : "";

  if (loading) {
    return <div className="min-h-screen bg-background grid place-items-center font-mono text-xs text-gray-500">{t("medium.detail.loading")}</div>;
  }

  if (notFound || !medium) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <Navbar />
        <PageShell width="narrow" center className="py-20" contentClassName="font-mono text-xs text-gray-500">
          {t("medium.detail.notFound")}
        </PageShell>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-violet-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="relative z-10 flex-1">
        <Navbar />
        <PageShell
          width="page"
          header={
          <div className="space-y-3">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-500 flex-wrap">
            {work && work.id && (
              <>
                <Link href={`/works/${work.id}`} className="hover:text-primary transition-colors duration-fast ease-soft inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  {entityTitle(work, locale) || work.title}
                </Link>
                <span>/</span>
              </>
            )}
            {release && release.id && (
              <>
                <Link href={`/releases/${release.id}`} className="hover:text-primary transition-colors duration-fast ease-soft truncate max-w-[18rem]">
                  {entityTitle(release, locale) || release.title}
                </Link>
                <span>/</span>
              </>
            )}
            <span className="text-text-strong truncate">{mediumTitle}</span>
          </div>
          {/* 页面级 h1 归页头：与 /works/[id]、/releases/[id] 落同一条左基线，
              不再受卡片左内边距与图标列影响。 */}
          <header className="space-y-2">
            {/* 图标收进徽章行：大图标列会把 h1 顶到 176px，标题必须落在内容基线上。 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-300 font-mono text-[10px] tracking-wider">
                <HardDrive className="w-3.5 h-3.5" />
                {t("medium.detail.badge")}
              </span>
              {roleLabel && <span className="text-xs font-mono text-gray-500">{roleLabel}</span>}
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-text-strong break-words">{mediumTitle}</h1>
            {work && (
              <p className="text-sm text-gray-500">
                {entityTitle(work, locale) || work.title}
              </p>
            )}
          </header>
          </div>
          }
        >
          <Card tone="plain" padding="section" className="shadow-soft">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.format")}</p>
                <p className="text-sm font-semibold text-text-strong mt-0.5">{formatLabel || formatCode || "—"}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.position")}</p>
                <p className="text-sm font-semibold text-text-strong mt-0.5">{medium.number || `#${medium.position ?? 0}`}</p>
              </div>
              <div className="p-2.5 rounded-md bg-black/[0.03] dark:bg-white/[0.04]">
                <p className="text-[10px] font-mono text-gray-500 uppercase">{t("medium.detail.trackCount")}</p>
                <p className="text-sm font-semibold text-text-strong mt-0.5">{tracks.length}</p>
              </div>
            </div>
          </Card>

          {/* 载体自身的动态属性（黑胶转速/尺寸等由后台声明）：走通用分区渲染，
              不为每种媒体另写面板；无可用字段时组件返回 null。 */}
          {/* WorkFacts 的容器口径与 Card 一致（plain 描边/底色 + section 内边距），
              因此按组件的圆角与令牌给出同样的类名，不再走页面自写的 rounded-lg/border-line。 */}
          <WorkFacts entity={medium} defs={defs} locale={locale} className="rounded-xl border border-line-subtle bg-surface/80 backdrop-blur-md shadow-soft p-4 sm:p-5" />

          {/* 资源文件：文件本体由存储服务托管，绑定用途由 binding_role 表达；
              载体是"整碟镜像/分轨音频/扫描件"最大的落点，放在曲目表之前。 */}
          <EntityResourceFiles entityId={mediumId} />

          <Card tone="plain" padding="none" className="overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-line-subtle">
              <SectionTitle
                icon={<Layers className="w-4 h-4 text-primary" />}
                actions={<span className="font-mono text-xs text-gray-500">{tracks.length}</span>}
              >
                {t("medium.detail.tracksTitle")}
              </SectionTitle>
            </div>
            {tracks.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-gray-500">{t("medium.detail.noTracks")}</div>
            ) : (
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {tracks.map(({ track, depth, duration, contents }) => {
                  const trackTitle = entityTitle(track, locale) || track.title || t("medium.detail.untitledTrack");
                  return (
                    <div
                      key={track.id}
                      className="p-4 flex items-start gap-3 hover:bg-surfaceSubtle transition-colors duration-fast ease-soft"
                      style={depth > 0 ? { paddingLeft: `${16 + depth * 18}px` } : undefined}
                    >
                      <span className="w-8 shrink-0 text-right font-mono text-xs text-gray-500 pt-0.5">{track.number || track.position}</span>
                      <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-text-strong truncate">
                          {depth > 0 && <span className="mr-1 font-mono text-[10px] text-gray-400">└</span>}
                          {trackTitle}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 font-mono text-[11px] text-gray-500">
                          {duration > 0 && <span>{formatDuration(duration)}</span>}
                        </div>
                        {contents.map((entry) => (
                          <div key={entry.key} className="mt-2 space-y-1">
                            <Link
                              href={`/catalog/${entry.id}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                                entry.title
                                  ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                                  : "bg-black/[0.03] dark:bg-white/[0.04] text-gray-500 border-dashed border-black/15 dark:border-white/15"
                              }`}
                            >
                              {entry.title || `${entry.id.slice(0, 8)}…`}
                              <ArrowRight className="w-2.5 h-2.5" />
                            </Link>
                            {/* 收录定位与附加属性：全部由 definitions 声明的子字段渲染，
                                后台新增定位方式/属性即刻显示，代码不写死字段码。 */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px]">
                              <LocatorInline defs={defs} value={entry.locator} locale={locale} />
                              <GroupAttributeInline defs={defs} code="inclusion_attributes" value={entry.attributes} locale={locale} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </PageShell>
      </div>
    </div>
  );
}
