"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Sparkles,
  Search,
  Disc,
  Film,
  BookOpen,
  Gamepad2,
  Globe,
  Puzzle,
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
  fetchPublicPlugins,
  fetchApi,
  ImporterPreviewResponse,
  StaffAssociation,
  PluginItem,
  Work,
  Artist,
} from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSource?: string;
  initialURLOrID?: string;
  initialEntityType?: "work" | "artist" | "organization" | "character";
}

export function OmniImportModal({
  isOpen,
  onClose,
  initialSource = "auto",
  initialURLOrID = "",
  initialEntityType = "work",
}: Props) {
  const { user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  // 实体类型切换 (Work / Artist / Organization / Character)
  const [entityType, setEntityType] = useState<"work" | "artist" | "organization" | "character">(initialEntityType);

  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [source, setSource] = useState<string>(initialSource);
  const [inputVal, setInputVal] = useState<string>(initialURLOrID);
  const [mediaHint, setMediaHint] = useState<string>("");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ImporterPreviewResponse | null>(null);
  const [error, setError] = useState<string>("");

  // 演职员与出版机构交互式审查工作台状态
  const [associations, setAssociations] = useState<StaffAssociation[]>([]);
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [artistSearchQuery, setArtistSearchQuery] = useState<string>("");
  const [artistSearchResults, setArtistSearchResults] = useState<Artist[]>([]);
  const [isSearchingArtist, setIsSearchingArtist] = useState<boolean>(false);

  // 智能查重与关联目标母体
  const [duplicateMatches, setDuplicateMatches] = useState<Work[]>([]);
  const [selectedTargetWork, setSelectedTargetWork] = useState<Work | null>(null);
  const [linkMode, setLinkMode] = useState<"append_release_to_work" | "merge_translations" | "create_relation" | "new_work">("new_work");
  const [relationType] = useState<string>("soundtrack_of");

  const [downloadCover, setDownloadCover] = useState(true);
  const [editNote, setEditNote] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      fetchPublicPlugins("importer")
        .then((res) => {
          if (res?.items && res.items.length > 0) {
            setPlugins(res.items);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

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
        media_type_hint: mediaHint,
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
          const hasMatched = (a.matched_artist && a.matched_artist.id) || (a.id && a.id !== "");
          return {
            parsed_name: a.name,
            parsed_original: a.original_name,
            parsed_role: a.role || "Creator",
            entity_type: a.entity_type || "person",
            action: hasMatched ? "link" : "create",
            target_artist_id: a.matched_artist?.id || a.id,
            custom_role: a.role || "Creator",
            character_name: a.character_name || "",
            country: a.country,
            biography: a.biography,
            avatar_url: a.avatar_url,
            external_ids: a.external_ids,
            translations: a.translations,
          };
        });
        setAssociations(initialAssocs);
      }

      // 智能全库查重推荐（仅对作品生效）
      if (queryType === "work" && res.work) {
        const searchTitle = res.work?.title || res.work?.original_title;
        if (searchTitle && searchTitle.trim()) {
          fetchApi<{ items: Work[] }>(`/catalog/works?q=${encodeURIComponent(searchTitle.trim())}&page_size=5`)
            .then((matchRes) => {
              if (matchRes?.items && matchRes.items.length > 0) {
                setDuplicateMatches(matchRes.items);
                setSelectedTargetWork(matchRes.items[0]);
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
      const res = await fetchApi<{ items: Artist[] }>(`/catalog/artists?q=${encodeURIComponent(q)}&page_size=8`);
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
      const hasMatched = (a.matched_artist && a.matched_artist.id) || (a.id && a.id !== "");
      return {
        parsed_name: a.name,
        parsed_original: a.original_name,
        parsed_role: a.role || "Creator",
        entity_type: a.entity_type || "person",
        action: hasMatched ? "link" : "create",
        target_artist_id: a.matched_artist?.id || a.id,
        custom_role: a.role || "Creator",
        character_name: a.character_name || "",
        country: a.country,
        biography: a.biography,
        avatar_url: a.avatar_url,
        external_ids: a.external_ids,
        translations: a.translations,
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
            router.push(`/artists/${res.artist_id}`);
            onClose();
          }
        }, 1200);
      } else {
        // 作品与演职员关联审查导入
        const res = await importExternalCatalog({
          entity_type: "work",
          source: previewData.source,
          url_or_id: previewData.external_url || inputVal,
          work: previewData.work,
          staff_associations: associations,
          release: previewData.release,
          mediums: previewData.mediums,
          download_cover: downloadCover,
          edit_note: editNote.trim() || t("importer.defaultEditNote", { source: previewData.source.toUpperCase() }),
          source_urls: [previewData.external_url || inputVal],
          target_work_id: selectedTargetWork?.id,
          link_mode: selectedTargetWork ? linkMode : "new_work",
          relation_type: linkMode === "create_relation" ? relationType : undefined,
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

  // 根据当前实体类型组织推荐权威源
  const getSourceTabs = () => {
    let builtin: Array<{ id: string; label: string; icon: any }> = [];
    if (entityType === "work") {
      builtin = [
        { id: "auto", label: t("importer.sourceAuto"), icon: Sparkles },
        { id: "musicbrainz", label: t("importer.sourceMusicbrainz"), icon: Disc },
        { id: "tmdb", label: t("importer.sourceTmdb"), icon: Film },
        { id: "imdb", label: t("importer.sourceImdb"), icon: Film },
        { id: "bangumi", label: t("importer.sourceBangumi"), icon: BookOpen },
        { id: "vndb", label: t("importer.sourceVndb"), icon: Gamepad2 },
        { id: "douban", label: t("importer.sourceDouban"), icon: Globe },
      ];
    } else if (entityType === "artist") {
      builtin = [
        { id: "auto", label: t("importer.sourceAuto"), icon: Sparkles },
        { id: "musicbrainz", label: t("importer.sourceMusicbrainz"), icon: Disc },
        { id: "tmdb", label: t("importer.sourceTmdb"), icon: Film },
        { id: "imdb", label: t("importer.sourceImdb"), icon: Film },
        { id: "bangumi", label: t("importer.sourceBangumi"), icon: BookOpen },
        { id: "vndb", label: t("importer.sourceVndb"), icon: Gamepad2 },
      ];
    } else if (entityType === "organization") {
      builtin = [
        { id: "auto", label: t("importer.sourceAuto"), icon: Sparkles },
        { id: "musicbrainz", label: t("importer.sourceMusicbrainz"), icon: Disc },
        { id: "tmdb", label: t("importer.sourceTmdb"), icon: Film },
        { id: "bangumi", label: t("importer.sourceBangumi"), icon: BookOpen },
        { id: "vndb", label: t("importer.sourceVndb"), icon: Gamepad2 },
      ];
    } else {
      // character
      builtin = [
        { id: "auto", label: t("importer.sourceAuto"), icon: Sparkles },
        { id: "bangumi", label: t("importer.sourceBangumi"), icon: BookOpen },
        { id: "vndb", label: t("importer.sourceVndb"), icon: Gamepad2 },
      ];
    }

    return [
      ...builtin,
      ...plugins
        .filter((p) => !builtin.some((b) => b.id === p.id))
        .map((p) => {
          let Icon = Puzzle;
          if (p.icon === "Disc") Icon = Disc;
          else if (p.icon === "Film") Icon = Film;
          else if (p.icon === "Tv") Icon = BookOpen;
          else if (p.icon === "Gamepad2") Icon = Gamepad2;
          else if (p.icon === "BookOpen") Icon = BookOpen;
          return {
            id: p.id,
            label: p.name.split(" ")[0] || p.name,
            icon: Icon,
          };
        }),
    ];
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
        className="relative w-full max-w-4xl rounded-2xl border border-black/10 dark:border-white/10 bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 grid place-items-center text-primary shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg text-gray-900 dark:text-white">
                {t("importer.modalTitle")}
              </h2>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                {t("importer.modalSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 grid place-items-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
          {/* Top Entity Type Switcher (实体导入类型切换) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 font-mono flex items-center gap-1.5">
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
                        : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs">
                      <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-gray-400"}`} />
                      <span>{item.label}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 line-clamp-1 font-mono">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Source Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-black/5 dark:bg-white/[0.04] border border-black/5 dark:border-white/[0.06] text-xs font-mono">
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
                      ? "bg-surface text-primary font-semibold shadow-xs border border-black/10 dark:border-white/10"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
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
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-hidden focus:border-primary transition-all font-mono"
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
            <div className="space-y-4 animate-fade-in border-t border-black/5 dark:border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-display font-bold text-sm text-gray-900 dark:text-white">
                  <UserCheck className="w-4 h-4 text-primary" />
                  <span>{t("importer.entityPreviewTitle")}</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                  {previewData.source.toUpperCase()} · {previewData.artist.entity_type.toUpperCase()}
                </span>
              </div>

              {/* Entity Main Card */}
              <div className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 flex flex-col sm:flex-row gap-4">
                {previewData.artist.avatar_url ? (
                  <img
                    src={previewData.artist.avatar_url}
                    alt={previewData.artist.name}
                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover border border-black/10 dark:border-white/10 shrink-0 bg-black/5"
                  />
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-primary/10 border border-primary/20 grid place-items-center text-primary shrink-0">
                    <User className="w-10 h-10" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg text-gray-900 dark:text-white">
                      {previewData.artist.name}
                    </h3>
                    {previewData.artist.original_name && previewData.artist.original_name !== previewData.artist.name && (
                      <p className="text-xs text-gray-500 font-mono mt-0.5">
                        {previewData.artist.original_name}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                      {t("importer.entityTypeLabel")}: {previewData.artist.entity_type}
                    </span>
                    {previewData.artist.country && (
                      <span className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
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

                  {previewData.artist.biography && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line line-clamp-3 bg-black/[0.02] dark:bg-white/[0.02] p-2.5 rounded-lg border border-black/5 dark:border-white/5 font-sans">
                      {previewData.artist.biography}
                    </p>
                  )}
                </div>
              </div>

              {/* Matched warning if already in DB */}
              {previewData.artist.matched_artist && (
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-700 dark:text-blue-300 text-xs font-mono flex items-center gap-2">
                  <UserCheck className="w-4 h-4 shrink-0 text-blue-500" />
                  <div>
                    <span>{t("importer.staffMatchedWith")}: </span>
                    <strong className="underline">{previewData.artist.matched_artist.name}</strong>
                    <span className="opacity-75"> ({previewData.artist.matched_artist.entity_type})</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* 预览结果分支 2: 作品母体、关联审查工作台、发行版规格 (Work) */}
          {/* ========================================================================= */}
          {previewData && entityType === "work" && previewData.work && (
            <div className="space-y-5 animate-fade-in border-t border-black/5 dark:border-white/10 pt-4">
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
                            <div className="font-bold truncate text-gray-900 dark:text-white">
                              {m.title}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              {m.original_title || m.category_code || m.country}
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
              <div className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 flex flex-col sm:flex-row gap-4">
                {previewData.work.cover_image_url ? (
                  <img
                    src={previewData.work.cover_image_url}
                    alt={previewData.work.title}
                    className="w-24 h-32 sm:w-28 sm:h-36 rounded-lg object-cover border border-black/10 dark:border-white/10 shrink-0 bg-black/5"
                  />
                ) : (
                  <div className="w-24 h-32 sm:w-28 sm:h-36 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 grid place-items-center text-gray-400 shrink-0">
                    <Film className="w-8 h-8" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <h3 className="font-display font-bold text-base sm:text-lg text-gray-900 dark:text-white truncate">
                      {previewData.work.title}
                    </h3>
                    {previewData.work.original_title && previewData.work.original_title !== previewData.work.title && (
                      <p className="text-xs text-gray-500 font-mono truncate">
                        {previewData.work.original_title}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                      {previewData.source.toUpperCase()}
                    </span>
                    {previewData.work.release_date && (
                      <span className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
                        {previewData.work.release_date}
                      </span>
                    )}
                    {previewData.work.country && (
                      <span className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300">
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

              {/* 3. 演职员与出版机构交互式关联审查工作台 (Staff & Publisher Association Workbench) */}
              <div className="space-y-3 p-4 rounded-xl bg-black/[0.015] dark:bg-white/[0.015] border border-black/10 dark:border-white/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/5 dark:border-white/10 pb-3">
                  <div>
                    <div className="flex items-center gap-2 font-display font-bold text-sm text-gray-900 dark:text-white">
                      <Users className="w-4 h-4 text-primary" />
                      <span>{t("importer.staffWorkbenchTitle")}</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {associations.length}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t("importer.staffWorkbenchSubtitle")}
                    </p>
                  </div>

                  {/* Summary counts badge */}
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      +{countCreate} 新建
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      🔗{countLink} 关联
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-gray-500/10 text-gray-500 border border-gray-500/20">
                      ✕{countSkip} 跳过
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
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-hidden focus:border-primary"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleBatchSetAction("create")}
                      className="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-600 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      {t("importer.staffActionCreateAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchSetAction("skip")}
                      className="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-rose-500/10 hover:text-rose-600 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      {t("importer.staffActionSkipAll")}
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAssociations}
                      className="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-black/10 border border-black/10 dark:border-white/10 text-gray-500 transition-colors flex items-center gap-1"
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
                            ? "bg-black/[0.01] dark:bg-white/[0.01] border-black/5 dark:border-white/5 opacity-60"
                            : isLinked
                            ? "bg-blue-500/[0.03] dark:bg-blue-500/[0.04] border-blue-500/30"
                            : "bg-surface border-black/10 dark:border-white/10 shadow-xs"
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {/* Entity Info */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {assoc.avatar_url ? (
                              <img
                                src={assoc.avatar_url}
                                alt={assoc.parsed_name}
                                className="w-10 h-10 rounded-lg object-cover border border-black/10 dark:border-white/10 shrink-0 bg-black/5"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 grid place-items-center text-gray-400 shrink-0">
                                {assoc.entity_type === "studio" || assoc.entity_type === "publisher" ? (
                                  <Building2 className="w-5 h-5" />
                                ) : (
                                  <User className="w-5 h-5" />
                                )}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
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
                                  className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 focus:outline-hidden focus:border-primary"
                                >
                                  <option value={assoc.parsed_role}>{assoc.parsed_role}</option>
                                  <option value="Author">原作 / 作者 (Author)</option>
                                  <option value="Director">监督 / 导演 (Director)</option>
                                  <option value="Screenplay">编剧 / 脚本 (Screenplay)</option>
                                  <option value="Illustrator / Artist">作画 / 插图 (Illustrator)</option>
                                  <option value="Composer">配乐 / 作曲 (Composer)</option>
                                  <option value="Voice Actor">声优 / 配音 (Voice Actor)</option>
                                  <option value="Actor">演员 / 出演 (Actor)</option>
                                  <option value="Studio">动画制作 / 工作室 (Studio)</option>
                                  <option value="Publisher">出版机构 / 发行商 (Publisher)</option>
                                  <option value="Record Label">唱片厂牌 (Record Label)</option>
                                  <option value="Circle">同人社团 (Circle)</option>
                                  <option value="Producer">制作人 / 出品 (Producer)</option>
                                  <option value="Character">登场角色 (Character)</option>
                                </select>

                                {/* Character name field if voice actor / cast */}
                                {(assoc.custom_role?.includes("Voice") || assoc.parsed_role?.includes("Voice") || assoc.character_name) && (
                                  <input
                                    type="text"
                                    value={assoc.character_name || ""}
                                    onChange={(e) => updateAssociation(originalIndex, { character_name: e.target.value })}
                                    placeholder={t("importer.staffCharacterRole")}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-black/10 dark:border-white/10 bg-surface text-gray-700 dark:text-gray-300 w-28 focus:outline-hidden focus:border-primary"
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
                                {previewData.artists?.[originalIndex]?.matched_artist?.name || assoc.parsed_name}
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
                                className="w-full px-2.5 py-1 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-xs"
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
                                    className="p-2 rounded-md border border-black/5 dark:border-white/5 hover:border-primary/40 hover:bg-primary/5 cursor-pointer flex items-center justify-between text-xs"
                                  >
                                    <div className="truncate">
                                      <div className="font-bold text-gray-900 dark:text-white truncate">
                                        {ar.name}
                                      </div>
                                      <div className="text-[10px] text-gray-400 truncate">
                                        {ar.entity_type} {ar.country ? `· ${ar.country}` : ""}
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
            <div className="space-y-3 border-t border-black/5 dark:border-white/10 pt-4 text-xs font-mono">
              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300 cursor-pointer">
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
                placeholder={`编辑注记: ${t("importer.defaultEditNote", { source: previewData.source.toUpperCase() })}`}
                className="w-full px-3.5 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-hidden focus:border-primary font-mono"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 text-xs font-mono font-semibold transition-colors cursor-pointer"
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
