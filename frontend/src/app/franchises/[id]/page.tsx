"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import {
  fetchApi,
  Franchise,
  FranchiseDetailResponse,
  Artist,
  ConnectedEntityItem,
  pickLocalized,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Layers, Network, Users, ArrowRight } from "lucide-react";
import { UniversalEntityEditor } from "@/components/editor/UniversalEntityEditor";
import { RevisionHistoryModal } from "@/components/editor/RevisionHistoryModal";
import { EntityMergeModal } from "@/components/editor/EntityMergeModal";
import { TemporalBadge } from "@/components/entity/TemporalBadge";
import { EntityActionToolbar } from "@/components/entity/EntityActionToolbar";
import FavoriteButton from "@/components/FavoriteButton";
import { EntityCover } from "@/components/common/EntityCover";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { isDistinctOriginalTitle } from "@/lib/titles";
import { GroupedRelations } from "@/components/entity/RelationsList";

export default function FranchiseDetailPage() {
  const params = useParams();
  const franchiseId = params.id as string;
  const { t, locale } = useI18n();
  const [data, setData] = useState<FranchiseDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMergeOpen, setIsMergeOpen] = useState(false);

  const load = () => {
    if (!franchiseId) return;
    setLoading(true);
    fetchApi<FranchiseDetailResponse>(`/catalog/franchises/${franchiseId}?inc=relations`)
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [franchiseId]);

  const franchiseWorks = data?.works || [];

  if (loading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center font-mono text-sm text-gray-500">
        {t("franchise.detail.loading")}
      </div>
    );
  }

  if (!data?.franchise) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center font-mono text-sm text-gray-500">
          {t("franchise.detail.notFound")}
        </div>
      </div>
    );
  }

  const fr: Franchise = data.franchise;
  const localized = pickLocalized(locale, fr.translations, fr.title, fr.summary);
  const parents = data.parents || [];
  const children = data.children || [];
  const agents: Artist[] = data.agents || [];
  const connected: ConnectedEntityItem[] = data.connected_entities || [];

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
      <Navbar />
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1">
        <div className="flex items-center gap-2 font-mono text-sm text-gray-500 flex-wrap">
          <Link href="/explore?type=franchises" className="hover:text-primary transition-colors">
            {t("explore.typeFranchises")}
          </Link>
          {parents.map((p) => (
            <React.Fragment key={p.id}>
              <span className="text-gray-400">/</span>
              <Link href={`/franchises/${p.id}`} className="hover:text-primary truncate max-w-[20ch]">
                {p.title}
              </Link>
            </React.Fragment>
          ))}
          <span className="text-gray-400">/</span>
          <span className="text-gray-900 dark:text-white truncate max-w-[40ch]">{localized.title}</span>
        </div>

        <section className="p-4 sm:p-6 rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-3">
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
            <div className="w-32 sm:w-40 shrink-0">
              <AdaptiveCover
                src={fr.cover_image_url}
                alt={localized.title}
                title={localized.title}
                originalTitle={fr.original_title}
                id={fr.id}
                tags={(fr.tags || []).map((t) => (t?.name ? t.name : typeof t === "string" ? t : ""))}
                className="rounded-md overflow-hidden border border-black/10 dark:border-white/10 bg-background shadow-xs"
              />
            </div>
            <div className="flex-1 space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-1 rounded-sm bg-indigo-600 text-white font-semibold">{t("franchise.detail.badge")}</span>
                <TemporalBadge
                  beginDate={fr.begin_date}
                  endDate={fr.end_date}
                  ended={fr.ended}
                  activeLabel={t("entity.temporal.activeWork")}
                  endedLabel={t("entity.temporal.endedWork")}
                />
              </div>
              <div>
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {localized.title}
                </h1>
                {isDistinctOriginalTitle(fr.original_title, localized.title) && (
                  <p className="font-mono text-sm text-gray-500 mt-0.5">{fr.original_title}</p>
                )}
                {fr.disambiguation && <p className="font-mono text-xs text-gray-400 mt-0.5">{fr.disambiguation}</p>}
              </div>
              {localized.body && <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 max-w-3xl">{localized.body}</p>}
              {fr.tags && fr.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fr.tags.map((tag) => (
                    <Link
                      key={tag.id}
                      href={`/explore?type=franchises&tags=${encodeURIComponent(tag.name)}`}
                      className="px-2.5 py-1 rounded-sm bg-black/[0.04] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 font-mono text-xs text-gray-600 dark:text-gray-400"
                    >
                      #{tag.name}
                    </Link>
                  ))}
                </div>
              )}
              <EntityActionToolbar
                onEdit={() => setIsEditorOpen(true)}
                onHistory={() => setIsHistoryOpen(true)}
                onMerge={() => setIsMergeOpen(true)}
                entityTypeLabel={t("franchise.detail.badge")}
              >
                <FavoriteButton targetType="franchise" targetId={fr.id} />
              </EntityActionToolbar>
            </div>
          </div>
        </section>

        {children.length > 0 && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 p-4 space-y-3">
            <h2 className="font-display text-base font-bold flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-500" />
              {t("franchise.detail.children")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {children.map((ch) => (
                <Link
                  key={ch.id}
                  href={`/franchises/${ch.id}`}
                  className="p-3 rounded-lg border border-black/10 dark:border-white/10 hover:border-primary/40 transition-colors"
                >
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{ch.title}</div>
                  {isDistinctOriginalTitle(ch.original_title, ch.title) && (
                    <p className="font-mono text-xs text-gray-500">{ch.original_title}</p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {franchiseWorks.length > 0 && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 p-4 space-y-4">
            <h2 className="font-display text-base font-bold flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-500" />
              {t("franchise.detail.works")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {franchiseWorks.map((w) => (
                <Link
                  key={w.id}
                  href={`/works/${w.id}`}
                  className="p-2.5 rounded-md border border-black/5 dark:border-white/10 hover:border-primary/40 text-sm flex items-center justify-between"
                >
                  <span className="truncate">{w.title}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {agents.length > 0 && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 p-4 space-y-3">
            <h2 className="font-display text-base font-bold flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              {t("franchise.detail.agents")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <Link
                  key={a.id}
                  href={`/artists/${a.id}`}
                  className="px-2.5 py-1 rounded-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm hover:border-primary/40"
                >
                  <span className="font-mono text-[10px] text-gray-500 mr-1">{a.entity_type}</span>
                  {a.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {connected.length > 0 && (
          <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 p-4 space-y-3">
            <h2 className="font-display text-base font-bold">{t("franchise.detail.relations")}</h2>
            <GroupedRelations items={connected} />
          </section>
        )}
      </main>

      <UniversalEntityEditor
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        targetType="franchise"
        mode="edit"
        initialData={fr}
        onSuccess={() => load()}
      />
      <RevisionHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        targetType="franchise"
        targetId={fr.id}
        entityTitle={localized.title}
      />
      <EntityMergeModal
        isOpen={isMergeOpen}
        onClose={() => setIsMergeOpen(false)}
        targetType="franchise"
        sourceEntity={{ id: fr.id, title: fr.title }}
      />
    </div>
  );
}
