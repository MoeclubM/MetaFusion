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
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Users,
  Download,
  ExternalLink,
  Loader2,
  Link2,
  PlusCircle,
  GitFork,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  previewExternalCatalog,
  importExternalCatalog,
  fetchPublicPlugins,
  fetchApi,
  ImporterPreviewResponse,
  PluginItem,
  Work,
} from "@/lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSource?: string;
  initialURLOrID?: string;
}

export function OmniImportModal({
  isOpen,
  onClose,
  initialSource = "auto",
  initialURLOrID = "",
}: Props) {
  const { user } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [source, setSource] = useState<string>(initialSource);
  const [inputVal, setInputVal] = useState<string>(initialURLOrID);
  const [mediaHint, setMediaHint] = useState<string>("");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<ImporterPreviewResponse | null>(null);
  const [error, setError] = useState<string>("");

  // 智能查重与关联目标母体
  const [searchingDuplicates, setSearchingDuplicates] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<Work[]>([]);
  const [selectedTargetWork, setSelectedTargetWork] = useState<Work | null>(null);
  const [linkMode, setLinkMode] = useState<"append_release_to_work" | "merge_translations" | "create_relation" | "new_work">("new_work");
  const [relationType, setRelationType] = useState<string>("soundtrack_of");

  // 手动搜索目标母体作品
  const [isManualLinkOpen, setIsManualLinkOpen] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualSearchResults, setManualSearchResults] = useState<Work[]>([]);
  const [isSearchingManual, setIsSearchingManual] = useState(false);

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

  const handleParse = async (targetVal?: string, targetSource?: string) => {
    const queryVal = (targetVal !== undefined ? targetVal : inputVal).trim();
    const querySource = targetSource || source;

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
    setLoadingPreview(true);

    try {
      const res = await previewExternalCatalog({
        source: querySource,
        url_or_id: queryVal,
        media_type_hint: mediaHint,
      });
      setPreviewData(res);
      if (res.source) {
        setSource(res.source);
      }

      // 智能全库查重推荐
      const searchTitle = res.work?.title || res.work?.original_title;
      if (searchTitle && searchTitle.trim()) {
        setSearchingDuplicates(true);
        fetchApi<{ items: Work[] }>(`/catalog/works?q=${encodeURIComponent(searchTitle.trim())}&page_size=5`)
          .then((matchRes) => {
            if (matchRes?.items && matchRes.items.length > 0) {
              setDuplicateMatches(matchRes.items);
              setSelectedTargetWork(matchRes.items[0]);
              setLinkMode("append_release_to_work");
            }
          })
          .catch(() => {})
          .finally(() => {
            setSearchingDuplicates(false);
          });
      }
    } catch (err: any) {
      setError(err?.message || t("importer.errorParseFailed"));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleManualSearch = async () => {
    const q = manualSearchQuery.trim();
    if (!q) return;
    setIsSearchingManual(true);
    try {
      const res = await fetchApi<{ items: Work[] }>(`/catalog/works?q=${encodeURIComponent(q)}&page_size=6`);
      setManualSearchResults(res?.items || []);
    } catch {
      setManualSearchResults([]);
    } finally {
      setIsSearchingManual(false);
    }
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
      const res = await importExternalCatalog({
        source: previewData.source,
        url_or_id: previewData.external_url || inputVal,
        work: previewData.work,
        artists: previewData.artists,
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
    } catch (err: any) {
      setError(err?.message || t("importer.errorImportFailed"));
    } finally {
      setImporting(false);
    }
  };

  const builtinSources = [
    { id: "auto", label: t("importer.sourceAuto"), icon: Sparkles },
    { id: "musicbrainz", label: t("importer.sourceMusicbrainz"), icon: Disc },
    { id: "tmdb", label: t("importer.sourceTmdb"), icon: Film },
    { id: "imdb", label: t("importer.sourceImdb"), icon: Film },
    { id: "bangumi", label: t("importer.sourceBangumi"), icon: BookOpen },
    { id: "vndb", label: t("importer.sourceVndb"), icon: Gamepad2 },
    { id: "douban", label: t("importer.sourceDouban"), icon: Globe },
  ];

  const sourceTabs = [
    ...builtinSources,
    ...plugins
      .filter((p) => !builtinSources.some((b) => b.id === p.id))
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className="relative w-full max-w-3xl rounded-2xl border border-black/10 dark:border-white/10 bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
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
          {/* Source Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-black/5 dark:bg-white/[0.04] border border-black/5 dark:border-white/[0.06] text-xs font-mono">
            {sourceTabs.map((tab) => {
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

          {/* Clean Input & Parse Action */}
          <div className="relative flex items-center">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleParse()}
              placeholder={getPlaceholder()}
              className="w-full pl-3.5 pr-28 h-11 rounded-xl bg-black/5 dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all text-gray-900 dark:text-white font-mono"
            />
            <button
              type="button"
              disabled={loadingPreview || !inputVal.trim()}
              onClick={() => handleParse()}
              className="absolute right-1.5 h-8 px-3.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold text-xs font-mono inline-flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {loadingPreview ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("importer.parsing")}</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>{t("importer.btnParse")}</span>
                </>
              )}
            </button>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2.5 text-rose-600 dark:text-rose-400 text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {importSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-3 text-emerald-600 dark:text-emerald-400 text-sm font-mono animate-fade-in">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <div className="font-bold">{t("importer.successTitle")}</div>
                <div className="text-xs opacity-80 mt-0.5">
                  {t("importer.successDesc")}
                </div>
              </div>
            </div>
          )}

          {/* Preview & Merge Strategy Interface */}
          {previewData && (
            <div className="space-y-4 animate-slide-up">
              {/* Smart Match / Link Target Work Card */}
              {(duplicateMatches.length > 0 || selectedTargetWork) && (
                <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-primary">
                      <Sparkles className="w-4 h-4" />
                      <span>{t("importer.smartMatchDetected")}</span>
                    </div>
                    {selectedTargetWork && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTargetWork(null);
                          setLinkMode("new_work");
                        }}
                        className="text-[11px] font-mono text-gray-500 hover:text-rose-500 transition-colors"
                      >
                        {t("importer.cancelTargetWork")}
                      </button>
                    )}
                  </div>

                  {/* Selected / Candidate Target Work Display */}
                  {selectedTargetWork && (
                    <div className="p-3 rounded-lg bg-surface border border-primary/20 flex items-center gap-3">
                      {selectedTargetWork.cover_image_url ? (
                        <img
                          src={selectedTargetWork.cover_image_url}
                          alt={selectedTargetWork.title}
                          className="w-10 h-14 object-cover rounded border border-black/10 dark:border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-14 rounded bg-black/10 dark:bg-white/10 grid place-items-center text-[10px] text-gray-400 shrink-0">
                          <Layers className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-mono text-primary font-medium">
                          {t("importer.selectedTargetWork")}
                        </div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                          {selectedTargetWork.title}
                        </div>
                        {selectedTargetWork.original_title && selectedTargetWork.original_title !== selectedTargetWork.title && (
                          <div className="text-xs text-gray-400 font-mono truncate">
                            {selectedTargetWork.original_title}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Candidate List selector if multiple duplicates found */}
                  {duplicateMatches.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {duplicateMatches.map((dm) => (
                        <button
                          key={dm.id}
                          type="button"
                          onClick={() => {
                            setSelectedTargetWork(dm);
                            if (linkMode === "new_work") {
                              setLinkMode("append_release_to_work");
                            }
                          }}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-all ${
                            selectedTargetWork?.id === dm.id
                              ? "bg-primary text-white border-primary"
                              : "bg-surface text-gray-700 dark:text-gray-300 border-black/10 dark:border-white/10 hover:border-primary/50"
                          }`}
                        >
                          《{dm.title}》
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Merge Mode Radio Selection */}
                  {selectedTargetWork && (
                    <div className="space-y-2 pt-2 border-t border-primary/20">
                      <div className="text-[11px] font-mono font-semibold text-gray-700 dark:text-gray-300">
                        {t("importer.linkModeLabel")}:
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                        <label
                          className={`p-2.5 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-all ${
                            linkMode === "append_release_to_work"
                              ? "bg-primary/10 border-primary text-primary font-semibold"
                              : "bg-surface border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="link_mode"
                            checked={linkMode === "append_release_to_work"}
                            onChange={() => setLinkMode("append_release_to_work")}
                            className="mt-0.5 text-primary focus:ring-primary/20"
                          />
                          <div className="space-y-0.5">
                            <div>{t("importer.mergeModeAppendRelease")}</div>
                            <div className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                              {t("importer.linkModeAppendReleaseDesc")}
                            </div>
                          </div>
                        </label>

                        <label
                          className={`p-2.5 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-all ${
                            linkMode === "merge_translations"
                              ? "bg-primary/10 border-primary text-primary font-semibold"
                              : "bg-surface border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="link_mode"
                            checked={linkMode === "merge_translations"}
                            onChange={() => setLinkMode("merge_translations")}
                            className="mt-0.5 text-primary focus:ring-primary/20"
                          />
                          <div className="space-y-0.5">
                            <div>{t("importer.linkModeMergeTranslationsDesc")}</div>
                          </div>
                        </label>

                        <label
                          className={`p-2.5 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-all ${
                            linkMode === "create_relation"
                              ? "bg-primary/10 border-primary text-primary font-semibold"
                              : "bg-surface border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="link_mode"
                            checked={linkMode === "create_relation"}
                            onChange={() => setLinkMode("create_relation")}
                            className="mt-0.5 text-primary focus:ring-primary/20"
                          />
                          <div className="space-y-1.5 flex-1">
                            <div>{t("importer.mergeModeCreateRelation")}</div>
                            <div className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                              {t("importer.linkModeCreateRelationDesc")}
                            </div>
                            {linkMode === "create_relation" && (
                              <div className="pt-1.5 flex items-center gap-2">
                                <span className="text-[11px] text-gray-500">{t("importer.relationTypeLabel")}:</span>
                                <select
                                  value={relationType}
                                  onChange={(e) => setRelationType(e.target.value)}
                                  className="h-7 px-2 rounded-md bg-surface border border-primary/30 text-xs font-mono text-gray-900 dark:text-white"
                                >
                                  <option value="soundtrack_of">{t("importer.relSoundtrack")}</option>
                                  <option value="adaptation_of">{t("importer.relAdaptation")}</option>
                                  <option value="sequel_of">{t("importer.relSequel")}</option>
                                  <option value="spin_off_of">{t("importer.relSpinOff")}</option>
                                  <option value="crossover_with">{t("importer.relCrossover")}</option>
                                  <option value="related_to">{t("importer.relRelated")}</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </label>

                        <label
                          className={`p-2.5 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-all ${
                            linkMode === "new_work"
                              ? "bg-primary/10 border-primary text-primary font-semibold"
                              : "bg-surface border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="link_mode"
                            checked={linkMode === "new_work"}
                            onChange={() => setLinkMode("new_work")}
                            className="mt-0.5 text-primary focus:ring-primary/20"
                          />
                          <div>{t("importer.mergeModeNewWork")}</div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Manual Link to Existing Work Collapsible Panel */}
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsManualLinkOpen(!isManualLinkOpen)}
                  className="w-full p-3.5 flex items-center justify-between text-xs font-mono font-semibold text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5 text-primary" />
                    <span>{t("importer.manualLinkToggle")}</span>
                  </div>
                  {isManualLinkOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {isManualLinkOpen && (
                  <div className="p-3.5 pt-0 space-y-3 border-t border-black/5 dark:border-white/5">
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={manualSearchQuery}
                        onChange={(e) => setManualSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleManualSearch()}
                        placeholder={t("importer.searchWorkPlaceholder")}
                        className="w-full pl-3 pr-20 h-9 rounded-lg bg-surface border border-black/10 dark:border-white/10 text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:border-primary/50"
                      />
                      <button
                        type="button"
                        onClick={handleManualSearch}
                        disabled={isSearchingManual || !manualSearchQuery.trim()}
                        className="absolute right-1 h-7 px-2.5 rounded bg-primary/10 text-primary hover:bg-primary/20 text-xs font-mono font-semibold transition-colors disabled:opacity-50"
                      >
                        {isSearchingManual ? <Loader2 className="w-3 h-3 animate-spin" /> : t("common.search")}
                      </button>
                    </div>

                    {manualSearchResults.length > 0 && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {manualSearchResults.map((item) => (
                          <div
                            key={item.id}
                            className="p-2 rounded-lg bg-surface border border-black/5 dark:border-white/5 flex items-center justify-between gap-2 text-xs font-mono hover:border-primary/30 transition-colors"
                          >
                            <div className="truncate">
                              <span className="font-semibold text-gray-900 dark:text-white">
                                {item.title}
                              </span>
                              {item.original_title && item.original_title !== item.title && (
                                <span className="text-gray-400 ml-1.5 text-[11px]">
                                  ({item.original_title})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTargetWork(item);
                                setLinkMode("append_release_to_work");
                                setIsManualLinkOpen(false);
                              }}
                              className="px-2 py-0.5 rounded bg-primary text-white text-[11px] font-semibold shrink-0"
                            >
                              {t("common.edit")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Live Rich Metadata Preview Card */}
              <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Cover Preview */}
                  <div className="w-32 h-44 sm:w-36 sm:h-48 rounded-xl border border-black/10 dark:border-white/10 bg-black/10 dark:bg-white/5 overflow-hidden shrink-0 relative group shadow-sm">
                    {previewData.work.cover_image_url ? (
                      <img
                        src={previewData.work.cover_image_url}
                        alt={previewData.work.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-gray-400 font-mono text-xs">
                        No Cover
                      </div>
                    )}
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[9px] font-mono font-bold text-white border border-white/20 uppercase">
                      {previewData.source}
                    </div>
                    {previewData.work.cover_aspect && (
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[9px] font-mono text-white border border-white/20">
                        {previewData.work.cover_aspect}
                      </div>
                    )}
                  </div>

                  {/* Work & Metadata Info */}
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-sky-500/10 text-sky-500 border border-sky-500/20">
                        {previewData.media_type || "Catalog Work"}
                      </span>
                      {previewData.work.release_date && (
                        <span className="text-xs font-mono text-gray-400">
                          {previewData.work.release_date}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="font-display font-bold text-lg text-gray-900 dark:text-white leading-tight">
                        {previewData.work.title}
                      </h3>
                      {previewData.work.original_title && previewData.work.original_title !== previewData.work.title && (
                        <div className="text-xs text-gray-400 font-mono italic mt-0.5">
                          {previewData.work.original_title}
                        </div>
                      )}
                    </div>

                    {previewData.work.summary && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-3 leading-relaxed">
                        {previewData.work.summary}
                      </p>
                    )}

                    {/* Tags */}
                    {previewData.tags && previewData.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {previewData.tags.slice(0, 6).map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-[10px] font-mono text-gray-600 dark:text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Creators & Artists Section */}
                {previewData.artists && previewData.artists.length > 0 && (
                  <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] space-y-1.5">
                    <div className="text-[11px] font-mono font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <span>{t("importer.artistsTitle")}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {previewData.artists.slice(0, 6).map((art, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06] flex items-center justify-between text-xs"
                        >
                          <div className="font-medium text-gray-900 dark:text-white truncate">
                            {art.name}
                          </div>
                          <span className="text-[10px] font-mono text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
                            {art.role || "Creator"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Release & Mediums Summary */}
                {previewData.mediums && previewData.mediums.length > 0 && (
                  <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] space-y-1.5">
                    <div className="text-[11px] font-mono font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Disc className="w-3.5 h-3.5" />
                      <span>{t("importer.mediumsTitle")}</span>
                    </div>
                    <div className="space-y-1.5">
                      {previewData.mediums.map((med, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/[0.06] space-y-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between font-mono">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {med.name} ({med.format})
                            </span>
                            <span className="text-gray-400 text-[11px]">
                              {med.tracks?.length || 0} {t("importer.trackCount")}
                            </span>
                          </div>
                          {med.tracks && med.tracks.length > 0 && (
                            <div className="space-y-1 font-mono text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-black/5 dark:border-white/5">
                              {med.tracks.slice(0, 4).map((trk, tIdx) => {
                                const dur = trk.duration_seconds || 0;
                                const durStr = dur > 0 ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}` : "";
                                return (
                                  <div key={tIdx} className="flex items-center justify-between">
                                    <span className="truncate pr-2">
                                      {trk.position}. {trk.title}
                                    </span>
                                    <span className="shrink-0 text-gray-400">{durStr}</span>
                                  </div>
                                );
                              })}
                              {med.tracks.length > 4 && (
                                <div className="text-[10px] text-gray-400 italic">
                                  {t("importer.moreTracks", { count: med.tracks.length - 4 })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Options Checkboxes */}
                <div className="pt-2 border-t border-black/5 dark:border-white/[0.06] space-y-2">
                  <label className="flex items-center gap-2 text-xs font-mono text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={downloadCover}
                      onChange={(e) => setDownloadCover(e.target.checked)}
                      className="rounded border-gray-400 text-primary focus:ring-primary/20"
                    />
                    <span>{t("importer.optDownloadCover")}</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between gap-3">
          <div className="text-xs font-mono text-gray-400 truncate">
            {previewData?.external_url && (
              <a
                href={previewData.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary inline-flex items-center gap-1 transition-colors"
              >
                <span>{previewData.external_url}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-9 rounded-xl border border-black/10 dark:border-white/10 text-xs font-mono text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!previewData || importing || !user}
              onClick={handleConfirmImport}
              className="px-5 h-9 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-xs font-mono inline-flex items-center gap-2 shadow-xs transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {importing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("importer.importing")}</span>
                </>
              ) : selectedTargetWork && linkMode !== "new_work" ? (
                <>
                  <GitFork className="w-3.5 h-3.5" />
                  <span>{t("importer.btnConfirmMerge")}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>{t("importer.btnConfirmImport")}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
