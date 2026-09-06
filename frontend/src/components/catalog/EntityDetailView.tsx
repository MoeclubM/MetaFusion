"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/Navbar";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import FavoriteButton from "@/components/FavoriteButton";
import { DynamicAttributeViewer } from "@/components/attributes/DynamicAttributeViewer";
import { EntityEditor } from "@/components/catalog-v2/EntityEditor";
import { useCatalog } from "@/components/catalog-v2/CatalogProvider";
import { api, Entity, Relation, title, local } from "@/components/catalog-v2/api";
import { useI18n } from "@/i18n/I18nProvider";
import { isDistinctOriginalTitle } from "@/lib/titles";
import { GraphNode, GraphLink } from "@/lib/api";
import {
  ArrowLeft,
  ArrowUpRight,
  Barcode,
  Building2,
  Calendar,
  Check,
  Clock,
  Copy,
  Disc,
  ExternalLink,
  Film,
  GitCompare,
  HardDrive,
  Hash,
  History,
  Layers,
  List,
  MessageSquare,
  Music,
  Network,
  Pencil,
  Share2,
  Sparkles,
  User,
  Users,
  Tag as TagIcon,
  Globe,
  Sliders,
  ChevronRight,
  BookOpen,
} from "lucide-react";

const InteractiveRelationGraph = dynamic(
  () =>
    import("@/components/graph/InteractiveRelationGraph").then(
      (m) => m.InteractiveRelationGraph
    ),
  { ssr: false }
);

async function allEntities(query: string): Promise<Entity[]> {
  const items: Entity[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await api<{ items: Entity[] }>(
      `/catalog/entities?${query}&offset=${offset}&limit=100`
    );
    items.push(...r.items);
    if (r.items.length < 100) return items;
  }
}

export function EntityDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { definition, user } = useCatalog();

  const [entity, setEntity] = useState<Entity | null>(null);
  const [motherWork, setMotherWork] = useState<Entity | null>(null);
  const [motherRelease, setMotherRelease] = useState<Entity | null>(null);
  const [motherMedium, setMotherMedium] = useState<Entity | null>(null);
  const [occurrences, setOccurrences] = useState<any[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relatedEntities, setRelatedEntities] = useState<Record<string, Entity>>({});
  const [children, setChildren] = useState<Entity[]>([]);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [subjectWorks, setSubjectWorks] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "occurrences" | "directory" | "credits" | "attributes" | "revisions" | "storage" | "community" | "graph"
  >("occurrences");
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [relationViewMode, setRelationViewMode] = useState<"cards" | "graph">("cards");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const e = await api<Entity>(`/catalog/entities/${id}/resolve`);
      setEntity(e);

      // Fetch occurrences, relations, revisions in parallel
      const [occRes, relRes, revRes] = await Promise.all([
        api<{ items: any[] }>(`/catalog/entities/${e.id}/occurrences`).catch(() => ({ items: [] })),
        api<{ items: Relation[] }>(`/catalog/entities/${e.id}/relations`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/catalog/entities/${e.id}/revisions`).catch(() => ({ items: [] })),
      ]);

      const occItems = occRes.items || [];
      const relItems = relRes.items || [];
      const revItems = revRes.items || [];
      setOccurrences(occItems);
      setRelations(relItems);
      setRevisions(revItems);

      // Resolve parent references
      const parentPromises: Promise<any>[] = [];
      if (e.work_id) {
        parentPromises.push(
          api<Entity>(`/catalog/entities/${e.work_id}`)
            .then(setMotherWork)
            .catch(() => setMotherWork(null))
        );
      }
      if (e.release_id) {
        parentPromises.push(
          api<Entity>(`/catalog/entities/${e.release_id}`)
            .then(setMotherRelease)
            .catch(() => setMotherRelease(null))
        );
      }
      if (e.medium_id) {
        parentPromises.push(
          api<Entity>(`/catalog/entities/${e.medium_id}`)
            .then(setMotherMedium)
            .catch(() => setMotherMedium(null))
        );
      }

      // If entity is a release, resolve its subject works
      if (e.kind === "release" && e.subjects && e.subjects.length > 0) {
        parentPromises.push(
          Promise.all(
            e.subjects.slice(0, 10).map((s) =>
              api<Entity>(`/catalog/entities/${s.work_id}`).catch(() => null)
            )
          ).then((works) => setSubjectWorks(works.filter(Boolean) as Entity[]))
        );
      }

      // Also if occurrences have release subjects, fetch the primary subject work for cover inheritance
      if (occItems.length > 0 && occItems[0]?.release?.subjects?.length > 0) {
        const primaryWorkId = occItems[0].release.subjects[0].work_id;
        parentPromises.push(
          api<Entity>(`/catalog/entities/${primaryWorkId}`)
            .then((w) => {
              if (w) {
                setSubjectWorks((prev) => (prev.some((x) => x.id === w.id) ? prev : [...prev, w]));
              }
            })
            .catch(() => {})
        );
      }

      // Resolve entities for relations (first 25 to avoid overwhelming)
      const otherIds = Array.from(
        new Set(
          relItems
            .map((r) => (r.source_id === e.id ? r.target_id : r.source_id))
            .filter((x) => x && x !== e.id)
        )
      ).slice(0, 25);

      if (otherIds.length > 0) {
        parentPromises.push(
          Promise.all(
            otherIds.map((targetId) =>
              api<Entity>(`/catalog/entities/${targetId}`)
                .then((target) => ({ [targetId]: target }))
                .catch(() => ({ [targetId]: null }))
            )
          ).then((results) => {
            const map: Record<string, Entity> = {};
            for (const r of results) {
              Object.assign(map, r);
            }
            setRelatedEntities(map);
          })
        );
      }

      // Query children for work or release
      let childQuery = "";
      if (e.kind === "work") childQuery = `work_id=${e.id}`;
      else if (e.kind === "content_unit") childQuery = `content_unit_id=${e.id}`;
      else if (e.kind === "release") childQuery = `release_id=${e.id}`;
      else if (e.kind === "medium") childQuery = `medium_id=${e.id}`;

      if (childQuery) {
        parentPromises.push(
          allEntities(childQuery)
            .then(async (ch) => {
              if (e.kind === "release") {
                const tracks = await Promise.all(
                  ch
                    .filter((x) => x.kind === "medium" && x.id)
                    .map((m) => allEntities(`medium_id=${m.id}`))
                );
                setChildren([...ch, ...tracks.flat()]);
              } else {
                setChildren(ch);
              }
            })
            .catch(() => setChildren([]))
        );
      }

      await Promise.all(parentPromises);

      // Default active tab heuristic
      if (e.kind === "release" || e.kind === "medium") {
        setActiveTab("directory");
      } else if (occItems.length > 0) {
        setActiveTab("occurrences");
      } else if (relItems.length > 0) {
        setActiveTab("credits");
      } else {
        setActiveTab("attributes");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id, user?.id]);

  // Inherited cover decision
  const resolvedCover = useMemo(() => {
    if (!entity) return { src: null, aspect: "1:1", sourceName: "" };

    // 1. Direct picture
    if (entity.pictures && entity.pictures.length > 0 && entity.pictures[0]?.url) {
      return { src: entity.pictures[0].url, aspect: entity.kind === "work" ? "2:3" : "1:1", sourceName: "entity" };
    }
    // 2. Mother work picture
    if (motherWork?.pictures && motherWork.pictures.length > 0 && motherWork.pictures[0]?.url) {
      return { src: motherWork.pictures[0].url, aspect: "2:3", sourceName: "mother_work" };
    }
    // 3. Subject works from release or occurrences
    if (subjectWorks.length > 0 && subjectWorks[0]?.pictures?.[0]?.url) {
      return { src: subjectWorks[0].pictures[0].url, aspect: "2:3", sourceName: "subject_work" };
    }
    // 4. Occurrences release pictures
    if (occurrences.length > 0 && occurrences[0]?.release?.pictures?.[0]?.url) {
      return { src: occurrences[0].release.pictures[0].url, aspect: "1:1", sourceName: "release" };
    }

    return { src: null, aspect: "1:1", sourceName: "procedural" };
  }, [entity, motherWork, subjectWorks, occurrences]);

  // Extract Bangumi ID
  const bangumiId = useMemo(() => {
    if (!entity) return null;
    if (entity.external_ids?.bangumi) return entity.external_ids.bangumi;
    const m = entity.external_ids?.metafusion_import || "";
    const match = m.match(/bgm:(?:subject|release):(\d+)/);
    if (match) return match[1];
    // Check mother work or release
    if (motherWork?.external_ids?.bangumi) return motherWork.external_ids.bangumi;
    if (occurrences[0]?.release?.external_ids?.bangumi) return occurrences[0].release.external_ids.bangumi;
    if (subjectWorks[0]?.external_ids?.bangumi) return subjectWorks[0].external_ids.bangumi;
    return null;
  }, [entity, motherWork, occurrences, subjectWorks]);

  // Store bonuses
  const storeBonuses = useMemo(() => {
    if (!entity) return [];
    const direct = entity.attributes?.store_bonuses;
    if (Array.isArray(direct) && direct.length > 0) return direct;
    // Check occurrence releases
    for (const occ of occurrences) {
      const b = occ.release?.attributes?.store_bonuses;
      if (Array.isArray(b) && b.length > 0) return b;
    }
    return [];
  }, [entity, occurrences]);

  // Duration text
  const durationText = useMemo(() => {
    if (!entity) return null;
    const s = entity.attributes?.duration_seconds || entity.attributes?.duration || entity.attributes?.length;
    if (typeof s === "number" && s > 0) {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${h}:${String(remM).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      }
      return `${m}:${String(sec).padStart(2, "0")}`;
    }
    if (typeof s === "string" && s.trim()) return s.trim();
    return null;
  }, [entity]);

  // Graph nodes & links
  const { graphNodes, graphLinks } = useMemo(() => {
    if (!entity) return { graphNodes: [], graphLinks: [] };
    const nodes: GraphNode[] = [
      {
        id: entity.id || id,
        name: title(entity, locale),
        original_name: entity.title,
        type: entity.kind,
        category: entity.kind,
        level: 0,
        cover_image_url: resolvedCover.src || undefined,
      },
    ];
    const links: GraphLink[] = [];

    // Mother work node
    if (motherWork) {
      nodes.push({
        id: motherWork.id || "",
        name: title(motherWork, locale),
        original_name: motherWork.title,
        type: "work",
        category: "work",
        level: 1,
        cover_image_url: motherWork.pictures?.[0]?.url,
      });
      links.push({
        source: entity.id || id,
        target: motherWork.id || "",
        type: "part_of",
        label: t("entity.detail.partOfWork"),
      });
    }

    // Occurrences releases
    for (const occ of occurrences.slice(0, 8)) {
      if (occ.release && !nodes.some((n) => n.id === occ.release.id)) {
        nodes.push({
          id: occ.release.id,
          name: occ.release.title,
          type: "release",
          category: "release",
          level: 1,
          cover_image_url: occ.release.pictures?.[0]?.url,
        });
        links.push({
          source: entity.id || id,
          target: occ.release.id,
          type: "included_in",
          label: occ.medium?.title ? `${occ.medium.title} #${occ.position || occ.track?.number || ""}` : "Included",
        });
      }
    }

    // Relations
    for (const rel of relations.slice(0, 15)) {
      const otherId = rel.source_id === entity.id ? rel.target_id : rel.source_id;
      const targetEntity = relatedEntities[otherId];
      if (otherId && !nodes.some((n) => n.id === otherId)) {
        nodes.push({
          id: otherId,
          name: targetEntity ? title(targetEntity, locale) : otherId.slice(0, 8),
          type: targetEntity?.kind || "relation",
          category: targetEntity?.kind || "relation",
          level: 2,
          cover_image_url: targetEntity?.pictures?.[0]?.url,
        });
      }
      links.push({
        source: rel.source_id,
        target: rel.target_id,
        type: rel.type,
        label: rel.type,
      });
    }

    return { graphNodes: nodes, graphLinks: links };
  }, [entity, motherWork, occurrences, relations, relatedEntities, resolvedCover, locale, t]);

  const copyUuid = () => {
    if (!entity?.id) return;
    navigator.clipboard.writeText(entity.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const copyShareLink = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <Navbar />
        <div className="relative z-10 min-h-[60vh] grid place-items-center font-mono text-xs text-gray-500 dark:text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span>{t("entity.detail.loading")}</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !entity) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <Navbar />
        <main className="relative z-10 max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
          <div className="font-mono text-sm text-red-500 dark:text-red-400">{error || t("entity.detail.notFound")}</div>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t("nav.catalog")}</span>
          </Link>
        </main>
      </div>
    );
  }

  // Editing mode
  if (editing) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <Navbar />
        <div className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-black/10 dark:border-white/10 px-4 py-2.5 flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-black/10 dark:border-white/10 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("entity.detail.backToDetail")}</span>
            </button>
            <span className="font-mono text-xs text-gray-400">/</span>
            <span className="font-medium text-xs text-gray-900 dark:text-white truncate max-w-md">
              {title(entity, locale)}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-sm bg-primary/10 text-primary text-[10px] font-mono font-semibold uppercase">
            {t("entity.detail.editEntity")}
          </span>
        </div>
        <main className="relative z-10 max-w-5xl mx-auto px-4 py-8 w-full">
          <EntityEditor
            initial={entity}
            onSaved={(updated) => {
              setEntity(updated);
              setEditing(false);
              void load();
            }}
          />
        </main>
      </div>
    );
  }

  const localizedTitle = title(entity, locale);
  const showOriginal = isDistinctOriginalTitle(entity.title, localizedTitle);
  const kindGradient =
    entity.kind === "work"
      ? "from-emerald-600 to-teal-600"
      : entity.kind === "expression"
      ? "from-indigo-600 to-teal-600"
      : entity.kind === "release"
      ? "from-amber-600 to-orange-600"
      : entity.kind === "medium"
      ? "from-cyan-600 to-blue-600"
      : entity.kind === "track"
      ? "from-sky-600 to-cyan-600"
      : entity.kind === "agent"
      ? "from-rose-600 to-pink-600"
      : "from-purple-600 to-indigo-600";

  // Group relations by category
  const categorizedRelations = relations.map((r) => {
    const otherId = r.source_id === entity.id ? r.target_id : r.source_id;
    const target = relatedEntities[otherId];
    return {
      ...r,
      otherId,
      target,
      isOutgoing: r.source_id === entity.id,
    };
  });

  const filteredRelations = categorizedRelations.filter((r) => {
    if (relationFilter === "all") return true;
    if (relationFilter === "staff") return ["composed_by", "arranged_by", "lyrics_by", "directed_by", "written_by", "illustrated_by", "created_by"].includes(r.type);
    if (relationFilter === "cast") return ["voiced_by", "performed_by", "character_in", "stars"].includes(r.type);
    if (relationFilter === "media") return ["soundtrack_of", "theme_song_of", "adaptation_of", "spin_off_of", "sequel_of"].includes(r.type);
    if (relationFilter === "includes") return ["includes", "included_in", "compilation"].includes(r.type);
    return true;
  });

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      {/* Atmosphere Glow */}
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <Navbar />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-5 w-full space-y-5 flex-1 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {/* Breadcrumb Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-gray-500">
          <div className="flex items-center gap-1.5 truncate">
            <Link href="/" className="hover:text-primary transition-colors inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
              <span>{t("nav.home")}</span>
            </Link>
            <span className="text-gray-400 dark:text-white/20">/</span>
            <Link href="/catalog" className="hover:text-primary transition-colors">
              {t("nav.catalog")}
            </Link>
            {motherWork && (
              <>
                <span className="text-gray-400 dark:text-white/20">/</span>
                <Link
                  href={`/catalog/${motherWork.id}`}
                  className="hover:text-primary transition-colors truncate max-w-[200px]"
                  title={title(motherWork, locale)}
                >
                  {title(motherWork, locale)}
                </Link>
              </>
            )}
            {motherRelease && (
              <>
                <span className="text-gray-400 dark:text-white/20">/</span>
                <Link
                  href={`/catalog/${motherRelease.id}`}
                  className="hover:text-primary transition-colors truncate max-w-[200px]"
                  title={title(motherRelease, locale)}
                >
                  {title(motherRelease, locale)}
                </Link>
              </>
            )}
            <span className="text-gray-400 dark:text-white/20">/</span>
            <span className="text-gray-900 dark:text-white font-semibold truncate max-w-[260px]">
              {localizedTitle}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyUuid}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all text-[10px]"
              title={entity.id}
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedId ? t("entity.detail.idCopied") : t("entity.detail.copyId")}</span>
            </button>

            <span className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 text-[10px] uppercase font-semibold">
              {entity.status}
            </span>
          </div>
        </div>

        {/* Hero Header Card */}
        <section className="p-4 sm:p-6 rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft space-y-4">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-start">
            {/* Left: Cover Column */}
            <div className="w-36 sm:w-44 shrink-0 space-y-3">
              <div className="rounded-lg overflow-hidden border border-black/10 dark:border-white/10 bg-background/50 shadow-sm">
                <AdaptiveCover
                  src={resolvedCover.src}
                  alt={localizedTitle}
                  title={localizedTitle}
                  originalTitle={entity.title}
                  id={entity.id}
                  aspect={resolvedCover.aspect}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* External Authority Badges */}
              <div className="flex flex-col gap-1.5 pt-1">
                {bangumiId && (
                  <a
                    href={`https://bangumi.tv/subject/${bangumiId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#f09199]/10 text-[#f09199] border border-[#f09199]/25 hover:bg-[#f09199]/20 transition-all font-mono text-[11px] font-medium"
                  >
                    <span>{t("entity.detail.externalBangumi")}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={`/api/catalog/entities/${entity.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md border border-black/10 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-all font-mono text-[10px]"
                >
                  <span>{t("entity.detail.viewRawJson")}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* Right: Info Column */}
            <div className="flex-1 space-y-3.5 min-w-0">
              {/* Badges & Meta Pills */}
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] sm:text-xs">
                <span className={`px-2.5 py-0.5 rounded-sm bg-gradient-to-r ${kindGradient} text-white font-semibold shadow-xs uppercase tracking-wide`}>
                  {entity.kind}
                </span>

                {entity.types?.map((typeKey) => (
                  <span
                    key={typeKey}
                    className="px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 font-medium"
                  >
                    {local(definition?.document.types[typeKey]?.names, locale, entity.original_language, typeKey)}
                  </span>
                ))}

                {durationText && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                    <Clock className="w-3 h-3 text-emerald-500" strokeWidth={1.5} />
                    <span>{durationText}</span>
                  </span>
                )}

                {entity.original_language && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                    <Globe className="w-3 h-3 text-sky-400" strokeWidth={1.5} />
                    <span>{entity.original_language}</span>
                  </span>
                )}

                {(entity.attributes?.edition_date || entity.attributes?.release_date) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                    <Calendar className="w-3 h-3 text-amber-400" strokeWidth={1.5} />
                    <span>{entity.attributes.edition_date || entity.attributes.release_date}</span>
                  </span>
                )}

                {entity.attributes?.format && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 uppercase">
                    <Disc className="w-3 h-3 text-primary" strokeWidth={1.5} />
                    <span>{entity.attributes.format}</span>
                  </span>
                )}
              </div>

              {/* Big Title */}
              <div>
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
                  {localizedTitle}
                </h1>
                {showOriginal && (
                  <p className="font-mono text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {entity.title}
                  </p>
                )}
              </div>

              {/* Aliases */}
              {entity.translations?.[locale]?.aliases && entity.translations[locale].aliases.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Aliases:</span>
                  {entity.translations[locale].aliases.map((alias, idx) => (
                    <span key={idx} className="px-1.5 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.04] text-gray-700 dark:text-gray-300">
                      {alias}
                    </span>
                  ))}
                </div>
              )}

              {/* Summary */}
              {(entity.translations?.[locale]?.summary || entity.attributes?.summary || entity.attributes?.description) && (
                <div className="p-3 rounded-lg border border-black/5 dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015] text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line max-h-36 overflow-y-auto">
                  {entity.translations?.[locale]?.summary || entity.attributes?.summary || entity.attributes?.description}
                </div>
              )}

              {/* Mother Work Direct Card */}
              {motherWork && (
                <div className="pt-1">
                  <Link
                    href={`/catalog/${motherWork.id}`}
                    className="group inline-flex items-center gap-3 p-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all max-w-xl w-full"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-black/5 dark:bg-white/5 shrink-0">
                      <AdaptiveCover
                        src={motherWork.pictures?.[0]?.url || resolvedCover.src}
                        alt={title(motherWork, locale)}
                        title={title(motherWork, locale)}
                        id={motherWork.id}
                        aspect="1:1"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-primary uppercase tracking-wider font-semibold">
                        {t("entity.detail.partOfWork")}
                      </div>
                      <div className="font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white group-hover:text-primary truncate">
                        {title(motherWork, locale)}
                      </div>
                      {isDistinctOriginalTitle(motherWork.title, title(motherWork, locale)) && (
                        <div className="font-mono text-[10px] text-gray-400 truncate">
                          {motherWork.title}
                        </div>
                      )}
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                  </Link>
                </div>
              )}

              {/* Store Bonuses Highlight */}
              {storeBonuses.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] dark:bg-amber-500/[0.08] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.storeBonuses")}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {storeBonuses.map((bonus: any, idx: number) => (
                      <div key={idx} className="flex flex-wrap items-baseline gap-2 text-gray-800 dark:text-gray-200">
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          {bonus.label?.["ja-JP"] || bonus.label?.["zh-CN"] || bonus.label?.["en-US"] || JSON.stringify(bonus.label || "")}
                        </span>
                        {bonus.condition && (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            ({bonus.condition})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Toolbar */}
              <div className="pt-3 border-t border-black/5 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 shadow-xs transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.editEntity")}</span>
                  </button>

                  <Link
                    href={`/compare?ids=${entity.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-black/10 dark:border-white/10 bg-surface text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-primary/50 hover:text-primary transition-all"
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.compareAdd")}</span>
                  </Link>

                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-black/10 dark:border-white/10 bg-surface text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all"
                    title="Share link"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <FavoriteButton
    targetType={
      (entity.kind === "expression"
        ? "canonical_entry"
        : entity.kind === "agent"
        ? "artist"
        : entity.kind === "release"
        ? "release"
        : "work") as any
    }
    targetId={entity.id || id}
  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-black/10 dark:border-white/[0.08] pb-1 overflow-x-auto font-mono text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("occurrences")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "occurrences"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <Disc className="w-3.5 h-3.5" />
            <span>{t("entity.detail.occurrencesTitle")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
              {occurrences.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("directory")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "directory"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>{t("entity.detail.directoryTitle")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
              {children.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("credits")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "credits"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t("entity.detail.creditsRelationsTitle")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
              {relations.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("attributes")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "attributes"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{t("entity.detail.attributesTitle")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("revisions")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "revisions"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{t("entity.detail.revisionsTitle")}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-[10px]">
              {revisions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("storage")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "storage"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>{t("entity.detail.resourcesTitle")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("community")}
            className={`px-3.5 py-2 rounded-t-md font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === "community"
                ? "border-b-2 border-primary text-primary bg-primary/5"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{t("entity.detail.communityTitle")}</span>
          </button>
        </div>

        {/* Tab Content 1: Occurrences & Releases */}
        {activeTab === "occurrences" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
            <div className="px-4 py-3 border-b border-black/5 dark:border-white/[0.06] flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                  {t("entity.detail.occurrencesTitle")}
                </h2>
                <span className="font-mono text-xs text-gray-500">({occurrences.length})</span>
              </div>
              <p className="text-xs text-gray-500 hidden sm:block">
                {t("entity.detail.occurrencesDesc")}
              </p>
            </div>

            {occurrences.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-gray-500">
                {t("entity.detail.noOccurrences")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/[0.06] font-mono text-[10px] uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="py-2.5 px-3.5 w-14 font-medium">{t("entity.detail.tableCover")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("entity.detail.tableReleaseName")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("entity.detail.tableMedium")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("entity.detail.tableTrack")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("entity.detail.tableBonus")}</th>
                      <th className="py-2.5 px-3.5 font-medium">{t("entity.detail.tableDate")}</th>
                      <th className="py-2.5 px-3.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                    {occurrences.map((occ, idx) => {
                      const rel = occ.release;
                      const med = occ.medium;
                      const trk = occ.track;
                      const bonuses = rel?.attributes?.store_bonuses;
                      return (
                        <tr key={idx} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 px-3.5">
                            <div className="w-10 h-10 rounded overflow-hidden bg-black/5 dark:bg-white/5 shadow-xs">
                              <AdaptiveCover
                                src={rel?.pictures?.[0]?.url || resolvedCover.src}
                                alt={rel?.title || "Release"}
                                title={rel?.title || "Release"}
                                id={rel?.id}
                                aspect="1:1"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 font-medium text-gray-900 dark:text-white max-w-[260px]">
                            {rel ? (
                              <Link
                                href={`/catalog/${rel.id}`}
                                className="hover:text-primary transition-colors line-clamp-2"
                                title={rel.title}
                              >
                                {rel.title}
                              </Link>
                            ) : (
                              <span>—</span>
                            )}
                            {rel?.attributes?.edition_name && (
                              <div className="font-mono text-[10px] text-gray-400 mt-0.5">
                                {rel.attributes.edition_name}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-700 dark:text-gray-300 font-mono text-[11px]">
                            {med ? (
                              <Link href={`/catalog/${med.id}`} className="hover:text-primary transition-colors">
                                {med.title || `Disc ${med.position || 1}`}
                                {med.attributes?.format && (
                                  <span className="ml-1 text-gray-400 uppercase">({med.attributes.format})</span>
                                )}
                              </Link>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-900 dark:text-white font-mono text-[11px]">
                            {trk ? (
                              <Link href={`/catalog/${trk.id}`} className="hover:text-primary transition-colors">
                                #{trk.number || trk.position || occ.position || 1} {trk.title && trk.title !== entity.title ? `· ${trk.title}` : ""}
                              </Link>
                            ) : (
                              <span>#{occ.position || 1}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-600 dark:text-gray-400 max-w-[220px]">
                            {Array.isArray(bonuses) && bonuses.length > 0 ? (
                              <div className="space-y-0.5">
                                {bonuses.map((b: any, bIdx: number) => (
                                  <div key={bIdx} className="text-[11px] text-amber-600 dark:text-amber-400 truncate" title={b.condition || ""}>
                                    ★ {b.label?.["ja-JP"] || b.label?.["zh-CN"] || b.label?.["en-US"] || JSON.stringify(b.label || "")}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-gray-500 font-mono text-[11px] whitespace-nowrap">
                            {rel?.attributes?.edition_date || rel?.attributes?.release_date || "—"}
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            {rel && (
                              <Link
                                href={`/catalog/${rel.id}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-black/10 dark:border-white/10 text-[11px] text-gray-600 dark:text-gray-300 hover:border-primary hover:text-primary transition-all font-medium"
                              >
                                <span>View</span>
                                <ChevronRight className="w-3 h-3" />
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab Content 2: Directory & Tracklist */}
        {activeTab === "directory" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-4 shadow-soft">
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <List className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                  {t("entity.detail.directoryTitle")}
                </h2>
                <span className="font-mono text-xs text-gray-500">({children.length})</span>
              </div>
            </div>

            {children.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-gray-500">
                {t("entity.detail.noDirectory")}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Group by Medium if release */}
                {entity.kind === "release" ? (
                  children
                    .filter((c) => c.kind === "medium")
                    .map((med) => {
                      const tracks = children.filter((c) => c.kind === "track" && c.medium_id === med.id);
                      return (
                        <div key={med.id} className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
                          <div className="px-4 py-2.5 bg-black/[0.03] dark:bg-white/[0.03] border-b border-black/10 dark:border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-display text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                              <Disc className="w-4 h-4 text-primary" />
                              <Link href={`/catalog/${med.id}`} className="hover:text-primary transition-colors">
                                {med.title || `Disc ${med.position || 1}`}
                              </Link>
                              {med.attributes?.format && (
                                <span className="px-2 py-0.2 rounded text-[10px] font-mono uppercase bg-primary/10 text-primary">
                                  {med.attributes.format}
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] text-gray-500">{tracks.length} tracks</span>
                          </div>

                          <div className="divide-y divide-black/5 dark:divide-white/[0.06]">
                            {tracks.map((trk) => (
                              <div
                                key={trk.id}
                                className="px-4 py-2 text-xs flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="w-6 font-mono text-gray-400 text-[11px] text-right">
                                    {trk.number || trk.position}
                                  </span>
                                  <Link
                                    href={`/catalog/${trk.id}`}
                                    className="font-medium text-gray-900 dark:text-white hover:text-primary transition-colors truncate"
                                  >
                                    {trk.title}
                                  </Link>
                                </div>
                                <div className="flex items-center gap-3">
                                  {trk.contents && trk.contents.length > 0 && (
                                    <Link
                                      href={`/catalog/${trk.contents[0].expression_id}`}
                                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all"
                                    >
                                      Expression
                                    </Link>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {children.map((child) => (
                      <Link
                        key={child.id}
                        href={`/catalog/${child.id}`}
                        className="p-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all flex items-center justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-[9px] text-primary uppercase font-semibold">
                            {child.kind}
                          </span>
                          <div className="font-medium text-xs text-gray-900 dark:text-white truncate">
                            {title(child, locale)}
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Tab Content 3: Credits & Relations */}
        {activeTab === "credits" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-4 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 dark:border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                  {t("entity.detail.creditsRelationsTitle")}
                </h2>
                <span className="font-mono text-xs text-gray-500">({relations.length})</span>
              </div>

              <div className="flex items-center gap-2">
                {/* Filter Pills */}
                <div className="flex items-center gap-1 font-mono text-[11px] overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setRelationFilter("all")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      relationFilter === "all" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {t("entity.detail.relAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelationFilter("staff")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      relationFilter === "staff" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {t("entity.detail.relStaff")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelationFilter("cast")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      relationFilter === "cast" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {t("entity.detail.relCast")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelationFilter("media")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      relationFilter === "media" ? "bg-primary text-white font-semibold" : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {t("entity.detail.relMedia")}
                  </button>
                </div>

                {/* View Mode Switcher */}
                <div className="flex items-center bg-black/[0.04] dark:bg-white/[0.06] rounded-md p-0.5 border border-black/10 dark:border-white/10 font-mono text-[11px]">
                  <button
                    type="button"
                    onClick={() => setRelationViewMode("cards")}
                    className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                      relationViewMode === "cards" ? "bg-surface text-foreground shadow-xs font-medium" : "text-gray-500 hover:text-foreground"
                    }`}
                  >
                    <List className="w-3 h-3" />
                    <span>{t("entity.detail.viewCards")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelationViewMode("graph")}
                    className={`px-2 py-0.5 rounded transition-all flex items-center gap-1 ${
                      relationViewMode === "graph" ? "bg-surface text-foreground shadow-xs font-medium" : "text-gray-500 hover:text-foreground"
                    }`}
                  >
                    <Network className="w-3 h-3" />
                    <span>{t("entity.detail.viewGraph")}</span>
                  </button>
                </div>
              </div>
            </div>

            {filteredRelations.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-gray-500">
                {t("entity.detail.noRelations")}
              </div>
            ) : relationViewMode === "graph" ? (
              <div className="rounded-lg overflow-hidden border border-black/10 dark:border-white/10">
                <InteractiveRelationGraph
                  centerEntityId={entity.id || id}
                  centerEntityType={entity.kind}
                  nodes={graphNodes}
                  links={graphLinks}
                  height={540}
                  title={localizedTitle}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredRelations.map((r, idx) => {
                  const target = r.target;
                  const targetName = target ? title(target, locale) : r.otherId.slice(0, 8);
                  return (
                    <Link
                      key={r.id || idx}
                      href={`/catalog/${r.otherId}`}
                      className="group p-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all flex items-center gap-3"
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        {target?.pictures?.[0]?.url ? (
                          <img src={target.pictures[0].url} alt={targetName} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
                          {r.type}
                        </div>
                        <div className="font-medium text-xs text-gray-900 dark:text-white group-hover:text-primary truncate">
                          {targetName}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab Content 4: Attributes & Authorities */}
        {activeTab === "attributes" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-6 shadow-soft">
            <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
              <Sliders className="w-4 h-4 text-primary" strokeWidth={1.5} />
              <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                {t("entity.detail.attributesTitle")}
              </h2>
            </div>

            {/* Dynamic Attributes Grid */}
            <div>
              <h3 className="font-mono text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">
                Entity Attributes
              </h3>
              <DynamicAttributeViewer attributes={entity.attributes} />
            </div>

            {/* External IDs */}
            {entity.external_ids && Object.keys(entity.external_ids).length > 0 && (
              <div className="pt-4 border-t border-black/5 dark:border-white/[0.06]">
                <h3 className="font-mono text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">
                  External Authorities & Identifiers
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {Object.entries(entity.external_ids).map(([key, val]) => (
                    <div
                      key={key}
                      className="p-2.5 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] font-mono text-xs"
                    >
                      <div className="text-[10px] text-gray-400 uppercase font-semibold">{key}</div>
                      <div className="text-gray-900 dark:text-white font-medium mt-0.5 truncate">{String(val)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System Info & Metadata */}
            <div className="pt-4 border-t border-black/5 dark:border-white/[0.06] font-mono text-[11px] text-gray-500 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span className="text-gray-400 block text-[10px]">Entity ID:</span>
                <span className="text-gray-700 dark:text-gray-300 select-all">{entity.id}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Version:</span>
                <span className="text-gray-700 dark:text-gray-300">v{entity.version}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Created By:</span>
                <span className="text-gray-700 dark:text-gray-300 truncate block">{entity.created_by || "System"}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Updated At:</span>
                <span className="text-gray-700 dark:text-gray-300">{entity.updated_at ? new Date(entity.updated_at).toLocaleString() : "—"}</span>
              </div>
            </div>
          </section>
        )}

        {/* Tab Content 5: Revisions */}
        {activeTab === "revisions" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-4 sm:p-5 space-y-4 shadow-soft">
            <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
              <History className="w-4 h-4 text-primary" strokeWidth={1.5} />
              <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                {t("entity.detail.revisionsTitle")}
              </h2>
              <span className="font-mono text-xs text-gray-500">({revisions.length})</span>
            </div>

            {revisions.length === 0 ? (
              <div className="p-10 text-center font-mono text-xs text-gray-500">
                {t("entity.detail.noRevisions")}
              </div>
            ) : (
              <div className="space-y-3">
                {revisions.map((rev, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                        v{rev.version || rev.snapshot?.version || idx + 1}
                      </span>
                      <span className="text-gray-500">
                        {rev.created_at ? new Date(rev.created_at).toLocaleString() : "—"}
                      </span>
                    </div>

                    {rev.edit_note && (
                      <div className="text-gray-800 dark:text-gray-200">
                        <span className="font-mono text-gray-400 mr-2 font-semibold">Note:</span>
                        {rev.edit_note}
                      </div>
                    )}

                    {rev.sources && rev.sources.length > 0 && (
                      <div className="space-y-1 font-mono text-[10px] text-gray-500 pt-1 border-t border-black/5 dark:border-white/5">
                        {rev.sources.map((s: any, sIdx: number) => (
                          <div key={sIdx} className="flex items-center gap-1 truncate">
                            <span className="uppercase text-primary font-semibold">[{s.kind}]</span>
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-sky-500 truncate">
                                {s.citation || s.url}
                              </a>
                            ) : (
                              <span>{s.citation}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab Content 6: Decoupled Storage */}
        {activeTab === "storage" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft">
            <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
              <HardDrive className="w-4 h-4 text-primary" strokeWidth={1.5} />
              <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                {t("entity.detail.resourcesTitle")}
              </h2>
            </div>

            <div className="p-4 rounded-lg bg-sky-500/[0.05] dark:bg-sky-500/[0.08] border border-sky-500/20 text-xs text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
              <p>{t("entity.detail.decoupledStorageNotice")}</p>
            </div>

            <div className="pt-2">
              <a
                href={`/download?entity_id=${entity.id}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 shadow-sm transition-all"
              >
                <HardDrive className="w-4 h-4" />
                <span>{t("entity.detail.goToStorage")}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </section>
        )}

        {/* Tab Content 7: Decoupled Community */}
        {activeTab === "community" && (
          <section className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft">
            <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
              <MessageSquare className="w-4 h-4 text-primary" strokeWidth={1.5} />
              <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white">
                {t("entity.detail.communityTitle")}
              </h2>
            </div>

            <div className="p-4 rounded-lg bg-purple-500/[0.05] dark:bg-purple-500/[0.08] border border-purple-500/20 text-xs text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
              <p>{t("entity.detail.decoupledForumNotice")}</p>
            </div>

            <div className="pt-2">
              <a
                href={`/community?entity_id=${entity.id}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 shadow-sm transition-all"
              >
                <MessageSquare className="w-4 h-4" />
                <span>{t("entity.detail.goToForum")}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
