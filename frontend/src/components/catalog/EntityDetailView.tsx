"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import FavoriteButton from "@/components/FavoriteButton";
import { DynamicAttributeViewer } from "@/components/attributes/DynamicAttributeViewer";
import { EntityEditor } from "@/components/catalog/EntityEditor";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import { api, Entity, Relation, title, local } from "@/components/catalog/api";
import { useI18n } from "@/i18n/I18nProvider";
import { isDistinctOriginalTitle, findRowForLocale, buildTitleChain } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { GraphNode, GraphLink } from "@/lib/api";
import { EntityRevisions } from "./EntityRevisions";
import { ExternalAuthorityLinks } from "@/components/entity/ExternalAuthorityLinks";
import { useDefinitions, getTypeName, getRelationName, getFieldName, getTermName } from "@/lib/definitions";
import {
  getAuthLoginUrl,
  getForumEntityUrl,
  getForumCollectionUrl,
  getStorageEntityUrl,
  FORUM_SERVICE_URL,
  STORAGE_SERVICE_URL,
} from "@/lib/services";
import {
  ArrowLeft,
  ArrowRight,
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
  FolderPlus,
  GitCompare,
  HardDrive,
  Hash,
  History,
  Layers,
  List,
  MessageCircle,
  MessageSquare,
  Music,
  Network,
  Pencil,
  Send,
  Share2,
  Sparkles,
  User,
  Users,
  Tag as TagIcon,
  Globe,
  Sliders,
  ChevronRight,
  BookOpen,
  Bookmark,
  Eye,
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

// 基本信息与头部徽章已结构化渲染的属性字段；从动态属性栏排除，避免同值出现两次。
const STRUCTURED_ATTRIBUTE_KEYS = [
  "edition_date",
  "release_date",
  "begin_date",
  "end_date",
  "format",
  "packaging",
  "catalog_number",
  "catalogue_number",
  "barcode",
  "jan",
  "ean",
  "duration",
  "duration_seconds",
  "length",
  "publisher",
  "store_bonuses",
  "official_url",
  "official_website",
  "website",
  "url",
  "tags",
  "summary",
  "description",
];

export function EntityDetailView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const titleOrder = useTitleDisplayOrder();
  const { definition, user } = useCatalog();
  const { definitions: dynamicDefs } = useDefinitions();
  const defs = definition?.document || dynamicDefs;

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
  const [communityPosts, setCommunityPosts] = useState<any[]>([]);
  const [communityCollections, setCommunityCollections] = useState<any[]>([]);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [relationViewMode, setRelationViewMode] = useState<"cards" | "graph">("cards");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const e = await api<Entity>(`/catalog/entities/${id}/resolve`);
      setEntity(e);

      // Fetch occurrences, relations, revisions, posts, collections in parallel
      const [occRes, relRes, revRes, postRes, colRes] = await Promise.all([
        api<{ items: any[] }>(`/catalog/entities/${e.id}/occurrences`).catch(() => ({ items: [] })),
        api<{ items: Relation[] }>(`/catalog/entities/${e.id}/relations`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/catalog/entities/${e.id}/revisions`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/community/entities/${e.id}/posts`).catch(() => ({ items: [] })),
        api<{ items: any[] }>(`/community/entities/${e.id}/collections`).catch(() => ({ items: [] })),
      ]);

      const occItems = occRes.items || [];
      const relItems = relRes.items || [];
      const revItems = revRes.items || [];
      setOccurrences(occItems);
      setRelations(relItems);
      setRevisions(revItems);
      setCommunityPosts(postRes.items || []);
      setCommunityCollections(colRes.items || []);

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

      // If occurrences have release subjects, fetch the primary subject work for cover inheritance
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

      // Resolve entities for relations (first 30)
      const otherIds = Array.from(
        new Set(
          relItems
            .map((r) => (r.source_id === e.id ? r.target_id : r.source_id))
            .filter((x) => x && x !== e.id)
        )
      ).slice(0, 30);

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id, user?.id]);

  // Inherited cover decision. Aspect is left to AdaptiveCover (natural ratio
  // first): the new-track Entity carries no cover_aspect field, so no kind
  // based hardcoding here; entity-specific pages may pass their own aspect.
  const resolvedCover = useMemo(() => {
    if (!entity) return { src: null, aspect: null as string | null, sourceName: "" };

    // 1. Direct picture
    if (entity.pictures && entity.pictures.length > 0 && entity.pictures[0]?.url) {
      return { src: entity.pictures[0].url, aspect: null as string | null, sourceName: "entity" };
    }
    // 2. Mother work picture
    if (motherWork?.pictures && motherWork.pictures.length > 0 && motherWork.pictures[0]?.url) {
      return { src: motherWork.pictures[0].url, aspect: null as string | null, sourceName: "mother_work" };
    }
    // 3. Subject works from release or occurrences
    if (subjectWorks.length > 0 && subjectWorks[0]?.pictures?.[0]?.url) {
      return { src: subjectWorks[0].pictures[0].url, aspect: null as string | null, sourceName: "subject_work" };
    }
    // 4. Occurrences release pictures
    if (occurrences.length > 0 && occurrences[0]?.release?.pictures?.[0]?.url) {
      return { src: occurrences[0].release.pictures[0].url, aspect: null as string | null, sourceName: "release" };
    }

    return { src: null, aspect: null as string | null, sourceName: "procedural" };
  }, [entity, motherWork, subjectWorks, occurrences]);

  // Extract Bangumi info with proper type routing (Strictly entity-owned, never borrowed)
  const bangumiInfo = useMemo(() => {
    if (!entity) return null;

    const isAgent = entity.kind === "agent";

    if (entity.external_ids?.bangumi) {
      const id = String(entity.external_ids.bangumi);
      return {
        id,
        url: isAgent ? `https://bangumi.tv/person/${id}` : `https://bangumi.tv/subject/${id}`,
        label: isAgent ? t("authority.bangumiPerson") : t("authority.bangumiSubject"),
        isDirect: true,
      };
    }
    if (entity.external_ids?.bangumi_person) {
      const id = String(entity.external_ids.bangumi_person);
      return {
        id,
        url: `https://bangumi.tv/person/${id}`,
        label: t("authority.bangumiPerson"),
        isDirect: true,
      };
    }
    if (entity.external_ids?.bangumi_character) {
      const id = String(entity.external_ids.bangumi_character);
      return {
        id,
        url: `https://bangumi.tv/character/${id}`,
        label: t("authority.bangumiCharacter"),
        isDirect: true,
      };
    }
    if (entity.external_ids?.bangumi_ep) {
      const id = String(entity.external_ids.bangumi_ep);
      return {
        id,
        url: `https://bangumi.tv/ep/${id}`,
        label: t("authority.bangumiEpisode"),
        isDirect: true,
      };
    }
    const m = entity.external_ids?.metafusion_import || "";
    const match = m.match(/bgm:(subject|release|person|character):(\d+)/);
    if (match) {
      const kind = match[1];
      const id = match[2];
      const url =
        kind === "person"
          ? `https://bangumi.tv/person/${id}`
          : kind === "character"
          ? `https://bangumi.tv/character/${id}`
          : `https://bangumi.tv/subject/${id}`;
      return {
        id,
        url,
        label: kind === "person" ? t("authority.bangumiPerson") : t("authority.bangumiSubject"),
        isDirect: true,
      };
    }

    return null;
  }, [entity, locale]);

  // Extract official website and authority links (Strictly entity-owned, never borrowed)
  const officialInfo = useMemo(() => {
    if (!entity) return null;

    // Direct website from attributes or external_ids
    const rawUrl =
      entity.attributes?.official_website ||
      entity.attributes?.website ||
      entity.attributes?.official_url ||
      entity.attributes?.url ||
      entity.external_ids?.official ||
      entity.external_ids?.website ||
      entity.external_ids?.official_website;

    if (rawUrl && typeof rawUrl === "string" && rawUrl.startsWith("http")) {
      return {
        url: rawUrl,
        label: t("authority.officialWebsite"),
        isDirect: true,
      };
    }

    if (entity.external_ids?.bushiroad || entity.external_ids?.bushiroad_music) {
      const bushiId = String(entity.external_ids.bushiroad || entity.external_ids.bushiroad_music).toLowerCase();
      return {
        url: `https://bushiroad-music.com/musics/${bushiId}/`,
        label: t("authority.bushiroad"),
        isDirect: true,
      };
    }

    return null;
  }, [entity, locale]);

  // Store bonuses
  const storeBonuses = useMemo(() => {
    if (!entity) return [];
    const direct = entity.attributes?.store_bonuses;
    if (Array.isArray(direct) && direct.length > 0) return direct;
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
        name: title(entity, locale, titleOrder),
        original_name: entity.title,
        type: entity.kind,
        category: entity.kind,
        level: 0,
        cover_image_url: resolvedCover.src || undefined,
      },
    ];
    const links: GraphLink[] = [];
    const seenNodes = new Set<string>([entity.id || id]);

    for (const r of relations) {
      const otherId = r.source_id === entity.id ? r.target_id : r.source_id;
      const targetEntity = relatedEntities[otherId];
      if (!seenNodes.has(otherId)) {
        seenNodes.add(otherId);
        nodes.push({
          id: otherId,
          name: targetEntity ? title(targetEntity, locale, titleOrder) : otherId.slice(0, 8),
          original_name: targetEntity ? targetEntity.title : "",
          type: targetEntity?.kind || "related",
          category: targetEntity?.kind || "related",
          level: 1,
          cover_image_url: targetEntity?.pictures?.[0]?.url || undefined,
        });
      }
      links.push({
        source: r.source_id,
        target: r.target_id,
        type: r.type,
        label: getRelationName(defs, r.type, true, locale),
      });
    }

    return { graphNodes: nodes, graphLinks: links };
  }, [entity, relations, relatedEntities, resolvedCover, locale, id]);

  const copyUuid = () => {
    if (!entity || !entity.id) return;
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

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentBody.trim() || !entity) return;
    if (!user) {
      window.location.href = getAuthLoginUrl(window.location.href);
      return;
    }
    setSubmittingComment(true);
    setCommentError("");
    try {
      const res = await api<{ ok: boolean; item?: any }>(`/community/entities/${entity.id}/posts`, "POST", { body: newCommentBody.trim() });
      if (res.item) {
        setCommunityPosts((prev) => [res.item, ...prev]);
      } else {
        setCommunityPosts((prev) => [
          {
            id: String(Date.now()),
            author_id: user.id,
            author_name: user.username,
            body: newCommentBody.trim(),
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
      setNewCommentBody("");
    } catch (err: any) {
      setCommentError(err.message || "Failed to post comment");
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
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
        <div className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-black/10 dark:border-white/10 px-4 py-2.5 flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-black/10 dark:border-white/10 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("entity.detail.backToDetail")}</span>
            </button>
            <span className="font-mono text-xs text-gray-400">/</span>
            <span className="font-medium text-xs text-gray-900 dark:text-white truncate max-w-md">
              {title(entity, locale, titleOrder)}
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

  const localizedTitle = title(entity, locale, titleOrder);
  const showOriginal = isDistinctOriginalTitle(entity.title, localizedTitle);

  // Categorize relations
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

  const isStaffType = (type: string) =>
    [
      "composed_by",
      "arranged_by",
      "lyrics_by",
      "directed_by",
      "written_by",
      "illustrated_by",
      "created_by",
      "produced_by",
      "voiced_by",
      "performed_by",
      "character_in",
      "stars",
      "publisher",
      "label",
    ].includes(type);

  const staffRelations = categorizedRelations.filter(
    (r) => isStaffType(r.type) || (r.target && r.target.kind === "agent")
  );

  const mediaRelations = categorizedRelations.filter(
    (r) => !isStaffType(r.type) && (!r.target || r.target.kind !== "agent")
  );

  const collectionRelations = categorizedRelations.filter(
    (r) => r.target && r.target.kind === "collection"
  );

  // Combine collections from relations and community collections
  const allDisplayCollections = [
    ...collectionRelations.map((r) => ({
      id: r.otherId,
      title: r.target ? title(r.target, locale, titleOrder) : r.otherId,
      curator: r.target?.created_by ? "Community" : "MetaFusion",
    })),
    ...communityCollections.filter(
      (c) => !collectionRelations.some((r) => r.otherId === c.id)
    ),
  ];

  // Group directory elements
  const mediums = children.filter((c) => c.kind === "medium");
  const tracksByMedium: Record<string, Entity[]> = {};
  for (const m of mediums) {
    if (!m.id) continue;
    tracksByMedium[m.id] = children
      .filter((c) => c.kind === "track" && c.medium_id === m.id)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  const unassignedTracks = children.filter((c) => c.kind === "track" && !c.medium_id);
  const contentUnits = children.filter((c) => c.kind === "content_unit");
  const expressions = children.filter((c) => c.kind === "expression");

  const rowLocales = Object.keys(entity.translations || {});
  const chain = buildTitleChain(locale, { order: titleOrder, originalLanguage: entity.original_language }, rowLocales);
  const summaryRow = (() => {
    for (const loc of chain) {
      const row = findRowForLocale(
        Object.entries(entity.translations || {}).map(([l, r]) => ({ locale: l, summary: r?.summary })),
        loc,
      );
      const s = (row?.summary || "").trim();
      if (s) return s;
    }
    return "";
  })();
  const summaryText =
    summaryRow ||
    entity.attributes?.summary ||
    entity.attributes?.description ||
    "";

  const resolvedAliases: string[] = (() => {
    for (const loc of chain) {
      const row = findRowForLocale(
        Object.entries(entity.translations || {}).map(([l, r]) => ({ locale: l, aliases: r?.aliases })),
        loc,
      );
      if (row?.aliases && row.aliases.length > 0) return row.aliases;
    }
    return [];
  })() || [];

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-x-hidden selection:bg-primary selection:text-white">
      {/* Atmosphere Glow */}
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6 w-full space-y-6 flex-1 pb-[max(3rem,env(safe-area-inset-bottom))]">
        {/* Top Breadcrumb Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-gray-500 border-b border-black/5 dark:border-white/[0.06] pb-3">
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
                  title={title(motherWork, locale, titleOrder)}
                >
                  {title(motherWork, locale, titleOrder)}
                </Link>
              </>
            )}
            {motherRelease && (
              <>
                <span className="text-gray-400 dark:text-white/20">/</span>
                <Link
                  href={`/catalog/${motherRelease.id}`}
                  className="hover:text-primary transition-colors truncate max-w-[200px]"
                  title={title(motherRelease, locale, titleOrder)}
                >
                  {title(motherRelease, locale, titleOrder)}
                </Link>
              </>
            )}
            <span className="text-gray-400 dark:text-white/20">/</span>
            <span className="text-gray-900 dark:text-white font-semibold truncate max-w-[280px]">
              {localizedTitle}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyUuid}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all text-xs font-mono cursor-pointer"
              title={entity.id}
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedId ? t("entity.detail.idCopied") : t("entity.detail.copyId")}</span>
            </button>

            <span className="px-2.5 py-1 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 text-xs uppercase font-semibold font-mono">
              {entity.status}
            </span>
          </div>
        </div>

        {/* Master 2-Column Wiki Layout (Inspired by 2cd76d44) */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8 items-start">
          {/* ============================================================ */}
          {/* LEFT SIDEBAR: Cover + Facts + External Authority             */}
          {/* ============================================================ */}
          <aside className="w-full space-y-6 shrink-0">
            {/* 1. Cover Card */}
            <div className="rounded-xl overflow-hidden border border-black/10 dark:border-white/[0.12] bg-surface shadow-md">
              <AdaptiveCover
                src={resolvedCover.src}
                alt={localizedTitle}
                title={localizedTitle}
                originalTitle={entity.title}
                id={entity.id}
                aspect={resolvedCover.aspect}
                className="w-full h-auto object-cover"
              />
            </div>

            {/* 2. External Authority & Official Links (官网与各权威数据源同级一体化呈现) */}
            <ExternalAuthorityLinks
              entity={entity}
              category={entity.kind}
              variant="list"
            />

            {/* 3. Basic Facts & Information Card */}
            <div className="p-4 sm:p-5 rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface shadow-soft space-y-4">
              <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-2.5">
                <Sliders className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h3 className="font-display text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white font-mono">
                  {t("entity.page.basicInfo")}
                </h3>
              </div>

              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                    {t("entity.page.entityKind")}
                  </dt>
                  <dd className="font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <span>{t(`catalog.kind.${entity.kind}`) || entity.kind}</span>
                  </dd>
                </div>

                {(entity.attributes?.edition_date || entity.attributes?.release_date || entity.attributes?.begin_date) && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.releaseDate")}
                    </dt>
                    <dd className="font-medium text-gray-900 dark:text-white font-mono flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-500" />
                      <span>{String(entity.attributes.edition_date || entity.attributes.release_date || entity.attributes.begin_date)}</span>
                    </dd>
                  </div>
                )}

                {(entity.attributes?.format || entity.attributes?.packaging) && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.formatPackaging")}
                    </dt>
                    <dd className="font-medium text-gray-900 dark:text-white uppercase font-mono">
                      {[entity.attributes.format, entity.attributes.packaging].filter(Boolean).join(" · ")}
                    </dd>
                  </div>
                )}

                {(entity.attributes?.catalog_number || entity.attributes?.catalogue_number) && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.catalogNumber")}
                    </dt>
                    <dd className="font-mono font-semibold text-primary">
                      {String(entity.attributes.catalog_number || entity.attributes.catalogue_number)}
                    </dd>
                  </div>
                )}

                {(entity.attributes?.barcode || entity.attributes?.jan || entity.attributes?.ean) && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.barcode")}
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-white">
                      {String(entity.attributes.barcode || entity.attributes.jan || entity.attributes.ean)}
                    </dd>
                  </div>
                )}

                {officialInfo && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.officialLink")}
                    </dt>
                    <dd className="font-mono text-emerald-600 dark:text-emerald-400 truncate">
                      <a
                        href={officialInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:underline truncate max-w-full text-[11px]"
                      >
                        <Globe className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        <span className="truncate">{officialInfo.url.replace(/^https?:\/\//, "")}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0 opacity-70" />
                      </a>
                    </dd>
                  </div>
                )}

                {entity.attributes?.publisher && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.publisher")}
                    </dt>
                    <dd className="font-medium text-gray-900 dark:text-white">
                      {String(entity.attributes.publisher)}
                    </dd>
                  </div>
                )}

                {durationText && (
                  <div>
                    <dt className="text-gray-400 font-mono text-[11px] mb-0.5">
                      {t("entity.page.totalDuration")}
                    </dt>
                    <dd className="font-mono text-gray-900 dark:text-white flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span>{durationText}</span>
                    </dd>
                  </div>
                )}
              </dl>

              {/* Dynamic Attributes：仅补充上面结构化区块未展示的字段，
                  否则 edition_date / 品番 / 载体等会在此重复出现一次。 */}
              {entity.attributes && Object.keys(entity.attributes).length > 0 && (
                <div className="pt-3 border-t border-black/5 dark:border-white/[0.06]">
                  <DynamicAttributeViewer
                    attributes={entity.attributes}
                    defs={defs}
                    excludeKeys={STRUCTURED_ATTRIBUTE_KEYS}
                  />
                </div>
              )}

              {/* Types & Tags */}
              {((entity.types && entity.types.length > 0) || (entity.attributes?.tags && Array.isArray(entity.attributes.tags))) && (
                <div className="pt-3 border-t border-black/5 dark:border-white/[0.06] space-y-2">
                  <div className="flex items-center gap-1 text-[11px] font-mono text-gray-400">
                    <TagIcon className="w-3 h-3" />
                    <span>{t("entity.page.typesTags")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(entity.types || []).map((tCode: string, idx: number) => (
                      <Link
                        key={idx}
                        href={`/explore?kind=${encodeURIComponent(entity.kind)}&type=${encodeURIComponent(tCode)}`}
                        className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 text-[11px] font-mono font-semibold transition-colors"
                      >
                        {getTypeName(defs, tCode, locale)}
                      </Link>
                    ))}
                    {(Array.isArray(entity.attributes?.tags) ? entity.attributes.tags : []).map((tag: any, idx: number) => {
                      const tagName = typeof tag === "string" ? tag : tag?.name || String(tag);
                      return (
                        <Link
                          key={idx}
                          href={`/explore?tags=${encodeURIComponent(tagName)}`}
                          className="px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] hover:bg-primary/10 hover:text-primary text-gray-700 dark:text-gray-300 text-[11px] transition-colors"
                        >
                          {tagName}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 4. Decoupled Resource Station Quick Jump */}
            <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] dark:bg-sky-500/[0.08] space-y-2.5">
              <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs font-mono">
                <HardDrive className="w-4 h-4" />
                <span>{t("entity.page.resourceStation")}</span>
              </div>
              <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
{t("entity.page.resourceStationDesc")}
              </p>
              <a
                href={getStorageEntityUrl(entity.id || id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
              >
                <span>{t("entity.page.openResourceStation")}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </aside>

          {/* ============================================================ */}
          {/* RIGHT COLUMN: Main Content Flow (Wiki Standard)              */}
          {/* ============================================================ */}
          <div className="min-w-0 flex-1 space-y-8">
            {/* Header Area */}
            <header className="space-y-4 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-xs font-mono font-bold tracking-wider">
                  {t(`catalog.kind.${entity.kind}`) || entity.kind}
                </span>

                {(entity.attributes?.edition_date || entity.attributes?.release_date) && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-300 font-mono text-xs">
                    <Calendar className="w-3 h-3 text-amber-400" strokeWidth={1.5} />
                    <span>{entity.attributes.edition_date || entity.attributes.release_date}</span>
                  </span>
                )}

                {entity.attributes?.format && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 font-mono text-xs uppercase">
                    <Disc className="w-3 h-3 text-primary" strokeWidth={1.5} />
                    <span>{entity.attributes.format}</span>
                  </span>
                )}
              </div>

              {/* Title & Original Title */}
              <div>
                <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
                  {localizedTitle}
                </h1>
                {showOriginal && (
                  <p className="font-mono text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1">
                    {entity.title}
                  </p>
                )}
              </div>

              {/* Aliases */}
              {resolvedAliases.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
                    {t("entity.page.aliases")}
                  </span>
                  {resolvedAliases.map((alias, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-black/[0.03] dark:bg-white/[0.04] text-gray-700 dark:text-gray-300 font-mono">
                      {alias}
                    </span>
                  ))}
                </div>
              )}

              {/* Action Toolbar */}
              <div className="pt-3 border-t border-black/5 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 shadow-sm transition-all cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.editEntity")}</span>
                  </button>

                  <Link
                    href={`/compare?ids=${entity.id}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-primary/50 hover:text-primary transition-all shadow-2xs"
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.compareAdd")}</span>
                  </Link>

                  

                  <a
                    href="#revisions"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-primary/50 hover:text-primary transition-all shadow-2xs"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>{t("entity.detail.revisionsTitle")}</span>
                  </a>

                  <a
                    href={getStorageEntityUrl(entity.id || id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-500/25 bg-sky-500/10 text-xs font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 hover:border-sky-500/40 transition-all shadow-2xs cursor-pointer"
                    title={t("entity.page.openResourceDownload")}
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>{t("entity.page.resourceStation")}</span>
                    <ArrowUpRight className="w-3 h-3 opacity-70" />
                  </a>

                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all shadow-2xs cursor-pointer"
                    title="Share link"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? t("entity.page.linkCopied") : t("entity.page.share")}</span>
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

              {/* Sticky / Smooth Anchor Navigation Bar */}
              <nav className="flex items-center gap-4 border-b border-black/10 dark:border-white/[0.08] pt-2 overflow-x-auto text-xs font-mono">
                <a href="#overview" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                  {t("entity.page.navOverview")}
                </a>
                {staffRelations.length > 0 && (
                  <a href="#staff" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                    {t("entity.page.navStaff")} ({staffRelations.length})
                  </a>
                )}
                {children.length > 0 && (
                  <a href="#contents" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                    {t("entity.page.navContents")} ({children.length})
                  </a>
                )}
                {occurrences.length > 0 && (
                  <a href="#releases" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                    {t("entity.page.navReleases")} ({occurrences.length})
                  </a>
                )}
                {mediaRelations.length > 0 && (
                  <a href="#relations" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                    {t("entity.page.navRelations")} ({mediaRelations.length})
                  </a>
                )}
                <a href="#community" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary font-semibold text-primary">
                  {t("entity.page.navCommunity")} ({communityPosts.length})
                </a>
                <a href="#revisions" className="py-2 text-gray-600 dark:text-gray-300 hover:text-primary transition-colors border-b-2 border-transparent hover:border-primary">
                  {t("entity.detail.revisionsTitle")}
                </a>
              </nav>
            </header>

            {/* ============================================================ */}
            {/* Section 1: Overview & Summary                                */}
            {/* ============================================================ */}
            <section id="overview" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
              <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/[0.06] pb-3">
                <BookOpen className="w-4 h-4 text-primary" strokeWidth={1.5} />
                <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                  {t("entity.page.overviewTitle")}
                </h2>
              </div>

              {summaryText ? (
                <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                  {summaryText}
                </div>
              ) : (
                <div className="text-xs text-gray-400 italic">
                  {t("entity.page.noSummary")}
                </div>
              )}

              {/* Mother Work Direct Card */}
              {motherWork && (
                <div className="pt-2">
                  <Link
                    href={`/catalog/${motherWork.id}`}
                    className="group inline-flex items-center gap-3.5 p-3 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-primary/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all w-full"
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/5 dark:bg-white/5 shrink-0 border border-black/10 dark:border-white/10">
                      <AdaptiveCover
                        src={motherWork.pictures?.[0]?.url || resolvedCover.src}
                        alt={title(motherWork, locale, titleOrder)}
                        title={title(motherWork, locale, titleOrder)}
                        id={motherWork.id}
                        aspect="2:3"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] text-primary uppercase tracking-wider font-semibold">
                        {t("entity.detail.partOfWork")}
                      </div>
                      <div className="font-display text-sm font-bold text-gray-900 dark:text-white group-hover:text-primary truncate">
                        {title(motherWork, locale, titleOrder)}
                      </div>
                      {isDistinctOriginalTitle(motherWork.title, title(motherWork, locale, titleOrder)) && (
                        <div className="font-mono text-xs text-gray-400 truncate">
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
                <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] dark:bg-amber-500/[0.08] space-y-2">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                    <Sparkles className="w-4 h-4" />
                    <span>{t("entity.detail.storeBonuses")}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {storeBonuses.map((bonus: any, idx: number) => (
                      <div key={idx} className="flex flex-wrap items-baseline gap-2 text-gray-800 dark:text-gray-200">
                        <span className="font-semibold text-amber-700 dark:text-amber-300 font-mono">
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
            </section>

            {/* ============================================================ */}
            {/* Section 2: Staff & Credits (演职人员与创作者)                 */}
            {/* ============================================================ */}
            {staffRelations.length > 0 && (
              <section id="staff" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                      {t("entity.page.staffTitle")}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                      {staffRelations.length}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {staffRelations.map((r) => {
                    const target = r.target;
                    const targetTitle = target ? title(target, locale, titleOrder) : r.otherId;
                    return (
                      <Link
                        key={r.id}
                        href={`/catalog/${r.otherId}`}
                        className="p-3 rounded-xl border border-black/5 dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015] hover:border-primary/50 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all flex items-center gap-3 group"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary grid place-items-center font-bold text-xs shrink-0 overflow-hidden border border-primary/20">
                          {target?.pictures?.[0]?.url ? (
                            <img src={target.pictures[0].url} alt={targetTitle} className="w-full h-full object-cover" />
                          ) : (
                            <span>{targetTitle[0]?.toUpperCase() || "A"}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="text-[10px] font-mono font-semibold text-primary tracking-wider">
                            {getRelationName(defs, r.type, r.source_id === entity.id, locale)}
                          </div>
                          <div className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-white group-hover:text-primary truncate">
                            {targetTitle}
                          </div>
                          {target && isDistinctOriginalTitle(target.title, targetTitle) && (
                            <div className="text-[10px] text-gray-400 font-mono truncate">
                              {target.title}
                            </div>
                          )}
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ============================================================ */}
            {/* Section 3: Contents & Tracklist (内容目录与曲目结构)          */}
            {/* ============================================================ */}
            {children.length > 0 && (
              <section id="contents" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <List className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                      {t("entity.page.contentsTitle")}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                      {children.length}
                    </span>
                  </div>
                </div>

                {/* Mediums & Tracks (for Releases) */}
                {mediums.length > 0 ? (
                  <div className="space-y-4">
                    {mediums.map((m) => {
                      const mTracks = (m.id ? tracksByMedium[m.id] : []) || [];
                      return (
                        <div key={m.id} className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden bg-black/[0.01] dark:bg-white/[0.01]">
                          <div className="px-4 py-3 bg-black/[0.03] dark:bg-white/[0.04] border-b border-black/10 dark:border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-2 font-mono text-xs font-bold text-gray-900 dark:text-white">
                              <Disc className="w-4 h-4 text-primary" />
                              <span>{title(m, locale, titleOrder)}</span>
                              {m.attributes?.format && (
                                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase">
                                  {m.attributes.format}
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-xs text-gray-400">
                              {mTracks.length} {t("entity.page.tracksUnit")}
                            </span>
                          </div>

                          <div className="divide-y divide-black/5 dark:divide-white/[0.06]">
                            {mTracks.map((t: Entity, idx: number) => {
                              const tDur = t.attributes?.duration_seconds || t.attributes?.duration;
                              let durStr = "";
                              if (typeof tDur === "number") {
                                durStr = `${Math.floor(tDur / 60)}:${String(tDur % 60).padStart(2, "0")}`;
                              }
                              return (
                                <div key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="font-mono text-gray-400 w-6 text-right shrink-0">
                                      {t.position || idx + 1}
                                    </span>
                                    <Link
                                      href={`/catalog/${t.id}`}
                                      className="font-medium text-gray-900 dark:text-white hover:text-primary truncate"
                                    >
                                      {title(t, locale, titleOrder)}
                                    </Link>
                                  </div>
                                  {durStr && (
                                    <span className="font-mono text-gray-400 shrink-0">
                                      {durStr}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Content Units & Expressions (for Works) */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {children.map((c) => (
                      <Link
                        key={c.id}
                        href={`/catalog/${c.id}`}
                        className="p-3 rounded-xl border border-black/5 dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015] hover:border-primary/50 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all flex items-center justify-between gap-3 group"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-mono uppercase font-semibold shrink-0">
                            {t("catalog.kind." + c.kind) || c.kind}
                          </span>
                          <span className="font-medium text-xs sm:text-sm text-gray-900 dark:text-white group-hover:text-primary truncate">
                            {title(c, locale, titleOrder)}
                          </span>
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ============================================================ */}
            {/* Section 4: Releases & Occurrences (发行版本与收录情况)        */}
            {/* ============================================================ */}
            {occurrences.length > 0 && (
              <section id="releases" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <Disc className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                      {t("entity.page.releasesTitle")}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                      {occurrences.length}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-white/10 text-gray-400">
                        <th className="pb-2 font-medium">{t("entity.page.colEdition")}</th>
                        <th className="pb-2 font-medium">{t("entity.page.colFormat")}</th>
                        <th className="pb-2 font-medium">{t("entity.page.colCatalogNo")}</th>
                        <th className="pb-2 font-medium text-right">{t("entity.page.colDate")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/[0.06]">
                      {occurrences.map((occ: any, idx: number) => {
                        const rel = occ.release;
                        if (!rel) return null;
                        const editionType = rel.attributes?.edition_type ? String(rel.attributes.edition_type) : "";
                        const isBoxset =
                          editionType === "boxset" ||
                          occ.is_compilation ||
                          rel.attributes?.packaging?.toLowerCase()?.includes("box");
                        return (
                          <tr key={rel.id || idx} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                            <td className="py-2.5 pr-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/catalog/${rel.id}`}
                                  className="font-semibold text-gray-900 dark:text-white hover:text-primary inline-flex items-center gap-1.5"
                                >
                                  {title(rel, locale, titleOrder)}
                                  <ArrowUpRight className="w-3.5 h-3.5 text-gray-400" />
                                </Link>
                                {isBoxset && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[10px] font-semibold">
                                    {getTermName(defs, "edition_type", "boxset", locale) !== "boxset"
                                      ? getTermName(defs, "edition_type", "boxset", locale)
                                      : t("release.editionType.boxset")}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 uppercase text-gray-600 dark:text-gray-300">
                              {rel.attributes?.format
                                ? getTermName(defs, "format", String(rel.attributes.format), locale) !== String(rel.attributes.format)
                                  ? getTermName(defs, "format", String(rel.attributes.format), locale)
                                  : String(rel.attributes.format)
                                : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-primary font-semibold">
                              {rel.attributes?.catalog_number || "—"}
                            </td>
                            <td className="py-2.5 pl-3 text-right text-gray-500">
                              {rel.attributes?.edition_date || rel.attributes?.release_date || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ============================================================ */}
            {/* Section 5: Relations & Graph (关联作品与图谱)                 */}
            {/* ============================================================ */}
            {mediaRelations.length > 0 && (
              <section id="relations" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
                <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                      {t("entity.page.relationsTitle")}
                    </h2>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                      {mediaRelations.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] p-0.5 rounded-lg text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setRelationViewMode("cards")}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        relationViewMode === "cards"
                          ? "bg-surface text-gray-900 dark:text-white font-semibold shadow-xs"
                          : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {t("entity.page.viewCards")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRelationViewMode("graph")}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        relationViewMode === "graph"
                          ? "bg-surface text-gray-900 dark:text-white font-semibold shadow-xs"
                          : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {t("entity.page.viewGraph")}
                    </button>
                  </div>
                </div>

                {relationViewMode === "graph" ? (
                  <div className="h-[360px] rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
                    <InteractiveRelationGraph
                      centerEntityId={entity.id || id}
                      centerEntityType={entity.kind}
                      nodes={graphNodes}
                      links={graphLinks}
                      onNodeClick={(n) => {
                        if (n.id && n.id !== entity.id) {
                          window.location.href = `/catalog/${n.id}`;
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {mediaRelations.map((r) => {
                      const target = r.target;
                      const targetTitle = target ? title(target, locale, titleOrder) : r.otherId;
                      return (
                        <Link
                          key={r.id}
                          href={`/catalog/${r.otherId}`}
                          className="p-3 rounded-xl border border-black/5 dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015] hover:border-primary/50 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-all flex items-center justify-between gap-3 group"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="text-[10px] font-mono font-semibold text-primary tracking-wider">
                              {getRelationName(defs, r.type, r.source_id === entity.id, locale)}
                            </div>
                            <div className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-white group-hover:text-primary truncate">
                              {targetTitle}
                            </div>
                            {target && isDistinctOriginalTitle(target.title, targetTitle) && (
                              <div className="text-[10px] text-gray-400 font-mono truncate">
                                {target.title}
                              </div>
                            )}
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-primary transition-colors shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* ============================================================ */}
            {/* Section 6: Embedded Community Discussions & Collections      */}
            {/* ============================================================ */}
            <section id="community" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-6 shadow-soft scroll-mt-20">
              <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" strokeWidth={1.5} />
                  <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                    {t("entity.page.communityTitle")}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {communityPosts.length}
                  </span>
                </div>
                <a
                  href={getForumEntityUrl(entity.id || id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
                >
                  <span>{t("entity.page.openInForum")}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Quick Comment Composer */}
              <form onSubmit={handlePostComment} className="p-4 rounded-xl border border-black/10 dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.015] space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="font-medium text-gray-700 dark:text-gray-300 font-mono">
                    {t("entity.page.quickReview")}
                  </span>
                  {user ? (
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      @{user.username}
                    </span>
                  ) : (
                    <a href={getAuthLoginUrl()} className="text-primary hover:underline font-medium">
                      {t("entity.page.signInToComment")}
                    </a>
                  )}
                </div>
                <textarea
                  value={newCommentBody}
                  onChange={(e) => setNewCommentBody(e.target.value)}
                  placeholder={
                    user
                      ? (t("entity.page.commentPlaceholderAuthed"))
                      : (t("entity.page.commentPlaceholderGuest"))
                  }
                  disabled={!user || submittingComment}
                  rows={3}
                  className="w-full p-3 rounded-lg bg-surface border border-black/10 dark:border-white/10 text-xs sm:text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 resize-y"
                />
                {commentError && (
                  <div className="text-xs text-rose-500 font-mono">{commentError}</div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-gray-400">
                    {t("entity.page.syncNotice")}
                  </span>
                  {user ? (
                    <button
                      type="submit"
                      disabled={submittingComment || !newCommentBody.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{submittingComment ? t("entity.page.posting") : t("entity.page.postComment")}</span>
                    </button>
                  ) : (
                    <a
                      href={getAuthLoginUrl()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-all"
                    >
                      <span>{t("entity.page.sendAfterLogin")}</span>
                    </a>
                  )}
                </div>
              </form>

              {/* Embedded Comments Stream */}
              <div className="space-y-3">
                <h3 className="font-display text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                  {t("entity.page.discussionStream")} ({communityPosts.length})
                </h3>
                {communityPosts.length === 0 ? (
                  <div className="p-8 rounded-xl border border-dashed border-black/10 dark:border-white/10 text-center space-y-2">
                    <MessageSquare className="w-8 h-8 mx-auto text-gray-400 opacity-50" />
                    <p className="text-xs text-gray-500">
                      {t("entity.page.noDiscussions")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {communityPosts.map((post: any) => (
                      <div key={post.id} className="p-4 rounded-xl border border-black/5 dark:border-white/[0.06] bg-black/[0.015] dark:bg-white/[0.015] space-y-2 hover:border-black/15 dark:hover:border-white/15 transition-colors">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/15 text-primary grid place-items-center font-mono text-[11px] font-bold">
                              {(post.author_name || "U")[0].toUpperCase()}
                            </div>
                            <span className="font-semibold text-gray-900 dark:text-white font-mono text-xs">
                              {post.author_name || "User"}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-400 font-mono">
                            {post.created_at ? new Date(post.created_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line pl-8">
                          {post.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Embedded Collections (合集) */}
              <div className="pt-4 border-t border-black/5 dark:border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-indigo-500" />
                    <h3 className="font-display text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                      {t("entity.page.collectionsFeaturing")} ({allDisplayCollections.length})
                    </h3>
                  </div>
                  <a
                    href={`${FORUM_SERVICE_URL}/collections`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <span>{t("entity.page.exploreCollections")}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                </div>

                {allDisplayCollections.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-black/10 dark:border-white/10 text-center text-xs text-gray-500">
                    {t("entity.page.noCollections")}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {allDisplayCollections.map((col: any) => (
                      <a
                        key={col.id}
                        href={getForumCollectionUrl(col.id)}
                        className="p-3.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-indigo-500/50 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-all flex items-start gap-3 group cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 grid place-items-center shrink-0">
                          <FolderPlus className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                            {col.title}
                          </div>
                          <div className="text-[11px] text-gray-500 font-mono truncate">
                            {t("entity.page.curatorBy")}{col.curator || "Community"}
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors shrink-0 mt-0.5" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ============================================================ */}
            {/* Section 7: Revisions (修订历史)                             */}
            {/* ============================================================ */}
            <section id="revisions" className="rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface p-5 sm:p-6 space-y-4 shadow-soft scroll-mt-20">
              <div className="flex items-center justify-between border-b border-black/5 dark:border-white/[0.06] pb-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" strokeWidth={1.5} />
                  <h2 className="font-display text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider font-mono">
                    {t("entity.page.revisionsHistory")}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {revisions.length || 1}
                  </span>
                </div>
              </div>

<EntityRevisions revisions={revisions} currentEntity={entity} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
