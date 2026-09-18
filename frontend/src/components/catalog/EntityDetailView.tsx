"use client";

import React, { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { EntityCover } from "@/components/common/EntityCover";
import FavoriteButton from "@/components/FavoriteButton";
import { WorkFacts, entityBadges } from "@/components/work/WorkFacts";
import { LocalizedTitleGroups } from "@/components/entity/LocalizedTitleGroups";
import { EntityEditor } from "@/components/catalog/EntityEditor";
import { useCatalog } from "@/components/catalog/CatalogProvider";
import { api, Entity, Relation, title, local } from "@/components/catalog/api";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import { isDistinctOriginalTitle, findRowForLocale, buildTitleChain } from "@/lib/titles";
import { isNotFoundError, localizeCatalogError } from "@/lib/catalogErrors";
import { localizeCommunityError } from "@/lib/communityErrors";
import { formalDetailUrl, keepsGenericView } from "@/lib/entityRoutes";
import { copyText } from "@/lib/clipboard";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import {
  GraphNode,
  GraphLink,
  FavoriteTargetType,
  fetchEntityPosts,
  fetchEntityCollections,
  createEntityComment,
} from "@/lib/api";
import type { EntityComment, EntityCollectionRef } from "@/lib/api";
import { EntityRevisions } from "./EntityRevisions";
import { RelationFilterBar, useRelationFilter } from "@/components/entity/RelationFilterBar";
import { UNGROUPED_RELATION_GROUP } from "@/lib/relationFilters";
import { PageShell, PageContainer } from "@/components/ui/PageShell";
import { TabPanel } from "@/components/ui/TabPanel";
import { Card, CardTitle } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { TabBar, useHashTab, TabItem } from "@/components/catalog/DetailTabs";
import { ExternalAuthorityLinks } from "@/components/entity/ExternalAuthorityLinks";
import { EntityResourceFiles } from "@/components/storage/EntityResourceFiles";
import { useDefinitions, getKindName, getTypeName, getRelationName, getFieldName, getTermName, resolveLocalizedName } from "@/lib/definitions";
import {
  getAuthLoginUrl,
  getForumEntityUrl,
  getForumCollectionUrl,
  getStorageEntityUrl,
  FORUM_SERVICE_URL,
  hasResourceStation,
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
  ListTree,
} from "lucide-react";

const InteractiveRelationGraph = dynamic(
  () =>
    import("@/components/graph/InteractiveRelationGraph").then(
      (m) => m.InteractiveRelationGraph
    ),
  { ssr: false }
);

/** 兜底分组键：全站唯一来源在 relationFilters（筛选条分面与关系网格必须用同一个键，
 * 否则同一页会出现两个"其他关系"分组）。 */
const FALLBACK_RELATION_GROUP = UNGROUPED_RELATION_GROUP;

/** 关系分组只允许来自服务端 definitions：group=credits 的进"演职人员"区，
 * 其余按各自 group 分组展示，分组标题用 group_names 本地化。后台改分组后
 * 前端即刻跟随，不在本文件另维护一份名单。 */
const relationGroupOf = (defs: any, type: string): string =>
  defs?.relations?.[type]?.group || "";

/** 关系端点的展示题名：本地化题名 → 原语言题名 → id，绝不返回空串（不出现空标题）。 */
const endTitleOf = (
  e: Entity | undefined,
  id: string,
  locale: string,
  order: string[],
): string => (e ? title(e, locale, order) || e.title || id : id);

/**
 * 展示分组键：定义声明了 group_names 才按自己的 group 分组；
 * 没声明的（类型未定义 / group_names 为空）统一归入兜底分组，
 * 不按 group 码另立一组，也不借用分节标题充当分组名。
 * 多语言解析一律走 resolveLocalizedName，不在前端另拼文案。
 */
const relationGroupKey = (
  defs: any,
  type: string,
  locale: string,
): string => {
  const rel = defs?.relations?.[type];
  if (!rel) return FALLBACK_RELATION_GROUP;
  return resolveLocalizedName(rel.group_names, locale, "")
    ? rel.group || FALLBACK_RELATION_GROUP
    : FALLBACK_RELATION_GROUP;
};

/**
 * 演职人员头像：外链头像取不到时回退到首字母，而不是在圆框里留一个破图图标。
 * 同一页的封面已经走 EntityCover（失败即程序封面），这里补上同类问题的最后一处。
 */
function StaffAvatar({ src, name }: { src?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span>{name[0]?.toUpperCase() || "A"}</span>;
  return (
    <img
      src={src}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

async function allEntities(query: string): Promise<Entity[]> {
  const items: Entity[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await api<{ items: Entity[] }>(
      `/catalog/entities?${query}&offset=${offset}&limit=100`
    );
    // 契约漂移：直接取 r.items.length 会在缺字段时抛 "Cannot read properties of undefined"。
    // 这里抛出**可读**错误交给调用方现有的失败路径（子实体列表整块降级），不白屏、也不静默半截列表。
    if (!Array.isArray(r.items)) throw new Error("invalid_response: entities.items");
    items.push(...r.items);
    if (r.items.length < 100) return items;
  }
}

export function EntityDetailView({ id }: { id: string }) {
  const { t, tr, locale } = useI18n();
  const titleOrder = useTitleDisplayOrder();
  // 会话与定义各只有一个来源：Provider 不再缓存这两份。同一份数据存两处的问题是
  // 两处会不同步——定义发布、会话刷新后，只有恰好挂在 Provider 下的路由才看得到变化。
  const { modules } = useCatalog();
  const { user } = useAuth();
  const { definitions: dynamicDefs, kinds } = useDefinitions();
  const defs = dynamicDefs;
  // kind 展示名统一走服务端 definitions.kinds，字典只作兜底（缺键退原始码，不显示裸 key）。
  const kindLabel = useCallback(
    (kind: string) => getKindName(kinds, kind, locale, tr(`catalog.kind.${kind}`, kind)),
    [kinds, locale, tr],
  );
  // ?edit=1 直达编辑模式（works 页"编辑"跳转的目标）。useSearchParams 必须
  // 在任何早退 return 之前调用（hook 顺序），页面组件需提供 Suspense 边界。
  const searchParams = useSearchParams();
  const router = useRouter();

  const [entity, setEntity] = useState<Entity | null>(null);
  const [motherWork, setMotherWork] = useState<Entity | null>(null);
  const [motherRelease, setMotherRelease] = useState<Entity | null>(null);
  const [motherMedium, setMotherMedium] = useState<Entity | null>(null);
  const [occurrences, setOccurrences] = useState<any[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [relatedEntities, setRelatedEntities] = useState<Record<string, Entity>>({});
  // 响应标出的主体 id（/relations 的 subject_id）。旧响应没有该字段时留空，
  // 由页面已知实体兜底，判定口径不变。
  const [relationSubjectId, setRelationSubjectId] = useState<string>("");
  const [children, setChildren] = useState<Entity[]>([]);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [subjectWorks, setSubjectWorks] = useState<Entity[]>([]);
  const [communityPosts, setCommunityPosts] = useState<EntityComment[]>([]);
  // 失败与「没有评论/没有合集」必须分开：两处的空列表都各有一句文案。
  const [communityPostsFailed, setCommunityPostsFailed] = useState(false);
  const [communityCollectionsFailed, setCommunityCollectionsFailed] = useState(false);
  const [communityCollections, setCommunityCollections] = useState<EntityCollectionRef[]>([]);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  // 复制失败的分支：null 表示没有失败。复制不是"点了没反应"的动作，失败必须可见。
  const [copyFailed, setCopyFailed] = useState<"id" | "link" | null>(null);
  // 收敛到正式路由期间不渲染通用视图，避免先闪一次两栏布局。
  const [redirecting, setRedirecting] = useState(false);
  const [relationViewMode, setRelationViewMode] = useState<"cards" | "graph">("cards");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const e = await api<Entity>(`/catalog/entities/${id}/resolve`);
      setEntity(e);

      // 服务端没能判定 kind 时（未登录看不到草稿、上游不可用）在这里按同一规则再收敛一次，
      // 同一实体不该停在两套观感上；带 ?edit=1 时保留通用视图（编辑器只挂在这里）。
      // 余下请求直接跳过：这一页马上要被正式路由替换掉。
      const queryString = searchParams.toString();
      if (!keepsGenericView(queryString)) {
        const target = formalDetailUrl(e.kind, e.id, queryString);
        if (target) {
          setRedirecting(true);
          router.replace(target);
          return;
        }
      }

      // resolve 可能返回合并后的规范 id；回落路由参数只为类型收口（能渲染到这里的实体必有 id）。
      const communityId = e.id || id;
      // Fetch occurrences, relations, revisions, posts, collections in parallel
      // 互动服务的两条列表失败时只影响各自那一块：先记下失败，稍后连同数据一起落到 state。
      let postsFailed = false;
      let collectionsFailed = false;
      const [occRes, relRes, revRes, posts, collections] = await Promise.all([
        api<{ items: any[] }>(`/catalog/entities/${e.id}/occurrences`).catch(() => ({ items: [] })),
        api<{ items: Relation[]; entities?: Record<string, Entity>; subject_id?: string }>(`/catalog/entities/${e.id}/relations`).catch(() => ({ items: [] as Relation[], entities: undefined, subject_id: undefined })),
        api<{ items: any[] }>(`/catalog/entities/${e.id}/revisions`).catch(() => ({ items: [] })),
        // 互动服务没接入（或这两条端点不可用）时整块留空，不阻断条目详情渲染；
        // 端点与请求体由 lib/api/community.ts 的包装负责，本组件不再自己拼 URL。
        fetchEntityPosts(communityId).catch(() => { postsFailed = true; return [] as EntityComment[]; }),
        fetchEntityCollections(communityId).catch(() => { collectionsFailed = true; return [] as EntityCollectionRef[]; }),
      ]);

      const occItems = occRes.items || [];
      const relItems = relRes.items || [];
      // 关系对端实体由 relations 接口一并返回（单次批量查询），不再逐条 Get。
      // 映射覆盖每条关系的两端（含主体自身），subject_id 指出哪一端是主体；
      // 保留逐条回退，使前端部署不依赖后端是否已上线这两个字段。
      // 只认数组：非数组进 state 会让按 id 取对端的映射渲染成空白或抛错。
      if (Array.isArray(relRes.entities)) setRelatedEntities(relRes.entities);
      setRelationSubjectId(relRes.subject_id || e.id || "");
      const revItems = revRes.items || [];
      setOccurrences(occItems);
      setRelations(relItems);
      setRevisions(revItems);
      setCommunityPosts(posts);
      // 空数组 = 服务端确认没有；到这里仍是空且标记了失败 = 取不到——界面上不能混。
      setCommunityPostsFailed(postsFailed);
      setCommunityCollectionsFailed(collectionsFailed);
      setCommunityCollections(collections);

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

      // 后端未内嵌对端实体时的回退：逐条取。默认并发 8 并限制条数，
      // 避免数百条关系同时打满连接；上限内之外的条目会退回显示 UUID。
      // 取 id 集合时把每条边两端都算上：旧响应没有 entities 时也要能渲染两端题名。
      if (!relRes.entities) {
        const otherIds = Array.from(
          new Set(
            relItems
              .flatMap((r) => [r.source_id, r.target_id])
              .filter((x) => x && x !== e.id)
          )
        ).slice(0, 30);

        if (otherIds.length > 0) {
          parentPromises.push(
            (async () => {
              const map: Record<string, Entity> = {};
              for (let i = 0; i < otherIds.length; i += 8) {
                const batch = otherIds.slice(i, i + 8);
                const results = await Promise.all(
                  batch.map((targetId) =>
                    api<Entity>(`/catalog/entities/${targetId}`).catch(() => null)
                  )
                );
                results.forEach((target, idx) => {
                  if (target) map[batch[idx]] = target;
                });
              }
              setRelatedEntities(map);
            })()
          );
        }
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

  // 封面继承决策：比例一律留给 AdaptiveCover（自然比例优先），这里不做按 kind 的硬编码；
  // 服务端没有 cover_aspect 字段，所以本函数恒返回 aspect: null。
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


  // 头部徽章：主日期 + 模板 badge_fields 声明的字段（默认含平台/话数/载体格式）。
  // 取值逻辑与 /works/[id] 共用 entityBadges，字段码全部来自服务端模板声明。
  const headerBadges = useMemo(
    () =>
      entityBadges(entity, defs, locale).map((b) => ({
        icon:
          b.kind === "date" ? (
            <Calendar className="w-3 h-3 text-warn" strokeWidth={1.5} />
          ) : (
            <Disc className="w-3 h-3 text-primary" strokeWidth={1.5} />
          ),
        text: b.text,
      })),
    [entity, defs, locale],
  );

  // Graph nodes & links：节点摘要同样取自响应 entities 表，且每条关系的两端都建节点
  // （属性引用边的对端原先不在图上）；中心节点用 entities[subject_id] 的摘要，
  // 不依赖"页面上已知的实体"。缺表时才回退已知实体，仍缺则退回短 id。
  const { graphNodes, graphLinks } = useMemo(() => {
    if (!entity) return { graphNodes: [], graphLinks: [] };
    const centerId = entity.id || id;
    const nodeOf = (nid: string, level: number): GraphNode => {
      const e = relatedEntities[nid] || (nid === centerId ? entity : undefined);
      return {
        id: nid,
        name: e ? title(e, locale, titleOrder) || e.title || nid : nid.slice(0, 8),
        original_name: e ? e.title || "" : "",
        type: e?.kind || "related",
        category: e?.kind || "related",
        level,
        cover_image_url: e?.pictures?.[0]?.url || undefined,
      };
    };
    const nodes: GraphNode[] = [
      { ...nodeOf(centerId, 0), cover_image_url: resolvedCover.src || undefined },
    ];
    const links: GraphLink[] = [];
    const seenNodes = new Set<string>([centerId]);

    for (const r of relations) {
      for (const nid of [r.source_id, r.target_id]) {
        if (!nid || seenNodes.has(nid)) continue;
        seenNodes.add(nid);
        nodes.push(nodeOf(nid, 1));
      }
      links.push({
        source: r.source_id,
        target: r.target_id,
        type: r.type,
        label: getRelationName(defs, r.type, true, locale),
      });
    }

    return { graphNodes: nodes, graphLinks: links };
  }, [entity, relations, relatedEntities, resolvedCover, locale, id, defs, titleOrder]);

  const copyUuid = async () => {
    if (!entity?.id) return;
    // 走共享 helper：明文 http 或用户拒权时 navigator.clipboard 不存在，直接调它会同步抛
    // TypeError，按钮没有任何反馈（同一动作在 /invites、/developer 有 execCommand 降级）。
    const ok = await copyText(entity.id);
    setCopiedId(ok);
    setCopyFailed(ok ? null : "id");
    setTimeout(() => { setCopiedId(false); setCopyFailed(null); }, 2000);
  };

  const copyShareLink = async () => {
    if (typeof window === "undefined") return;
    const ok = await copyText(window.location.href);
    setCopiedLink(ok);
    setCopyFailed(ok ? null : "link");
    setTimeout(() => { setCopiedLink(false); setCopyFailed(null); }, 2000);
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentBody.trim() || !entity?.id) return;
    if (!user) {
      window.location.href = getAuthLoginUrl(window.location.href);
      return;
    }
    setSubmittingComment(true);
    setCommentError("");
    try {
      const created = await createEntityComment(entity.id, newCommentBody.trim());
      if (created) {
        setCommunityPosts((prev) => [created, ...prev]);
      } else {
        // 2xx 但响应没带 item：回读服务端列表。不在这里自造一条评论——
        // 伪 id/伪时间会让人以为已经落库，刷新后凭空消失。
        setCommunityPosts(await fetchEntityPosts(entity.id));
      }
      setNewCommentBody("");
    } catch (err: any) {
      // 错误码 → 四语文案（communityErrors：module_error/not_found + 目录表共享码）。
      setCommentError(
        localizeCommunityError(String(err?.message || ""), t) || t("community.error.postFailed")
      );
    } finally {
      setSubmittingComment(false);
    }
  };

  // 关系分组与分节标签必须在提前 return 之前求值：loading/error/editing 分支
  // 若少调用一次 hook，就会触发 "Rendered more hooks than during the previous render"。
  // 关系两端的摘要一律取自响应 entities 表（覆盖两端 + 主体自身）：
  // 主体一侧不再依赖"页面上已知的实体"，对端也不再只认页面上猜出的那一端。
  // 旧响应缺 subject_id 时回退被查询实体，行为与改动前一致。
  const categorizedRelations = useMemo(
    () =>
      relations.map((r) => {
        const subjectId = r.subject_id || relationSubjectId || entity?.id || "";
        const isOutgoing = subjectId === r.source_id;
        const isIncoming = subjectId === r.target_id;
        const isEndpoint = isOutgoing || isIncoming;
        // 跳转目标与对端摘要沿用旧口径（主体是终点时取 source，属性引用边同样取 source）。
        const otherId = isOutgoing ? r.target_id : r.source_id;
        // 展示用的两端：主体是端点时 = 主体 ↔ 对端；属性引用边（主体只是关系属性的取值，
        // 两端都不是主体）按边自身的方向展示 source → target，不硬把主体凑成一端。
        const fromId = isEndpoint ? subjectId : r.source_id;
        const toId = isEndpoint ? otherId : r.target_id;
        const subject =
          relatedEntities[subjectId] ||
          (subjectId && subjectId === entity?.id ? entity ?? undefined : undefined);
        return {
          ...r,
          subjectId,
          subject,
          otherId,
          target: relatedEntities[otherId],
          isOutgoing,
          /** 两端摘要：均取自响应 entities 表，缺表时才回退已知实体。 */
          from: relatedEntities[fromId] || (fromId === entity?.id ? entity ?? undefined : undefined),
          to: relatedEntities[toId] || (toId === entity?.id ? entity ?? undefined : undefined),
          fromId,
          toId,
        };
      }),
    [relations, relatedEntities, entity, relationSubjectId]
  );

  const staffRelations = useMemo(
    () =>
      categorizedRelations.filter(
        (r) => relationGroupOf(defs, r.type) === "credits"
      ),
    [categorizedRelations, defs]
  );

  const mediaRelations = useMemo(
    () =>
      categorizedRelations.filter(
        (r) => relationGroupOf(defs, r.type) !== "credits"
      ),
    [categorizedRelations, defs]
  );

  // 分类展示顺序：实体自身类型引用模板声明的 relation_groups（多类型声明合并去重）。
  const relationGroupOrder = useMemo(() => {
    const ordered: string[] = [];
    for (const tc of entity?.types || []) {
      const tpl = (defs as any)?.templates?.[(defs as any)?.types?.[tc]?.template || ""];
      for (const g of tpl?.relation_groups || []) {
        if (!ordered.includes(g)) ordered.push(g);
      }
    }
    return ordered;
  }, [defs, entity]);

  // 关系筛选：维度与选项由关系数据与 definitions 动态生成（关联对象 / 关系分类 / 关系类型），
  // 与作品详情的关系列表同一套口径；行里带上关系对象本身，筛完直接取回。
  const relationFacetRows = useMemo(
    () =>
      mediaRelations.map((r) => ({
        type: r.type,
        kind: r.target?.kind || "",
        label: getRelationName(defs, r.type, r.isOutgoing, locale),
        relation: r,
      })),
    [mediaRelations, defs, locale]
  );
  const relationFilter = useRelationFilter(relationFacetRows, relationGroupOrder);

  // 其余关系按展示分组归并：声明过的分类排前，声明外的按出现顺序，兜底分组固定在最后；
  // 定义缺失时进兜底分组，保证不丢数据。
  const groupedMediaRelations = useMemo(() => {
    type MediaRelation = (typeof mediaRelations)[number];
    const groups = new Map<string, MediaRelation[]>();
    for (const { relation } of relationFilter.visible) {
      const key = relationGroupKey(defs, relation.type, locale);
      const list = groups.get(key) || [];
      list.push(relation);
      groups.set(key, list);
    }
    const ordered: string[] = [];
    for (const key of relationGroupOrder) {
      if (groups.has(key) && !ordered.includes(key)) ordered.push(key);
    }
    for (const key of Array.from(groups.keys())) {
      if (key !== FALLBACK_RELATION_GROUP && !ordered.includes(key)) ordered.push(key);
    }
    if (groups.has(FALLBACK_RELATION_GROUP)) ordered.push(FALLBACK_RELATION_GROUP);
    return ordered.map((key) => ({ key, items: groups.get(key) || [] }));
  }, [relationFilter.visible, defs, locale, relationGroupOrder]);

  // 分组标题：取组内关系定义声明的 group_names 本地化——组内任一条声明了就用它，
  // 不因组内首条缺声明而整组降级；兜底分组用字典文案（与分节标题区分开）。
  const relationGroupTitle = (group: { key: string; items: typeof mediaRelations }): string => {
    if (group.key !== FALLBACK_RELATION_GROUP) {
      for (const r of group.items) {
        const name = resolveLocalizedName((defs as any)?.relations?.[r.type]?.group_names, locale, "");
        if (name) return name;
      }
    }
    return t("entity.page.relationsGroupOther");
  };

  // 社区模块未启用时不展示该标签，避免出现永远为空的分节。
  // modules 来自 /api/capabilities：契约漂移（缺字段/不是数组）时这里不能抛错——
  // 本组件在渲染路径上，抛一次整页白屏；取不到就按"未启用"处理（分节自然消失）。
  const communityEnabled =
    Array.isArray(modules) &&
    modules.some((m) => m.id === "community" && m.enabled && m.healthy);

  // 分节标签：与下方的条件渲染一一对应；标签集合随后数据到达再收窄。
  const tabs: TabItem[] = [
    { id: "overview", label: t("entity.page.navOverview"), icon: <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    { id: "staff", label: t("entity.page.navStaff"), badge: staffRelations.length, visible: staffRelations.length > 0, icon: <Users className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    { id: "contents", label: t("entity.page.navContents"), badge: children.length, visible: children.length > 0, icon: <ListTree className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    { id: "releases", label: t("entity.page.navReleases"), badge: occurrences.length, visible: occurrences.length > 0, icon: <Layers className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    { id: "relations", label: t("entity.page.navRelations"), badge: mediaRelations.length, visible: mediaRelations.length > 0, icon: <Network className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    // entity 在数据到达前为 null，这里只能安全取值；分节本身的可见性由 kind 决定。
    { id: "resources", label: t("entity.detail.resourcesTitle"), visible: defs?.structure?.[String(entity?.kind || "")]?.resources === true, icon: <HardDrive className="w-3.5 h-3.5" strokeWidth={1.5} /> },
    { id: "revisions", label: t("entity.detail.revisionsTitle"), badge: revisions.length || 1, icon: <History className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  ];
  const { active, select } = useHashTab(tabs);

  // 讨论分节已不在标签栏（id="community" 现在是普通锚点）。客户端渲染下浏览器
  // 处理 hash 时元素还不存在，旧链接 #community 会停在页首；数据就绪后补一次滚动。
  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!h) return;
    const el = document.getElementById(h);
    if (el) el.scrollIntoView({ block: "start" });
  }, [loading, communityEnabled, children.length, occurrences.length, mediaRelations.length]);

  if (loading || redirecting) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-clip">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
        <div className="relative z-10 min-h-[60vh] grid place-items-center font-mono text-xs text-text-muted">
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
      <div className="min-h-screen bg-background relative flex flex-col overflow-clip">
        <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
        <PageShell width="narrow" center>
          {/* 后端读取失败给的是稳定码（not_found）；裸码不能直接给用户看。 */}
          <div className="font-mono text-sm text-red-500 dark:text-danger">
            {!error || isNotFoundError(error) ? t("entity.detail.notFound") : localizeCatalogError(error, t)}
          </div>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all duration-base ease-soft"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t("nav.catalog")}</span>
          </Link>
        </PageShell>
      </div>
    );
  }

  // Editing mode
  if (editing) {
    return (
      <div className="min-h-screen bg-background relative flex flex-col overflow-clip">
        <PageContainer className="sticky top-[var(--mf-header-h)] z-30 bg-surface/90 backdrop-blur-md border-b border-line py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-xs font-medium text-text-body hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("entity.detail.backToDetail")}</span>
            </button>
            <span className="font-mono text-xs text-text-muted">/</span>
            <span className="font-medium text-xs text-text-strong truncate max-w-md">
              {title(entity, locale, titleOrder)}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-sm bg-primary/10 text-primary text-[10px] font-mono font-semibold uppercase">
            {t("entity.detail.editEntity")}
          </span>
        </PageContainer>
        <PageShell width="narrow">
          <EntityEditor
            initial={entity}
            onSaved={(updated) => {
              setEntity(updated);
              setEditing(false);
              void load();
            }}
          />
        </PageShell>
      </div>
    );
  }

  const localizedTitle = title(entity, locale, titleOrder);
  const showOriginal = isDistinctOriginalTitle(entity.title, localizedTitle);

  const collectionRelations = categorizedRelations.filter(
    (r) => r.target && r.target.kind === "collection"
  );

  // Combine collections from relations and community collections
  const allDisplayCollections = [
    ...collectionRelations.map((r) => ({
      id: r.otherId,
      title: endTitleOf(r.target, r.otherId, locale, titleOrder),
      curator: r.target?.created_by ? t("entity.collection.communityCurator") : "MetaFusion",
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

  // 别名/译名按语种分组展示（含主语言标记）：resolve DTO 的 translations 是
  // 按 locale 分组的对象，转成 LocalizedTitleGroups 需要的行数组。
  // 过去这里只取第一个有别名的语种拍平展示，其余语种别名全部丢失。
  // 注意：不得写成 useMemo——本组件此位置之前存在条件 return，hook 顺序会违规。

  return (
    <div className="min-h-screen bg-background relative flex flex-col overflow-clip selection:bg-primary selection:text-white">
      {/* Atmosphere Glow */}
      <div className="absolute inset-0 bg-radial-vignette opacity-70 pointer-events-none" aria-hidden />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[140px] pointer-events-none" aria-hidden />

      {/* Top Breadcrumb Navigation：作为页头交给外壳，页头到正文的间距由外壳统一给。 */}
      <PageShell
        width="page"
        className="pb-[max(3rem,env(safe-area-inset-bottom))]"
        header={
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text-faint border-b border-line-subtle pb-2.5">
          <div className="flex items-center gap-1.5 truncate">
            <Link href="/" className="hover:text-primary transition-colors duration-fast ease-soft inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" strokeWidth={1.6} />
              <span>{t("nav.home")}</span>
            </Link>
            <span className="text-text-muted dark:text-white/20">/</span>
            <Link href="/catalog" className="hover:text-primary transition-colors duration-fast ease-soft">
              {t("nav.catalog")}
            </Link>
            {motherWork && (
              <>
                <span className="text-text-muted dark:text-white/20">/</span>
                <Link
                  href={`/catalog/${motherWork.id}`}
                  className="hover:text-primary transition-colors duration-fast ease-soft truncate max-w-[200px]"
                  title={title(motherWork, locale, titleOrder)}
                >
                  {title(motherWork, locale, titleOrder)}
                </Link>
              </>
            )}
            {motherRelease && (
              <>
                <span className="text-text-muted dark:text-white/20">/</span>
                <Link
                  href={`/catalog/${motherRelease.id}`}
                  className="hover:text-primary transition-colors duration-fast ease-soft truncate max-w-[200px]"
                  title={title(motherRelease, locale, titleOrder)}
                >
                  {title(motherRelease, locale, titleOrder)}
                </Link>
              </>
            )}
            <span className="text-text-muted dark:text-white/20">/</span>
            <span className="text-text-strong font-semibold truncate max-w-[280px]">
              {localizedTitle}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyUuid}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-line bg-surfaceSubtle hover:border-primary/50 text-text-faint hover:text-gray-900 dark:hover:text-white transition-all text-xs font-mono cursor-pointer"
              title={entity.id}
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedId ? t("entity.detail.idCopied") : t("entity.detail.copyId")}</span>
            </button>
            {copyFailed === "id" && (
              <span className="text-[11px] font-mono text-amber-600 dark:text-warn">{t("common.copyFailed")}</span>
            )}

            <span className="px-2.5 py-1 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-line text-text-body text-xs uppercase font-semibold font-mono">
              {entity.status}
            </span>
          </div>
        </div>

        }
      >
        {/* 页面级标题区：跨两栏放在封面列之上，左边界落在外壳内容基线上
            （与 /works、/releases、/mediums 等同一条左边线）；两栏结构保留在标题之下。 */}
        <header className="space-y-4 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-xs font-mono font-bold tracking-wider">
              {kindLabel(entity.kind)}
            </span>

            {/* 头部徽章：主日期与载体格式的字段码由模板声明，不写死 edition_date/format */}
            {headerBadges.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-line text-text-body font-mono text-xs"
              >
                {b.icon}
                <span>{b.text}</span>
              </span>
            ))}
          </div>

          {/* Title & Original Title */}
          <div>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-text-strong leading-tight">
              {localizedTitle}
            </h1>
            {showOriginal && (
              <p className="font-mono text-sm sm:text-base text-text-muted mt-1">
                {entity.title}
              </p>
            )}
          </div>

          {/* Aliases：按语种分组的别名/译名，主语言行带"原始语言"标记 */}
          <LocalizedTitleGroups
            translations={entity.translations}
            originalLanguage={entity.original_language}
            displayTitle={localizedTitle}
            extraKnown={[entity.title]}
            className="space-y-1"
            itemClassName="text-xs text-text-muted"
          />

          {/* Action Toolbar */}
          <div className="pt-3 border-t border-line-subtle flex flex-wrap items-center justify-between gap-3">
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-line bg-surface text-xs font-medium text-text-body hover:border-primary/50 hover:text-primary transition-all shadow-2xs"
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>{t("entity.detail.compareAdd")}</span>
              </Link>

              {hasResourceStation() && (
                <a
                  href={getStorageEntityUrl(entity.id || id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-500/25 bg-sky-500/10 text-xs font-medium text-sky-600 dark:text-info hover:bg-sky-500/20 hover:border-sky-500/40 transition-all shadow-2xs cursor-pointer"
                  title={t("entity.page.openResourceDownload")}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>{t("entity.page.resourceStation")}</span>
                  <ArrowUpRight className="w-3 h-3 opacity-70" />
                </a>
              )}

              <button
                type="button"
                onClick={copyShareLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-surface text-xs font-medium text-text-faint hover:text-gray-900 dark:hover:text-white transition-all shadow-2xs cursor-pointer"
                title={copiedLink ? t("entity.page.linkCopied") : t("entity.page.share")}
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedLink ? t("entity.page.linkCopied") : t("entity.page.share")}</span>
              </button>
              {copyFailed === "link" && (
                <span className="text-[11px] font-mono text-amber-600 dark:text-warn">{t("common.copyFailed")}</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <FavoriteButton targetType={entity.kind as FavoriteTargetType} targetId={entity.id || id} />
            </div>
          </div>
        </header>

        {/* Master 2-Column Wiki Layout (Inspired by 2cd76d44) */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8 items-start">
          {/* ============================================================ */}
          {/* LEFT SIDEBAR: Cover + Facts + External Authority             */}
          {/* ============================================================ */}
          <aside className="w-full space-y-4 shrink-0">
            {/* 1. Cover Card */}
            <Card padding="none" className="overflow-hidden shadow-md">
              {/* 详情页是单张展示：比例在允许区间内跟着图片走（见 AdaptiveCover），
                  这里给上下限兜底——窄屏侧栏也不至于把长图压成一条、或让大图撑满整屏。 */}
              <AdaptiveCover
                src={resolvedCover.src}
                alt={localizedTitle}
                title={localizedTitle}
                originalTitle={entity.title}
                id={entity.id}
                aspect={resolvedCover.aspect}
                tags={Array.isArray(entity.attributes?.tags) ? (entity.attributes.tags as string[]) : undefined}
                minHeight={160}
                maxHeight="60vh"
                className="w-full h-auto"
              />
            </Card>

            {/* 2. External Authority & Official Links (官网与各权威数据源同级一体化呈现) */}
            <ExternalAuthorityLinks
              entity={entity}
              category={entity.kind}
              variant="list"
            />

            {/* 3. Basic Facts & Information Card */}
            <Card padding="section" className="shadow-soft space-y-4">
              <CardTitle icon={<Sliders className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                {t("entity.page.basicInfo")}
              </CardTitle>

              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="text-text-muted font-mono text-[11px] mb-0.5">
                    {t("entity.page.entityKind")}
                  </dt>
                  <dd className="font-medium text-text-strong flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <span>{kindLabel(entity.kind)}</span>
                  </dd>
                </div>

                {officialInfo && (
                  <div>
                    <dt className="text-text-muted font-mono text-[11px] mb-0.5">
                      {t("entity.page.officialLink")}
                    </dt>
                    <dd className="font-mono text-emerald-600 dark:text-success truncate">
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
              </dl>

              {/* 其余属性按实体自身模板分区渲染，与 /works/[id] 共用同一实现。
                  字段、分区、次序、类型均来自服务端声明，新增媒体类型无需改本文件。 */}
              <WorkFacts entity={entity} defs={defs} locale={locale} />

              {/* 标签是独立的自由检索词；业务类型只决定字段方案，不再在界面上展示。 */}
              {Array.isArray(entity.attributes?.tags) && entity.attributes.tags.length > 0 && (
                <div className="pt-3 border-t border-line-subtle space-y-2">
                  {Array.isArray(entity.attributes?.tags) && entity.attributes.tags.length > 0 && <>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-text-muted">
                    <TagIcon className="w-3 h-3" />
                    <span>{t("work.detail.tagsHeading")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Array.isArray(entity.attributes?.tags) ? entity.attributes.tags : []).map((tag: any, idx: number) => {
                      const tagName = typeof tag === "string" ? tag : tag?.name || String(tag);
                      return (
                        <Link
                          key={idx}
                          href={`/explore?tags=${encodeURIComponent(tagName)}`}
                          className="px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] hover:bg-primary/10 hover:text-primary text-text-body text-[11px] transition-colors duration-fast ease-soft"
                        >
                          {tagName}
                        </Link>
                      );
                    })}
                  </div>
                  </>}
                </div>
              )}
            </Card>

            {/* 4. Decoupled Resource Station Quick Jump（资源站未接入时不显示） */}
            {hasResourceStation() && (
              <Card padding="card" className="!border-sky-500/20 !bg-sky-500/[0.04] dark:!bg-sky-500/[0.08] space-y-2.5">
                <div className="flex items-center gap-2 text-sky-600 dark:text-info font-semibold text-xs font-mono">
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
                  className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 dark:text-info hover:underline cursor-pointer"
                >
                  <span>{t("entity.page.openResourceStation")}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
              </Card>
            )}
          </aside>

          {/* ============================================================ */}
          {/* RIGHT COLUMN: Main Content Flow (Wiki Standard)              */}
          {/* ============================================================ */}
          <div className="min-w-0 flex-1 space-y-4">
            {/* 分节标签栏：每节独立面板，不再整页滚动找内容（页头已提到两栏之上）。 */}
            <TabBar
              ariaLabel={t("entity.page.sections")}
              active={active}
              onSelect={select}
              items={tabs}
            />

            {/* ============================================================ */}
            {/* Section 1: Overview & Summary                                */}
            {/* ============================================================ */}
            {/* 页签面板：重挂载 + 重放进入动画由 TabPanel 负责；页签条在本卡片内，
                间距已由卡片内边距给出，故不再额外加顶距。 */}
            <TabPanel
              activeKey={active}
              role="tabpanel"
              id={`panel-${active}`}
              labelledBy={`tab-${active}`}
              spacing="none"
              className="space-y-4"
            >
            {active === "overview" && (
            <Card id="overview" padding="section" className="space-y-4 shadow-soft">
              <SectionTitle icon={<BookOpen className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                {t("entity.page.overviewTitle")}
              </SectionTitle>

              {summaryText ? (
                <div className="text-sm text-text-strong leading-relaxed whitespace-pre-line">
                  {summaryText}
                </div>
              ) : (
                <div className="text-xs text-text-muted italic">
                  {t("entity.page.noSummary")}
                </div>
              )}

              {/* 图片（按时间）：同一实体的多张图按 taken_at 升序，未注明时间的保持录入顺序排在最后。
                  封面改版、剧照、活动现场都靠这里的顺序表达，不再只展示第一张。 */}
              {(entity.pictures?.length || 0) > 0 && (
                <div id="pictures" className="pt-2 space-y-3 border-t border-line-subtle">
                  <div className="flex items-center gap-2 pt-3">
                    <h3 className="font-display text-sm font-bold text-text-strong uppercase tracking-wider font-mono">
                      {t("catalog.pictureGallery")}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                      {entity.pictures!.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {entity
                      .pictures!.map((p, i) => ({ p, i }))
                      .sort((a, b) => {
                        const av = (a.p.taken_at || "").trim();
                        const bv = (b.p.taken_at || "").trim();
                        if (!av && !bv) return a.i - b.i;
                        if (!av) return 1;
                        if (!bv) return -1;
                        return av < bv ? -1 : av > bv ? 1 : a.i - b.i;
                      })
                      .map(({ p, i }) => (
                        <a
                          key={i}
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group block space-y-1.5"
                          title={p.source?.citation || ""}
                        >
                          {/* 画廊用同一套封面组件：自托管封面取不到（如 404 object_missing）时
                              退化成程序封面，而不是让浏览器画破图图标——作品页早就这么兜底，
                              两个页面对同一份数据给出两种观感是这里此前唯一的不一致。 */}
                          <Card tone="subtle" padding="none" className="aspect-[3/4] overflow-hidden">
                            <EntityCover
                              src={p.url}
                              alt={resolveLocalizedName(p.caption, locale, entity.title)}
                              title={resolveLocalizedName(p.caption, locale, entity.title)}
                              id={entity.id}
                              className="w-full h-full"
                              imgClassName="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-fast ease-soft"
                            />
                          </Card>
                          <div className="font-mono text-[10px] text-text-faint">
                            {p.taken_at?.trim() || t("catalog.imageTimeUnknown")}
                          </div>
                        </a>
                      ))}
                  </div>
                </div>
              )}
              {/* Mother Work Direct Card */}
              {motherWork && (
                <Card tone="subtle" padding="none" className="hover:border-primary/50 transition-all mt-2">
                  <Link
                    href={`/catalog/${motherWork.id}`}
                    className="group flex items-center gap-3.5 p-3 w-full"
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden dark:bg-white/5 shrink-0 border border-line">
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
                      <div className="font-display text-sm font-bold text-text-strong group-hover:text-primary truncate">
                        {title(motherWork, locale, titleOrder)}
                      </div>
                      {isDistinctOriginalTitle(motherWork.title, title(motherWork, locale, titleOrder)) && (
                        <div className="font-mono text-xs text-text-muted truncate">
                          {motherWork.title}
                        </div>
                      )}
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors duration-fast ease-soft shrink-0" />
                  </Link>
                </Card>
              )}

              {/* Store Bonuses Highlight */}
              {storeBonuses.length > 0 && (
                <Card padding="card" className="!border-amber-500/30 !bg-amber-500/[0.05] dark:!bg-amber-500/[0.08] space-y-2">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-600 dark:text-warn">
                    <Sparkles className="w-4 h-4" />
                    <span>{t("entity.detail.storeBonuses")}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {storeBonuses.map((bonus: any, idx: number) => (
                      <div key={idx} className="flex flex-wrap items-baseline gap-2 text-text-strong">
                        <span className="font-semibold text-amber-700 dark:text-warn-soft font-mono">
                          {bonus.label?.["ja-JP"] || bonus.label?.["zh-CN"] || bonus.label?.["en-US"] || JSON.stringify(bonus.label || "")}
                        </span>
                        {bonus.condition && (
                          <span className="text-[11px] text-text-muted">
                            ({bonus.condition})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </Card>
            )}

            {/* ============================================================ */}
            {/* Section 2: Staff & Credits (演职人员与创作者)                 */}
            {/* ============================================================ */}
            {active === "staff" && staffRelations.length > 0 && (
              <Card id="staff" padding="section" className="space-y-4 shadow-soft">
                <SectionTitle icon={<Users className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                  {t("entity.page.staffTitle")}
                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {staffRelations.length}
                  </span>
                </SectionTitle>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {staffRelations.map((r) => {
                    const target = r.target;
                    const targetTitle = endTitleOf(target, r.otherId, locale, titleOrder);
                    return (
                      <Card key={r.id} tone="subtle" padding="none" className="hover:border-primary/50 transition-all group">
                      <Link
                        href={`/catalog/${r.otherId}`}
                        className="p-3 flex items-center gap-3"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary grid place-items-center font-bold text-xs shrink-0 overflow-hidden border border-primary/20">
                          <StaffAvatar src={target?.pictures?.[0]?.url} name={targetTitle} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="text-[10px] font-mono font-semibold text-primary tracking-wider">
                            {getRelationName(defs, r.type, r.isOutgoing, locale)}
                          </div>
                          <div className="font-semibold text-xs sm:text-sm text-text-strong group-hover:text-primary truncate">
                            {targetTitle}
                          </div>
                          {target && isDistinctOriginalTitle(target.title, targetTitle) && (
                            <div className="text-[10px] text-text-muted font-mono truncate">
                              {target.title}
                            </div>
                          )}
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-text-muted group-hover:text-primary transition-colors duration-fast ease-soft shrink-0" />
                      </Link>
                      </Card>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* ============================================================ */}
            {/* Section 3: Contents & Tracklist (内容目录与曲目结构)          */}
            {/* ============================================================ */}
            {active === "contents" && children.length > 0 && (
              <Card id="contents" padding="section" className="space-y-4 shadow-soft">
                <SectionTitle icon={<List className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                  {t("entity.page.contentsTitle")}
                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {children.length}
                  </span>
                </SectionTitle>

                {/* Mediums & Tracks (for Releases) */}
                {mediums.length > 0 ? (
                  <div className="space-y-4">
                    {mediums.map((m) => {
                      const mTracks = (m.id ? tracksByMedium[m.id] : []) || [];
                      return (
                        <Card key={m.id} padding="none" className="overflow-hidden">
                          <div className="px-4 py-3 bg-black/[0.03] dark:bg-white/[0.04] border-b border-line flex items-center justify-between">
                            <div className="flex items-center gap-2 font-mono text-xs font-bold text-text-strong">
                              <Disc className="w-4 h-4 text-primary" />
                              <span>{title(m, locale, titleOrder)}</span>
                              {m.attributes?.format && (
                                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase">
                                  {m.attributes.format}
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-xs text-text-muted">
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
                                <div key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="font-mono text-text-muted w-6 text-right shrink-0">
                                      {t.position || idx + 1}
                                    </span>
                                    <Link
                                      href={`/catalog/${t.id}`}
                                      className="font-medium text-text-strong hover:text-primary truncate"
                                    >
                                      {title(t, locale, titleOrder)}
                                    </Link>
                                  </div>
                                  {durStr && (
                                    <span className="font-mono text-text-muted shrink-0">
                                      {durStr}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  /* Content Units & Expressions (for Works) */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {children.map((c) => (
                      <Card key={c.id} tone="subtle" padding="none" className="hover:border-primary/50 transition-all group">
                      <Link
                        href={`/catalog/${c.id}`}
                        className="p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-mono uppercase font-semibold shrink-0">
                            {kindLabel(c.kind)}
                          </span>
                          <span className="font-medium text-xs sm:text-sm text-text-strong group-hover:text-primary truncate">
                            {title(c, locale, titleOrder)}
                          </span>
                        </div>
                        <ArrowUpRight className="w-3.5 h-3.5 text-text-muted group-hover:text-primary transition-colors duration-fast ease-soft shrink-0" />
                      </Link>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* ============================================================ */}
            {/* Section 4: Releases & Occurrences (发行版本与收录情况)        */}
            {/* ============================================================ */}
            {active === "releases" && occurrences.length > 0 && (
              <Card id="releases" padding="section" className="space-y-4 shadow-soft">
                <SectionTitle icon={<Disc className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                  {t("entity.page.releasesTitle")}
                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {occurrences.length}
                  </span>
                </SectionTitle>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-line text-text-muted">
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
                          <tr key={rel.id || idx} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                            <td className="py-2.5 pr-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/catalog/${rel.id}`}
                                  className="font-semibold text-text-strong hover:text-primary inline-flex items-center gap-1.5"
                                >
                                  {title(rel, locale, titleOrder)}
                                  <ArrowUpRight className="w-3.5 h-3.5 text-text-muted" />
                                </Link>
                                {isBoxset && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[10px] font-semibold">
                                    {getTermName(defs, "edition_type", "boxset", locale)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 uppercase text-text-body">
                              {rel.attributes?.format
                                ? getTermName(defs, "format", String(rel.attributes.format), locale) !== String(rel.attributes.format)
                                  ? getTermName(defs, "format", String(rel.attributes.format), locale)
                                  : String(rel.attributes.format)
                                : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-primary font-semibold">
                              {rel.attributes?.catalog_number || "—"}
                            </td>
                            <td className="py-2.5 pl-3 text-right text-text-faint">
                              {rel.attributes?.edition_date || rel.attributes?.release_date || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ============================================================ */}
            {/* Section 5: Relations & Graph (关联作品与图谱)                 */}
            {/* ============================================================ */}
            {active === "relations" && mediaRelations.length > 0 && (
              <Card id="relations" padding="section" className="space-y-4 shadow-soft">
                <SectionTitle
                  icon={<Network className="w-4 h-4 text-primary" strokeWidth={1.5} />}
                  actions={
                    <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] p-0.5 rounded-lg text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setRelationViewMode("cards")}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        relationViewMode === "cards"
                          ? "bg-surface text-text-strong font-semibold shadow-xs"
                          : "text-text-faint hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {t("entity.page.viewCards")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRelationViewMode("graph")}
                      className={`px-2.5 py-1 rounded-md transition-all ${
                        relationViewMode === "graph"
                          ? "bg-surface text-text-strong font-semibold shadow-xs"
                          : "text-text-faint hover:text-gray-900 dark:hover:text-white"
                      }`}
                    >
                      {t("entity.page.viewGraph")}
                    </button>
                    </div>
                  }
                >
                  {t("entity.page.relationsTitle")}
                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                    {mediaRelations.length}
                  </span>
                </SectionTitle>

                {relationViewMode === "graph" ? (
                  <Card tone="subtle" padding="none" className="h-[360px] overflow-hidden">
                    <InteractiveRelationGraph
                      centerEntityId={entity.id || id}
                      centerEntityType={entity.kind}
                      orientation={
                        entity.kind === "release" || entity.kind === "medium" || entity.kind === "track"
                          ? "release"
                          : entity.kind === "agent"
                          ? "agent"
                          : "work"
                      }
                      nodes={graphNodes}
                      links={graphLinks}
                      onNodeClick={(n) => {
                        if (n.id && n.id !== entity.id) {
                          window.location.href = `/catalog/${n.id}`;
                        }
                      }}
                    />
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* 筛选条：维度与选项都由关系数据与 definitions 生成，只有一个取值的维度不出现 */}
                    <RelationFilterBar
                      facets={relationFilter.facets}
                      selection={relationFilter.selection}
                      onToggle={relationFilter.toggle}
                    />
                    {relationFilter.visible.length === 0 && (
                      <p className="text-sm text-text-faint">{t("relations.filterEmpty")}</p>
                    )}
                    {groupedMediaRelations.map((group) => (
                      <div key={group.key || "ungrouped"}>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground m-0 mb-2">
                          {relationGroupTitle(group)}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {group.items.map((r) => {
                      const fromTitle = endTitleOf(r.from, r.fromId, locale, titleOrder);
                      const toTitle = endTitleOf(r.to, r.toId, locale, titleOrder);
                      const target = r.target;
                      return (
                        <Card
                          key={r.id}
                          tone="subtle"
                          padding="none"
                          className="hover:border-primary/50 transition-all group"
                        >
                        <Link
                          href={`/catalog/${r.otherId}`}
                          className="p-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="text-[10px] font-mono font-semibold text-primary tracking-wider">
                              {getRelationName(defs, r.type, r.isOutgoing, locale)}
                            </div>
                            {/* 关系两端都给题名：主体一侧取自响应 entities[subject_id]，
                                对端取自 entities[另一端]，不再出现空标题或原始 UUID。 */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[11px] text-text-faint truncate">{fromTitle}</span>
                              <ArrowRight className="w-3 h-3 text-text-muted shrink-0" strokeWidth={1.6} />
                              <span className="font-semibold text-xs sm:text-sm text-text-strong group-hover:text-primary truncate">
                                {toTitle}
                              </span>
                            </div>
                            {target && isDistinctOriginalTitle(target.title, toTitle) && (
                              <div className="text-[10px] text-text-muted font-mono truncate">
                                {target.title}
                              </div>
                            )}
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-text-muted group-hover:text-primary transition-colors duration-fast ease-soft shrink-0" />
                        </Link>
                        </Card>
                      );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}


            {/* ============================================================ */}
            {/* Section 7: Revisions (修订历史)                             */}
            {/* ============================================================ */}
            {active === "revisions" && (
            <Card id="revisions" padding="section" className="space-y-4 shadow-soft">
              <SectionTitle icon={<History className="w-4 h-4 text-primary" strokeWidth={1.5} />}>
                {t("entity.page.revisionsHistory")}
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                  {revisions.length || 1}
                </span>
              </SectionTitle>

<EntityRevisions revisions={revisions} currentEntity={entity} />
            </Card>
            )}

            {/* ============================================================ */}
            {/* Section 8: Resource files (资源文件与上传)                    */}
            {/* ============================================================ */}
            {active === "resources" && defs?.structure?.[String(entity.kind || "")]?.resources === true && (
              <EntityResourceFiles entityId={entity.id || id} />
            )}
            </TabPanel>

            {/* ============================================================ */}
            {/* Community discussions & collections (below the tabs, not a tab)      */}
            {/* ============================================================ */}
            {communityEnabled && (
            <Card id="community" padding="section" className="space-y-4 shadow-soft mt-8">
              <SectionTitle
                icon={<MessageSquare className="w-4 h-4 text-primary" strokeWidth={1.5} />}
                actions={
                  <a
                    href={getForumEntityUrl(entity.id || id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <span>{t("entity.page.openInForum")}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                }
              >
                {t("entity.page.communityTitle")}
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono text-[11px] font-semibold">
                  {communityPosts.length}
                </span>
              </SectionTitle>

              {/* Quick Comment Composer */}
              <Card tone="subtle" padding="card" className="space-y-3">
              <form onSubmit={handlePostComment} className="space-y-3">
                <div className="flex items-center justify-between text-xs text-text-faint">
                  <span className="font-medium text-text-body font-mono">
                    {t("entity.page.quickReview")}
                  </span>
                  {user ? (
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-success font-semibold">
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
                  className="w-full p-3 rounded-lg bg-surface border border-line text-xs sm:text-sm text-text-strong placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 resize-y"
                />
                {commentError && (
                  <div className="text-xs text-rose-500 font-mono">{commentError}</div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-text-muted">
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
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-all duration-base ease-soft"
                    >
                      <span>{t("entity.page.sendAfterLogin")}</span>
                    </a>
                  )}
                </div>
              </form>
              </Card>

              {/* Embedded Comments Stream */}
              <div className="space-y-3">
                <h3 className="font-display text-xs font-bold text-text-strong uppercase tracking-wider font-mono">
                  {t("entity.page.discussionStream")} ({communityPosts.length})
                </h3>
                {communityPostsFailed ? (
                  <Card padding="none" className="border-dashed">
                    <div className="p-8 text-center space-y-2">
                      <p className="text-xs text-text-faint">{t("community.commentsLoadFailed")}</p>
                    </div>
                  </Card>
                ) : communityPosts.length === 0 ? (
                  <Card padding="none" className="border-dashed">
                    <div className="p-8 text-center space-y-2">
                      <MessageSquare className="w-8 h-8 mx-auto text-text-muted opacity-50" />
                      <p className="text-xs text-text-faint">
                        {t("entity.page.noDiscussions")}
                      </p>
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {communityPosts.map((post: any) => (
                      <Card key={post.id} tone="subtle" padding="card" className="space-y-2 hover:border-black/15 dark:hover:border-white/15 transition-colors duration-fast ease-soft">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/15 text-primary grid place-items-center font-mono text-[11px] font-bold">
                              {(post.author_name || "U")[0].toUpperCase()}
                            </div>
                            <span className="font-semibold text-text-strong font-mono text-xs">
                              {post.author_name || "User"}
                            </span>
                          </div>
                          <span className="text-[11px] text-text-muted font-mono">
                            {post.created_at ? new Date(post.created_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-text-strong leading-relaxed whitespace-pre-line pl-8">
                          {post.body}
                        </p>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* Embedded Collections (合集) */}
              <div className="pt-4 border-t border-line-subtle space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-indigo-500" />
                    <h3 className="font-display text-xs font-bold text-text-strong uppercase tracking-wider font-mono">
                      {t("entity.page.collectionsFeaturing")} ({allDisplayCollections.length})
                    </h3>
                  </div>
                  <a
                    href={`${FORUM_SERVICE_URL}/collections`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 dark:text-alt hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
                  >
                    <span>{t("entity.page.exploreCollections")}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                </div>

                {communityCollectionsFailed && allDisplayCollections.length === 0 ? (
                  <Card padding="none" className="border-dashed">
                    <div className="p-6 text-center text-xs text-text-faint">
                      {t("catalog.listFailed")}
                    </div>
                  </Card>
                ) : allDisplayCollections.length === 0 ? (
                  <Card padding="none" className="border-dashed">
                    <div className="p-6 text-center text-xs text-text-faint">
                      {t("entity.page.noCollections")}
                    </div>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {allDisplayCollections.map((col: any) => (
                      <Card key={col.id} tone="subtle" padding="none" className="hover:border-indigo-500/50 transition-all group">
                      <a
                        href={getForumCollectionUrl(col.id)}
                        className="p-3.5 flex items-start gap-3 cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 grid place-items-center shrink-0">
                          <FolderPlus className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-semibold text-xs sm:text-sm text-text-strong group-hover:text-indigo-600 dark:group-hover:text-alt truncate">
                            {col.title}
                          </div>
                          <div className="text-[11px] text-text-faint font-mono truncate">
                            {t("entity.page.curatorBy")}{col.curator || "Community"}
                          </div>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-text-muted group-hover:text-indigo-500 transition-colors duration-fast ease-soft shrink-0 mt-0.5" />
                      </a>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </Card>
            )}
          </div>
        </div>
      </PageShell>
    </div>
  );
}
