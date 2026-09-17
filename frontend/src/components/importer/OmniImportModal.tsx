"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Sparkles,
  Search,
  Film,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Layers,
  Users,
  Download,
  Loader2,
  GitFork,
  UserCheck,
  Building2,
  User,
  Palette,
  Check,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  previewExternalCatalog,
  importExternalCatalog,
  fetchImporterSources,
  fetchApi,
  pickLocalizedName,
  ImporterPreviewResponse,
  ImporterSource,
  StaffAssociation,
} from "@/lib/api";
import { authorityIcon } from "@/lib/authorityIcons";
import { Entity, fetchAllPages, title } from "@/components/catalog/api";
import { LocalizedTitleGroups } from "@/components/entity/LocalizedTitleGroups";
import { pickRecordTitle } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { getKindName, getTermName, getTypeName, useDefinitions } from "@/lib/definitions";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSource?: string;
  initialURLOrID?: string;
  initialEntityType?: "work" | "artist" | "organization" | "character";
}

// entryDepth：按 parent_index 求 canonical entry 的层级（用于预览缩进），
// 异常环状数据以访问集合兜底，最多展开 8 层避免死循环。
function entryDepth(entries: { parent_index?: number }[], index: number): number {
  let depth = 0;
  let cur = entries[index]?.parent_index;
  const seen = new Set<number>([index]);
  while (typeof cur === "number" && cur >= 0 && cur < entries.length && !seen.has(cur) && depth < 8) {
    seen.add(cur);
    depth += 1;
    cur = entries[cur]?.parent_index;
  }
  return depth;
}

// 标题规范化仅用于"建议"排序：后端不再按标题自动合并身份（同名录音室版/现场版
// 会被误并），这里只把同名的既有表达排到前面供人工确认，不自动选中。
function normalizeTitleKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// suggestExpression：在既有表达中按标题相等优先挑一个候选，供用户一键确认。
function suggestExpression(
  title: string,
  expressions: { id: string; title: string }[],
): { id: string; title: string } | null {
  const key = normalizeTitleKey(title);
  if (!key) return null;
  const exact = expressions.find((ex) => normalizeTitleKey(ex.title) === key);
  return exact || null;
}

// FALLBACK_SOURCES 是 GET /importer/sources 取不到时的内置兜底（网络/网关/权限抖动）。
// 只列 auto 与确实实现了适配器的来源：旧的内置列表（musicbrainz / tmdb / imdb / vndb /
// douban）正是这次要修的谎——后端 normalizeImporterSource 只认 bangumi，选了只会拿
// not_supported，降级路径不该把它们再端出来一次。
const FALLBACK_SOURCES: Array<{ id: string; labelKey: string; label: string; icon: any }> = [
  { id: "bangumi", labelKey: "importer.sourceBangumi", label: "Bangumi", icon: BookOpen },
];

// sourceKeySuffix 把来源 id 转成字典键后缀（bangumi → Bangumi，official_website →
// OfficialWebsite）：动态来源优先复用既有 importer.source* 四语文案，
// 没有对应键的来源再用注册表里的名称（见 lib/authorityIcons 同一套"注册表驱动"思路）。
function sourceKeySuffix(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function OmniImportModal({
  isOpen,
  onClose,
  initialSource = "auto",
  initialURLOrID = "",
  initialEntityType = "work",
}: Props) {
  const { user } = useAuth();
  const { t, tr, locale } = useI18n();
  const { definitions: defs, kinds } = useDefinitions();
  // 篇目用途名以 definitions 的 entry_role 词表为准（后台改词即刻生效），字典只作兜底；
  // 只看字典时 OP / ED / 预告会显示成同一个「附加内容」。
  const entryRoleLabel = (code: string) => {
    const name = getTermName(defs, "entry_role", code, locale);
    return name !== code ? name : tr(`catalog.contents.role.${code}`, code);
  };
  const router = useRouter();
  const titleOrder = useTitleDisplayOrder();

  // 预览条目的层级名与业务类型名都取服务端 definitions；字典只作层级名兜底，
  // 类型名缺定义时退回原始码（显示码总好过空白，但不是首选）。
  const kindLabel = (code: string) =>
    getKindName(kinds, code, locale, tr(`catalog.kind.${code}`, code));
  const typeLabel = (code: string) => getTypeName(defs, code, locale);

  // 实体类型切换 (Work / Artist / Organization / Character)
  const [entityType, setEntityType] = useState<"work" | "artist" | "organization" | "character">(initialEntityType);

  const [source, setSource] = useState<string>(initialSource);
  const [inputVal, setInputVal] = useState<string>(initialURLOrID);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ImporterPreviewResponse | null>(null);
  const [error, setError] = useState<string>("");

  // 演职员与出版机构交互式审查工作台状态
  const [associations, setAssociations] = useState<StaffAssociation[]>([]);
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [artistSearchQuery, setArtistSearchQuery] = useState<string>("");
  const [artistSearchResults, setArtistSearchResults] = useState<Entity[]>([]);
  const [isSearchingArtist, setIsSearchingArtist] = useState<boolean>(false);

  // 智能查重与关联目标母体
  const [duplicateMatches, setDuplicateMatches] = useState<Entity[]>([]);
  const [selectedTargetWork, setSelectedTargetWork] = useState<Entity | null>(null);
  const [linkMode, setLinkMode] = useState<"append_release_to_work" | "create_relation" | "new_work">("new_work");
  // 不预设关系码：关系类型来自服务端 definitions，未选则不提交该字段（避免写死某个码）。
  const [relationType] = useState<string>("");

  // 既有表达匹配：选定目标母体后加载其既有表达（录音/正文），
  // 供用户把预览条目手工绑定到已存在的表达，避免重复建录音。
  const [workExpressions, setWorkExpressions] = useState<{ id: string; title: string }[]>([]);
  const [entryMatches, setEntryMatches] = useState<Record<number, string>>({});

  // 跨作品录音搜索：全库查表达并手工绑定到 canonical 条目；标题相近只展示不自动选中，
  // 人工在下拉中确认后才写入 entryMatches，后端自动补 release_subjects 声明。
  const [crossWorkOpen, setCrossWorkOpen] = useState(false);
  const [crossWorkQuery, setCrossWorkQuery] = useState("");
  const [crossWorkResults, setCrossWorkResults] = useState<Entity[]>([]);
  const [crossWorkSearching, setCrossWorkSearching] = useState(false);
  const [crossWorkError, setCrossWorkError] = useState("");

  const [downloadCover, setDownloadCover] = useState(true);
  const [editNote, setEditNote] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<any>(null);

  // 可用来源清单：serverSources 为 null 表示还没拿到（加载中或已降级）。
  const [serverSources, setServerSources] = useState<ImporterSource[] | null>(null);
  const [sourcesDegraded, setSourcesDegraded] = useState(false);

  // 打开弹窗时取一次服务端清单：来源 tab 不再由前端写死，只有后端真有适配器的来源才会出现。
  // 失败不弹错误、不清空界面，退回 FALLBACK_SOURCES 并给一句静态提示；重新打开会再试一次。
  useEffect(() => {
    if (!isOpen || serverSources !== null) return;
    let active = true;
    fetchImporterSources()
      .then((res) => {
        if (active) setServerSources(res?.items || []);
      })
      .catch(() => {
        if (active) setSourcesDegraded(true);
      });
    return () => {
      active = false;
    };
  }, [isOpen, serverSources]);

  // 目标母体变化时拉取其既有表达；无目标母体（新建作品）时清空，不做匹配。
  useEffect(() => {
    const workId = selectedTargetWork?.id;
    if (!workId) {
      setWorkExpressions([]);
      return;
    }
    let active = true;
    // 用 fetchAllPages 翻页取全：列表端点的 limit 上限为 100，写死 limit=200 会被
    // 收敛为 50，导致候选下拉只显示前 50 条。
    fetchAllPages<{ id: string; title: string }>(
      `/catalog/entities?kind=expression&work_id=${encodeURIComponent(workId)}`,
    )
      .then((items) => {
        if (active) setWorkExpressions(items);
      })
      .catch(() => {
        if (active) setWorkExpressions([]);
      });
    return () => {
      active = false;
    };
  }, [selectedTargetWork?.id]);

  // 新预览产生时重置手工匹配选择，避免上一次的绑定串到新条目上。
  // 跨作品搜索结果保留（与预览无关），仅重置绑定。
  useEffect(() => {
    setEntryMatches({});
  }, [previewData]);

  // 跨作品录音搜索防抖：输入稳定约 300ms 后查全库表达，timer 卸载/更新时清理。
  useEffect(() => {
    const q = crossWorkQuery.trim();
    if (!q) {
      setCrossWorkResults([]);
      setCrossWorkError("");
      setCrossWorkSearching(false);
      return;
    }
    setCrossWorkSearching(true);
    let active = true;
    const timer = setTimeout(() => {
      fetchApi<{ items: Entity[] }>(`/catalog/entities?kind=expression&q=${encodeURIComponent(q)}&limit=20`)
        .then((res) => {
          if (active) {
            setCrossWorkResults(res?.items || []);
            setCrossWorkError("");
          }
        })
        .catch(() => {
          if (active) {
            setCrossWorkResults([]);
            setCrossWorkError(t("importer.crossWork.searchFailed"));
          }
        })
        .finally(() => {
          if (active) setCrossWorkSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [crossWorkQuery, t]);

  if (!isOpen) return null;

  const handleParse = async (targetVal?: string, targetSource?: string, targetType?: string) => {
    const queryVal = (targetVal !== undefined ? targetVal : inputVal).trim();
    const querySource = targetSource || source;
    const queryType = targetType || entityType;

    if (!queryVal) {
      setError(t("importer.errorEmptyInput"));
      return;
    }

    setError("");
    setPreviewData(null);
    setImportSuccess(null);
    setDuplicateMatches([]);
    setSelectedTargetWork(null);
    setLinkMode("new_work");
    setAssociations([]);
    setLoadingPreview(true);

    try {
      const res = await previewExternalCatalog({
        source: querySource,
        url_or_id: queryVal,
        entity_type: queryType,
      });
      setPreviewData(res);
      if (res.source) {
        setSource(res.source);
      }
      if (res.entity_type && (res.entity_type === "artist" || res.entity_type === "organization" || res.entity_type === "character" || res.entity_type === "work")) {
        setEntityType(res.entity_type as any);
      }

      // 初始化演职员交互式关联审查工作台列表
      if (res.artists && res.artists.length > 0) {
        const initialAssocs: StaffAssociation[] = res.artists.map((a) => {
          const hasMatched = !!(a.id && a.id !== "");
          return {
            parsed_name: a.name,
            parsed_original: a.original_name,
            parsed_role: a.role || "Creator",
            entity_type: a.entity_type || "person",
            action: hasMatched ? "link" : "create",
            target_artist_id: a.id,
            custom_role: a.role || "Creator",
            character_name: a.character_name || "",
            country: a.country,
            biography: a.biography,
            language: a.language,
            avatar_url: a.avatar_url,
            external_ids: a.external_ids,
            translations: a.translations,
            relation_type: a.relation_type,
            relation_role: a.relation_role,
          };
        });
        setAssociations(initialAssocs);
      }

      // 智能全库查重推荐（仅对作品生效）
      if (queryType === "work" && res.work) {
        const searchTitle = res.work?.title || res.work?.original_title;
        if (searchTitle && searchTitle.trim()) {
          fetchAllPages<Entity>(`/catalog/entities?kind=work&q=${encodeURIComponent(searchTitle.trim())}&limit=5`)
            .then((items) => {
              if (items && items.length > 0) {
                setDuplicateMatches(items);
                setSelectedTargetWork(items[0]);
                setLinkMode("append_release_to_work");
              }
            })
            .catch(() => {});
        }
      }
    } catch (err: any) {
      setError(err?.message || t("importer.errorParseFailed"));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSearchArtistInDB = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setIsSearchingArtist(true);
    try {
      // 主体搜索走统一实体端点：/catalog/entities?kind=agent。
      const res = await fetchApi<{ items: Entity[] }>(`/catalog/entities?kind=agent&q=${encodeURIComponent(q)}&limit=8`);
      setArtistSearchResults(res?.items || []);
    } catch {
      setArtistSearchResults([]);
    } finally {
      setIsSearchingArtist(false);
    }
  };

  const updateAssociation = (index: number, patch: Partial<StaffAssociation>) => {
    setAssociations((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleBatchSetAction = (action: "create" | "link" | "skip") => {
    setAssociations((prev) =>
      prev.map((a) => ({
        ...a,
        action,
      }))
    );
  };

  const handleResetAssociations = () => {
    if (!previewData?.artists) return;
    const initialAssocs: StaffAssociation[] = previewData.artists.map((a) => {
      const hasMatched = !!(a.id && a.id !== "");
      return {
        parsed_name: a.name,
        parsed_original: a.original_name,
        parsed_role: a.role || "Creator",
        entity_type: a.entity_type || "person",
        action: hasMatched ? "link" : "create",
        target_artist_id: a.id,
        custom_role: a.role || "Creator",
        character_name: a.character_name || "",
        country: a.country,
        biography: a.biography,
        language: a.language,
        avatar_url: a.avatar_url,
        external_ids: a.external_ids,
        translations: a.translations,
        relation_type: a.relation_type,
        relation_role: a.relation_role,
      };
    });
    setAssociations(initialAssocs);
  };

  const handleConfirmImport = async () => {
    if (!previewData) return;
    if (!user) {
      setError(t("importer.errorMustLogin"));
      return;
    }

    setImporting(true);
    setError("");

    try {
      const isEntity = entityType !== "work" || (previewData.artist && !previewData.work);

      if (isEntity) {
        // 单一主体导入 (Artist / Org / Char)
        const res = await importExternalCatalog({
          entity_type: entityType,
          source: previewData.source,
          url_or_id: previewData.external_url || inputVal,
          artist: previewData.artist,
          download_cover: downloadCover,
          edit_note: editNote.trim() || t("importer.defaultEditNote", { source: previewData.source.toUpperCase() }),
          source_urls: [previewData.external_url || inputVal],
        });

        setImportSuccess(res);
        setTimeout(() => {
          if (res.artist_id) {
            router.push(`/catalog/${res.artist_id}`);
            onClose();
          }
        }, 1200);
      } else {
        // 作品与演职员关联审查导入
        // 把手工匹配结果并入提交载荷：canonical entries 按下标绑定既有表达。
        const canonicalEntries = (previewData.canonical_entries || []).map((entry, index) =>
          entryMatches[index]
            ? { ...entry, expression_id: entryMatches[index] }
            : entry,
        );
        const res = await importExternalCatalog({
          entity_type: "work",
          source: previewData.source,
          url_or_id: previewData.external_url || inputVal,
          work: previewData.work,
          staff_associations: associations,
          has_release: previewData.has_release,
          canonical_entries: canonicalEntries,
          release: previewData.has_release === false ? null : previewData.release,
          mediums: previewData.has_release === false ? [] : previewData.mediums,
          download_cover: downloadCover,
          edit_note: editNote.trim() || t("importer.defaultEditNote", { source: previewData.source.toUpperCase() }),
          source_urls: [previewData.external_url || inputVal],
          target_work_id: selectedTargetWork?.id,
          link_mode: selectedTargetWork ? linkMode : "new_work",
          relation_type: linkMode === "create_relation" && relationType ? relationType : undefined,
        });

        setImportSuccess(res);
        setTimeout(() => {
          if (res.work_id) {
            router.push(`/works/${res.work_id}`);
            onClose();
          }
        }, 1200);
      }
    } catch (err: any) {
      setError(err?.message || t("importer.errorImportFailed"));
    } finally {
      setImporting(false);
    }
  };

  // 来源 tab = 显式保留的 auto + 服务端清单里适配当前实体类型的来源。
  // auto 交给后端按 URL/ID 判定（normalizeImporterSource 归一为默认适配器），
  // 其余来源的可用性由后端代码决定，前端不再自己维护一份"看起来能导入"的名字列表。
  const getSourceTabs = (): Array<{ id: string; label: string; icon: any }> => {
    // 注册表的 category 用骨架 kind：弹窗里的 artist / organization / character 都属 agent。
    const category = entityType === "work" ? "work" : "agent";
    let items: Array<{ id: string; label: string; icon: any }> = [];
    if (serverSources) {
      items = serverSources
        // auto 由下面显式补上：后端清单里不会出现它（它是解析别名，不是来源）。
        .filter((s) => s.id !== "auto" && (s.category === "all" || s.category === category))
        .map((s) => ({
          id: s.id,
          label: tr(`importer.source${sourceKeySuffix(s.id)}`, pickLocalizedName(locale, s.names, s.id)),
          icon: authorityIcon(s.icon),
        }));
    } else if (sourcesDegraded) {
      // 端点不可用：回退内置兜底，并按当前类型过滤（兜底项都是 all，实际全通过）。
      items = FALLBACK_SOURCES.map((s) => ({
        id: s.id,
        label: tr(s.labelKey, s.label),
        icon: s.icon,
      }));
    }
    return [{ id: "auto", label: t("importer.sourceAuto"), icon: Sparkles }, ...items];
  };

  const getPlaceholder = () => {
    switch (source) {
      case "musicbrainz":
        return t("importer.placeholderMusicbrainz");
      case "tmdb":
        return t("importer.placeholderTmdb");
      case "imdb":
        return t("importer.placeholderImdb");
      case "bangumi":
        return t("importer.placeholderBangumi");
      case "vndb":
        return t("importer.placeholderVndb");
      case "douban":
        return t("importer.placeholderDouban");
      default:
        return t("importer.placeholderDefault");
    }
  };

  // 过滤后的关联列表
  const filteredAssociations = associations.filter((a) => {
    if (!staffFilter.trim()) return true;
    const q = staffFilter.toLowerCase().trim();
    return (
      a.parsed_name.toLowerCase().includes(q) ||
      (a.parsed_original && a.parsed_original.toLowerCase().includes(q)) ||
      a.parsed_role.toLowerCase().includes(q) ||
      (a.custom_role && a.custom_role.toLowerCase().includes(q)) ||
      (a.character_name && a.character_name.toLowerCase().includes(q))
    );
  });

  const countCreate = associations.filter((a) => a.action === "create").length;
  const countLink = associations.filter((a) => a.action === "link").length;
  const countSkip = associations.filter((a) => a.action === "skip").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className="relative w-full max-w-4xl rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-surfaceSubtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 grid place-items-center text-primary shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg text-text-strong">
                {t("importer.modalTitle")}
              </h2>
              <p className="text-xs font-mono text-text-muted mt-0.5">
                {t("importer.modalSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 grid place-items-center transition-colors duration-fast ease-soft"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
          {/* Top Entity Type Switcher (实体导入类型切换) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-body font-mono flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span>{t("importer.entityTypeLabel")}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: "work", label: t("importer.typeWork"), icon: Film, desc: t("importer.typeWorkDesc") },
                { id: "artist", label: t("importer.typeArtist"), icon: User, desc: t("importer.typeArtistDesc") },
                { id: "organization", label: t("importer.typeOrganization"), icon: Building2, desc: t("importer.typeOrganizationDesc") },
                { id: "character", label: t("importer.typeCharacter"), icon: Palette, desc: t("importer.typeCharacterDesc") },
              ].map((item) => {
                const Icon = item.icon;
                const active = entityType === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setEntityType(item.id as any);
                      setPreviewData(null);
                      setError("");
                      setAssociations([]);
                    }}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                      active
                        ? "bg-primary/10 border-primary text-primary shadow-xs ring-1 ring-primary/30"
                        : "bg-surfaceSubtle border-line text-text-body hover:bg-black/[0.04] hover:bg-surfaceSubtle"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-gray-400"}`} />
                      <span>{item.label}</span>
                    </div>
                    <span className="text-[10px] text-text-muted mt-1 line-clamp-1 font-mono">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Source Tabs：来源清单来自服务端，前端只决定 auto 与类型过滤（见 getSourceTabs） */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl dark:bg-white/[0.04] border border-line-subtle text-xs font-mono">
              {getSourceTabs().map((tab) => {
                const Icon = tab.icon;
                const active = source === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSource(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                      active
                        ? "bg-surface text-primary font-semibold shadow-xs border border-line"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            {sourcesDegraded && (
              // 不打扰的降级：来源清单取不到不等于导入失败，因此不用错误条，
              // 只说清当前用的是内置兜底（能点的一定有适配器）。
              <p className="text-[10px] font-mono text-text-faint px-1">
                {t("importer.sourcesDegraded")}
              </p>
            )}
          </div>

          {/* Input & Action */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loadingPreview) {
                      handleParse();
                    }
                  }}
                  placeholder={getPlaceholder()}
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-line bg-surfaceSubtle text-sm text-text-strong placeholder:text-gray-400 focus:outline-hidden focus:border-primary transition-all font-mono"
                />
                {inputVal && (
                  <button
                    type="button"
                    onClick={() => setInputVal("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleParse()}
                disabled={loadingPreview || !inputVal.trim()}
                className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0 shadow-xs transition-all cursor-pointer"
              >
                {loadingPreview ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("importer.parsing")}</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>{t("importer.btnParse")}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-mono flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {importSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-mono flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold">{t("importer.successTitle")}</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {t("importer.successDesc")}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 预览结果分支 1: 单一主体实体解析结果 (Artist / Org / Char) */}
          {/* ========================================================================= */}
          {previewData && (entityType !== "work" || (previewData.artist && !previewData.work?.title)) && previewData.artist && (
            <div className="space-y-4 animate-fade-in border-t border-line pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-display font-bold text-sm text-text-strong">
                  <UserCheck className="w-4 h-4 text-primary" />
                  <span>{t("importer.entityPreviewTitle")}</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                  {previewData.source.toUpperCase()} · {previewData.artist.entity_type.toUpperCase()}
                </span>
              </div>

              {/* Entity Main Card */}
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line flex flex-col sm:flex-row gap-4">
                {previewData.artist.avatar_url ? (
                  <img
                    src={previewData.artist.avatar_url}
                    alt={previewData.artist.name}
                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border border-line shrink-0"
                  />
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-primary/10 border border-primary/20 grid place-items-center text-primary shrink-0">
                    <User className="w-10 h-10" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg text-text-strong">
                      {previewData.artist.name}
                    </h3>
                    {previewData.artist.original_name && previewData.artist.original_name !== previewData.artist.name && (
                      <p className="text-xs text-gray-500 font-mono mt-0.5">
                        {previewData.artist.original_name}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md dark:bg-white/5 border border-line text-text-body">
                      {t("importer.entityTypeLabel")}: {previewData.artist.entity_type}
                    </span>
                    {previewData.artist.country && (
                      <span className="px-2 py-0.5 rounded-md dark:bg-white/5 border border-line text-text-body">
                        {t("importer.entityCountry")}: {previewData.artist.country}
                      </span>
                    )}
                    {previewData.artist.role && (
                      <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                        {previewData.artist.role}
                      </span>
                    )}
                  </div>

                  {previewData.artist.aliases && previewData.artist.aliases.length > 0 && (
                    <div className="text-xs text-gray-500 font-mono line-clamp-1">
                      <span className="font-semibold">{t("importer.entityAliases")}: </span>
                      {previewData.artist.aliases.join(", ")}
                    </div>
                  )}
                  {!!previewData.artist.translations?.length && (
                    <LocalizedTitleGroups
                      translations={Object.fromEntries((previewData.artist.translations || []).map((i) => [i.locale, i]))}
                      displayTitle={previewData.artist.name}
                      extraKnown={[previewData.artist.name, previewData.artist.original_name]}
                      className="space-y-0.5"
                      itemClassName="text-xs text-gray-500 font-mono line-clamp-1"
                    />
                  )}

                  {previewData.artist.biography && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line line-clamp-3 bg-surfaceSubtle p-2.5 rounded-lg border border-line-subtle font-sans">
                      {previewData.artist.biography}
                    </p>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* 预览结果分支 2: 作品母体、关联审查工作台、发行版规格 (Work) */}
          {/* ========================================================================= */}
          {previewData && entityType === "work" && previewData.work && (
            <div className="space-y-5 animate-fade-in border-t border-line pt-4">
              {/* 1. 智能查重关联已有作品提示 */}
              {duplicateMatches.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs font-mono space-y-2">
                  <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 font-semibold">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      <span>{t("importer.smartMatchDetected")}</span>
                    </div>
                    {selectedTargetWork && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTargetWork(null);
                          setLinkMode("new_work");
                        }}
                        className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
                      >
                        {t("importer.cancelTargetWork")}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {duplicateMatches.map((m) => {
                      const isSelected = selectedTargetWork?.id === m.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => {
                            setSelectedTargetWork(m);
                            setLinkMode("append_release_to_work");
                          }}
                          className={`p-2.5 rounded-lg border flex items-center gap-2.5 cursor-pointer transition-all ${
                            isSelected
                              ? "bg-amber-500/20 border-amber-500/40 ring-1 ring-amber-500/30"
                              : "bg-surface/50 border-amber-500/15 hover:bg-amber-500/10"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-bold truncate text-text-strong">
                              {m.title}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              {String(m.attributes?.country || "")}
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-amber-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Work Master Preview Card */}
              <div className="p-4 rounded-xl bg-surfaceSubtle border border-line flex flex-col sm:flex-row gap-4">
                {previewData.work.cover_image_url ? (
                  <img
                    src={previewData.work.cover_image_url}
                    alt={previewData.work.title}
                    className="w-24 h-32 sm:w-28 sm:h-36 rounded-lg object-cover border border-line shrink-0"
                  />
                ) : (
                  <div className="w-24 h-32 sm:w-28 sm:h-36 rounded-lg dark:bg-white/5 border border-line grid place-items-center text-gray-400 shrink-0">
                    <Film className="w-8 h-8" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg text-text-strong truncate">
                      {previewData.work.title}
                    </h3>
                    {previewData.work.original_title && previewData.work.original_title !== previewData.work.title && (
                      <p className="text-xs text-gray-500 font-mono truncate">
                        {previewData.work.original_title}
                      </p>
                    )}
                    {!!previewData.work.translations?.length && (
                      <LocalizedTitleGroups
                        translations={Object.fromEntries((previewData.work.translations || []).map((i) => [i.locale, i]))}
                        originalLanguage={previewData.work.original_language}
                        displayTitle={previewData.work.title}
                        extraKnown={[previewData.work.title, previewData.work.original_title]}
                        className="space-y-0.5"
                        itemClassName="text-xs text-gray-500 font-mono"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                      {previewData.source.toUpperCase()}
                    </span>
                    {previewData.work.release_date && (
                      <span className="px-2 py-0.5 rounded-md dark:bg-white/5 border border-line text-text-body">
                        {previewData.work.release_date}
                      </span>
                    )}
                    {previewData.work.country && (
                      <span className="px-2 py-0.5 rounded-md dark:bg-white/5 border border-line text-text-body">
                        {previewData.work.country}
                      </span>
                    )}
                  </div>

                  {previewData.work.summary && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 font-sans">
                      {previewData.work.summary}
                    </p>
                  )}
                </div>
              </div>

              {previewData.has_release === false && (
                <p className="p-3 rounded-lg bg-primary/5 text-sm text-text-body">{t("catalog.contents.importWithoutRelease")}</p>
              )}
              {/* 来源抓取不完整（如分集 total 与实取不符）必须显式提示，不能静默当作完整清单落库。 */}
              {!!previewData.warnings?.length && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  {Array.from(new Set(previewData.warnings.map((w) =>
                    w.startsWith("bangumi_episodes_incomplete") ? t("importer.sourceIncompleteEpisodes") : t("importer.sourceIncompleteGeneric"),
                  ))).map((msg) => (
                    <p key={msg}>{msg}</p>
                  ))}
                </div>
              )}
              {!!previewData.canonical_entries?.length && (
                <section className="p-4 rounded-xl border border-line space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{t("catalog.contents.title")}</h3>
                    <span className="text-xs text-gray-500 font-mono">{previewData.canonical_entries.length}</span>
                  </div>
                  <ol className="max-h-72 overflow-y-auto space-y-2 text-sm">
                    {previewData.canonical_entries.map((entry, index) => {
                      const depth = entryDepth(previewData.canonical_entries || [], index);
                      const isUnit = entry.entry_kind === "content_unit";
                      return (
                        <li
                          key={index}
                          className="flex items-baseline gap-2 sm:gap-3"
                          style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
                        >
                          {depth > 0 && <span className="text-gray-400 font-mono text-xs">└</span>}
                          <span className="text-gray-500 font-mono shrink-0">{entry.number || entry.position}</span>
                          <span className={isUnit ? "font-medium" : ""}>
                            {pickRecordTitle(locale, entry.translations, entry.title, { order: titleOrder, originalLanguage: entry.original_language })}
                          </span>
                          {isUnit && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-300 border border-sky-500/20 shrink-0">
                              {t("catalog.contents.unitBadge")}
                            </span>
                          )}
                          {entry.entry_role && (
                            <span className="text-xs text-gray-500">{entryRoleLabel(entry.entry_role)}</span>
                          )}
                          {!isUnit && workExpressions.length > 0 && (() => {
                            const suggestion = suggestExpression(
                              pickRecordTitle(locale, entry.translations, entry.title),
                              workExpressions,
                            );
                            // 仅在用户尚未选择、且存在同名候选时给出建议；点击才写入绑定。
                            const showSuggest = suggestion && !entryMatches[index] && suggestion.id !== entry.expression_id;
                            return (
                              <>
                                {showSuggest && (
                                  <button
                                    type="button"
                                    onClick={() => setEntryMatches((prev) => ({ ...prev, [index]: suggestion.id }))}
                                    title={t("importer.matchSuggestionHint")}
                                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                                  >
                                    <span>{t("importer.matchSuggestion", { title: suggestion.title })}</span>
                                  </button>
                                )}
                                <select
                                  value={entryMatches[index] || ""}
                                  onChange={(e) =>
                                    setEntryMatches((prev) => ({ ...prev, [index]: e.target.value }))
                                  }
                                  aria-label={t("importer.matchExistingExpression")}
                                  className="ml-auto shrink-0 max-w-[46%] px-1.5 py-0.5 rounded border dark:border-white/15 bg-surface text-[11px] text-text-body"
                                >
                                  <option value="">{t("importer.matchNone")}</option>
                                  {workExpressions.map((ex) => (
                                    <option key={ex.id} value={ex.id}>{ex.title}</option>
                                  ))}
                                </select>
                              </>
                            );
                          })()}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
              {!!previewData.canonical_entries?.length && (() => {
                const bindable = (previewData.canonical_entries || [])
                  .map((entry, index) => ({ entry, index }))
                  .filter(({ entry }) => entry.entry_kind !== "content_unit");
                if (bindable.length === 0) return null;
                // 已绑标题只从当前目标母体表达或本次搜索结果解析，不另起请求。
                const resolveBoundTitle = (exprId: string): string => {
                  const local = workExpressions.find((ex) => ex.id === exprId);
                  if (local?.title) return local.title;
                  const hit = crossWorkResults.find((r) => r.id === exprId);
                  if (hit) return title(hit, locale);
                  return exprId;
                };
                const boundRows = Object.entries(entryMatches)
                  .map(([k, v]) => ({ index: Number(k), exprId: v }))
                  .filter(
                    ({ index, exprId }) =>
                      Number.isInteger(index) && !!exprId && bindable.some((b) => b.index === index),
                  );
                return (
                  <section className="p-4 rounded-xl border border-line space-y-3">
                    <button
                      type="button"
                      onClick={() => setCrossWorkOpen((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span className="font-semibold text-text-strong truncate">{t("importer.crossWork.title")}</span>
                        <span className="text-xs text-gray-500 font-mono shrink-0">{crossWorkResults.length}</span>
                      </span>
                      <span className="text-xs text-gray-400 font-mono shrink-0">{crossWorkOpen ? "−" : "+"}</span>
                    </button>
                    {crossWorkOpen && (
                      <div className="space-y-2">
                        <p className="text-xs text-text-muted font-mono">
                          {t("importer.crossWork.subtitle")}
                        </p>
                        <input
                          type="text"
                          value={crossWorkQuery}
                          onChange={(e) => setCrossWorkQuery(e.target.value)}
                          placeholder={t("importer.crossWork.searchPlaceholder")}
                          className="w-full px-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-text-strong placeholder:text-gray-400 focus:outline-hidden focus:border-primary font-mono"
                        />
                        {crossWorkSearching && (
                          <p className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{t("importer.crossWork.searching")}</span>
                          </p>
                        )}
                        {crossWorkError && (
                          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-mono flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div className="flex-1">{crossWorkError}</div>
                          </div>
                        )}
                        {!crossWorkSearching && !crossWorkError && crossWorkQuery.trim() && crossWorkResults.length === 0 && (
                          <p className="text-[11px] text-gray-400 font-mono">
                            {t("importer.crossWork.noResults")}
                          </p>
                        )}
                        {!crossWorkSearching && !crossWorkError && crossWorkResults.length > 0 && (
                          <ul className="max-h-64 overflow-y-auto space-y-2 text-sm">
                            {crossWorkResults.map((item) => {
                              const itemId = item.id || "";
                              return (
                                <li
                                  key={itemId || title(item, locale)}
                                  className="flex items-center gap-2 p-2 rounded-lg border border-line-subtle"
                                >
                                  <span className="flex-1 min-w-0 truncate text-text-strong">
                                    {title(item, locale)}
                                  </span>
                                  <select
                                    value=""
                                    disabled={!itemId}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === "" || !itemId) return;
                                      setEntryMatches((prev) => ({ ...prev, [Number(v)]: itemId }));
                                    }}
                                    aria-label={t("importer.crossWork.bindLabel")}
                                    className="shrink-0 max-w-[52%] px-1.5 py-0.5 rounded border dark:border-white/15 bg-surface text-[11px] text-text-body"
                                  >
                                    <option value="">{t("importer.crossWork.bindPlaceholder")}</option>
                                    {bindable.map(({ entry, index }) => {
                                      const label = `${entry.number || entry.position} · ${pickRecordTitle(locale, entry.translations, entry.title, { order: titleOrder, originalLanguage: entry.original_language })}`;
                                      const boundId = entryMatches[index];
                                      return (
                                        <option key={index} value={String(index)}>
                                          {boundId ? `${label} → ${resolveBoundTitle(boundId)}` : label}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {boundRows.length > 0 && (
                          <ul className="space-y-1 text-xs text-text-muted font-mono">
                            {boundRows.map(({ index, exprId }) => {
                              const target = bindable.find((b) => b.index === index);
                              if (!target) return null;
                              return (
                                <li key={index}>
                                  {t("importer.crossWork.boundEntry", {
                                    number: String(target.entry.number || target.entry.position),
                                    title: pickRecordTitle(locale, target.entry.translations, target.entry.title, { order: titleOrder, originalLanguage: target.entry.original_language }),
                                    expression: resolveBoundTitle(exprId),
                                  })}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* 3. 演职员与出版机构交互式关联审查工作台 (Staff & Publisher Association Workbench) */}
              <div className="space-y-3 p-4 rounded-xl bg-black/[0.015] dark:bg-white/[0.015] border border-line">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
                  <div>
                    <div className="flex items-center gap-2 font-display font-bold text-sm text-text-strong">
                      <Users className="w-4 h-4 text-primary" />
                      <span>{t("importer.staffWorkbenchTitle")}</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {associations.length}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      {t("importer.staffWorkbenchSubtitle")}
                    </p>
                  </div>

                  {/* Summary counts badge */}
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      {t("importer.staffCountSummary", { create: countCreate, link: countLink, skip: countSkip })}
                    </span>
                  </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={staffFilter}
                      onChange={(e) => setStaffFilter(e.target.value)}
                      placeholder={t("importer.staffFilterPlaceholder")}
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-text-strong placeholder:text-gray-400 focus:outline-hidden focus:border-primary"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleBatchSetAction("create")}
                      className="px-2.5 py-1 rounded-md dark:bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-600 border border-line text-text-body transition-colors duration-fast ease-soft"
                    >
                      {t("importer.staffActionCreateAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchSetAction("skip")}
                      className="px-2.5 py-1 rounded-md dark:bg-white/5 hover:bg-rose-500/10 hover:text-rose-600 border border-line text-text-body transition-colors duration-fast ease-soft"
                    >
                      {t("importer.staffActionSkipAll")}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAssociations}
                      className="px-2.5 py-1 rounded-md dark:bg-white/5 hover:bg-black/10 border border-line text-gray-500 transition-colors duration-fast ease-soft flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{t("importer.staffActionReset")}</span>
                    </button>
                  </div>
                </div>

                {/* Association Items List */}
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {filteredAssociations.map((assoc, idx) => {
                    const originalIndex = associations.indexOf(assoc);
                    const isLinked = assoc.action === "link";
                    const isCreate = assoc.action === "create";
                    const isSkipped = assoc.action === "skip";
                    const isSearchingThis = activeSearchIndex === originalIndex;

                    return (
                      <div
                        key={`${assoc.parsed_name}_${idx}`}
                        className={`p-3 rounded-xl border transition-all ${
                          isSkipped
                            ? "bg-black/[0.01] dark:bg-white/[0.01] border-line-subtle opacity-60"
                            : isLinked
                            ? "bg-blue-500/[0.03] dark:bg-blue-500/[0.04] border-blue-500/30"
                            : "bg-surface border-line shadow-xs"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {/* Entity Info */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {assoc.avatar_url ? (
                              <img
                                src={assoc.avatar_url}
                                alt={assoc.parsed_name}
                                className="w-10 h-10 rounded-lg object-cover border border-line shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg dark:bg-white/5 border border-line grid place-items-center text-gray-400 shrink-0">
                                {assoc.entity_type === "studio" || assoc.entity_type === "publisher" ? (
                                  <Building2 className="w-5 h-5" />
                                ) : (
                                  <User className="w-5 h-5" />
                                )}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-text-strong truncate">
                                  {assoc.parsed_name}
                                </span>
                                {assoc.parsed_original && assoc.parsed_original !== assoc.parsed_name && (
                                  <span className="text-[11px] text-gray-400 font-mono truncate">
                                    ({assoc.parsed_original})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {/* Role Selector */}
                                <select
                                  value={assoc.custom_role || assoc.parsed_role}
                                  onChange={(e) => updateAssociation(originalIndex, { custom_role: e.target.value })}
                                  className="text-[11px] font-mono px-2 py-0.5 rounded-md dark:bg-white/5 border border-line text-text-body focus:outline-hidden focus:border-primary"
                                >
                                  <option value={assoc.parsed_role}>{assoc.parsed_role}</option>
                                  <option value="Author">{t("importer.role.roleAuthor")}</option>
                                  <option value="Director">{t("importer.role.roleDirector")}</option>
                                  <option value="Screenplay">{t("importer.role.roleScreenplay")}</option>
                                  <option value="Illustrator / Artist">{t("importer.role.roleIllustrator")}</option>
                                  <option value="Composer">{t("importer.role.roleComposer")}</option>
                                  <option value="Voice Actor">{t("importer.role.roleVoiceActor")}</option>
                                  <option value="Actor">{t("importer.role.roleActor")}</option>
                                  <option value="Studio">{t("importer.role.roleStudio")}</option>
                                  <option value="Publisher">{t("importer.role.rolePublisher")}</option>
                                  <option value="Record Label">{t("importer.role.roleLabel")}</option>
                                  <option value="Circle">{t("importer.role.roleCircle")}</option>
                                  <option value="Producer">{t("importer.role.roleProducer")}</option>
                                  <option value="Character">{t("importer.role.roleCharacter")}</option>
                                </select>

                                {/* Character name field if voice actor / cast */}
                                {(assoc.custom_role?.includes("Voice") || assoc.parsed_role?.includes("Voice") || assoc.character_name) && (
                                  <input
                                    type="text"
                                    value={assoc.character_name || ""}
                                    onChange={(e) => updateAssociation(originalIndex, { character_name: e.target.value })}
                                    placeholder={t("importer.staffCharacterRole")}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-line bg-surface text-text-body w-28 focus:outline-hidden focus:border-primary"
                                  />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Switcher Segmented Buttons */}
                          <div className="flex items-center gap-1 shrink-0 self-end sm:self-center text-xs font-mono">
                            <button
                              type="button"
                              onClick={() => updateAssociation(originalIndex, { action: "create" })}
                              className={`px-2.5 py-1 rounded-lg transition-all ${
                                isCreate
                                  ? "bg-emerald-500 text-white font-bold shadow-xs"
                                  : "bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                              }`}
                            >
                              {t("importer.staffActionCreate")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateAssociation(originalIndex, { action: "link" });
                                if (!assoc.target_artist_id) {
                                  setActiveSearchIndex(originalIndex);
                                  handleSearchArtistInDB(assoc.parsed_name);
                                }
                              }}
                              className={`px-2.5 py-1 rounded-lg transition-all ${
                                isLinked
                                  ? "bg-blue-500 text-white font-bold shadow-xs"
                                  : "bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                              }`}
                            >
                              {t("importer.staffActionLink")}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateAssociation(originalIndex, { action: "skip" })}
                              className={`px-2.5 py-1 rounded-lg transition-all ${
                                isSkipped
                                  ? "bg-gray-600 text-white font-bold shadow-xs"
                                  : "bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                              }`}
                            >
                              {t("importer.staffActionSkip")}
                            </button>
                          </div>
                        </div>

                        {/* If Link Mode is selected: display matched artist badge and allow searching another */}
                        {isLinked && (
                          <div className="mt-2.5 pt-2 border-t border-blue-500/15 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                            <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>{t("importer.staffMatchedWith")}:</span>
                              <strong className="underline">
                                {assoc.parsed_name}
                              </strong>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveSearchIndex(isSearchingThis ? null : originalIndex);
                                if (!isSearchingThis) {
                                  setArtistSearchQuery(assoc.parsed_name);
                                  handleSearchArtistInDB(assoc.parsed_name);
                                }
                              }}
                              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <Search className="w-3 h-3" />
                              <span>{t("importer.staffPickDifferent")}</span>
                            </button>
                          </div>
                        )}

                        {/* Inline search box if picking another artist */}
                        {isSearchingThis && (
                          <div className="mt-2 p-3 rounded-lg bg-surface border border-blue-500/30 space-y-2 animate-fade-in">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={artistSearchQuery}
                                onChange={(e) => setArtistSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearchArtistInDB(artistSearchQuery)}
                                placeholder={t("importer.staffSearchAndPick")}
                                className="w-full px-2.5 py-1 rounded-md border border-line bg-surfaceSubtle text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => handleSearchArtistInDB(artistSearchQuery)}
                                className="px-3 py-1 rounded-md bg-primary text-white text-xs font-semibold"
                              >
                                {isSearchingArtist ? <Loader2 className="w-3 h-3 animate-spin" /> : t("common.search")}
                              </button>
                            </div>

                            {artistSearchResults.length > 0 ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                                {artistSearchResults.map((ar) => (
                                  <div
                                    key={ar.id}
                                    onClick={() => {
                                      updateAssociation(originalIndex, {
                                        action: "link",
                                        target_artist_id: ar.id,
                                      });
                                      setActiveSearchIndex(null);
                                    }}
                                    className="p-2 rounded-md border border-line-subtle hover:border-primary/40 hover:bg-primary/5 cursor-pointer flex items-center justify-between text-xs"
                                  >
                                    <div className="truncate">
                                      <div className="font-bold text-text-strong truncate">
                                        {title(ar, locale)}
                                      </div>
                                      <div className="text-[10px] text-gray-400 truncate">
                                        {kindLabel(ar.kind)}
                                        {ar.types?.[0] ? ` · ${typeLabel(ar.types[0])}` : ""}
                                      </div>
                                    </div>
                                    <Check className="w-3.5 h-3.5 text-primary shrink-0 opacity-0 hover:opacity-100" />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              !isSearchingArtist && (
                                <p className="text-[11px] text-gray-400 font-mono">
                                  {t("importer.staffNoMatchesFound")}
                                </p>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Persistent Options & Notes */}
          {previewData && (
            <div className="space-y-3 border-t border-line pt-4 text-xs font-mono">
              <label className="flex items-center gap-2 text-text-body cursor-pointer">
                <input
                  type="checkbox"
                  checked={downloadCover}
                  onChange={(e) => setDownloadCover(e.target.checked)}
                  className="rounded-md border-black/20 text-primary focus:ring-primary"
                />
                <Download className="w-3.5 h-3.5 text-primary" />
                <span>{t("importer.optDownloadCover")}</span>
              </label>

              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder={t("importer.editNotePlaceholder", { note: t("importer.defaultEditNote", { source: previewData.source.toUpperCase() }) })}
                className="w-full px-3.5 py-2 rounded-xl border border-line bg-surfaceSubtle text-xs text-text-strong placeholder:text-gray-400 focus:outline-hidden focus:border-primary font-mono"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-line bg-surfaceSubtle flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-line hover:bg-black/5 dark:hover:bg-white/5 text-text-body text-xs font-mono font-semibold transition-colors duration-fast ease-soft cursor-pointer"
          >
            {t("common.cancel")}
          </button>

          {previewData && (
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={importing}
              className="px-6 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("importer.importing")}</span>
                </>
              ) : entityType !== "work" ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{t("importer.btnConfirmImportEntity")}</span>
                </>
              ) : selectedTargetWork ? (
                <>
                  <GitFork className="w-4 h-4" />
                  <span>{t("importer.btnConfirmMerge")}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{t("importer.btnConfirmImport")}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
