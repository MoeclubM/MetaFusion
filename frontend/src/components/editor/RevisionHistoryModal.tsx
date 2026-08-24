"use client";

import React, { useEffect, useState } from "react";
import { X, History, User, Clock, ArrowRight, ExternalLink, GitCommit, FileText, CheckCircle2, Sparkles, Tag } from "lucide-react";
import { fetchEntityRevisions, EntityRevision } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DiffViewer } from "./DiffViewer";
import Link from "next/link";
import { UserRoleBadge } from "@/lib/roles";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetType: "work" | "artist" | "release" | "franchise";
  targetId: string;
  entityTitle: string;
}

export function RevisionHistoryModal({ isOpen, onClose, targetType, targetId, entityTitle }: Props) {
  const { t } = useI18n();
  const [revisions, setRevisions] = useState<EntityRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRev, setSelectedRev] = useState<EntityRevision | null>(null);

  useEffect(() => {
    if (isOpen && targetId) {
      loadRevisions();
    }
  }, [isOpen, targetId]);

  const loadRevisions = async () => {
    setLoading(true);
    try {
      const res = await fetchEntityRevisions(targetType, targetId);
      setRevisions(res.items || []);
      if (res.items && res.items.length > 0) {
        setSelectedRev(res.items[0]);
      }
    } catch (e) {
      console.error("Failed to load revisions:", e);
    } finally {
      setLoading(false);
    }
  };

  const getActionBadge = (editType: string) => {
    switch (editType) {
      case "create":
        return { label: t("editor.history.actionCreate"), color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
      case "delete":
        return { label: t("editor.history.actionDelete"), color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" };
      case "merge":
        return { label: t("editor.history.actionMerge"), color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" };
      case "rollback":
        return { label: t("editor.history.actionRollback"), color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
      case "cover_update":
        return { label: t("editor.history.actionCover"), color: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20" };
      case "relation_update":
        return { label: t("editor.history.actionRelations"), color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" };
      case "external_links":
        return { label: t("editor.history.actionExternalIds"), color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" };
      case "release_mount":
        return { label: t("editor.history.actionReleaseMount"), color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20" };
      case "update":
      default:
        return { label: t("editor.history.actionUpdate"), color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" };
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 dark:bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-black/10 dark:border-white/10 bg-surface shadow-2xl overflow-hidden text-gray-900 dark:text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/10 dark:border-white/[0.08] bg-black/[0.02] dark:bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 grid place-items-center">
              <History className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                {t("editor.history.title")}
              </h2>
              <p className="font-mono text-xs text-gray-500 truncate max-w-md">
                {entityTitle} · <span className="uppercase text-[11px] font-semibold">{targetType}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Layout: Left Revision List, Right Diff View */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-black/10 dark:divide-white/[0.08]">
          {/* Left Column: Revision Timeline List */}
          <div className="md:col-span-4 overflow-y-auto p-3 space-y-2 bg-black/[0.01] dark:bg-black/10">
            <div className="text-[11px] font-mono text-gray-500 uppercase tracking-wider px-1 pb-0.5">
              {t("editor.history.revisionCount", { count: revisions.length })}
            </div>

            {loading ? (
              <div className="p-8 text-center font-mono text-xs text-gray-500">{t("common.loading")}</div>
            ) : revisions.length === 0 ? (
              <div className="p-8 text-center font-mono text-xs text-gray-500">
                {t("editor.history.empty")}
              </div>
            ) : (
              revisions.map((rev, idx) => {
                const isSelected = selectedRev?.id === rev.id;
                const isHead = idx === 0;
                const actionBadge = getActionBadge(rev.edit_type);

                return (
                  <button
                    key={rev.id}
                    onClick={() => setSelectedRev(rev)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all text-xs font-mono space-y-1.5 ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500/40 text-gray-900 dark:text-white shadow-xs"
                        : "bg-surface border-black/10 dark:border-white/[0.06] text-gray-600 dark:text-gray-400 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] hover:text-gray-900 dark:hover:text-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-200 flex items-center gap-1">
                        <GitCommit className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        Rev #{revisions.length - idx}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className={`px-1.5 py-0.2 rounded text-[9.5px] border font-medium ${actionBadge.color}`}>
                          {actionBadge.label}
                        </span>
                        {isHead && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 text-[9.5px] font-semibold">
                            HEAD
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-700 dark:text-gray-300 line-clamp-1">
                      {rev.edit_note || t("editor.history.defaultNote")}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-black/5 dark:border-white/[0.04]">
                      <span className="flex items-center gap-1 truncate max-w-[120px]">
                        <User className="w-3 h-3 shrink-0" />
                        {rev.editor?.username || "Community"}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />
                        {new Date(rev.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right Column: Selected Revision Details & Diff */}
          <div className="md:col-span-8 overflow-y-auto p-4 sm:p-5 space-y-4">
            {selectedRev ? (
              <div className="space-y-4">
                {/* Meta Box */}
                <div className="p-3.5 rounded-lg bg-black/[0.02] dark:bg-black/30 border border-black/10 dark:border-white/[0.08] space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-amber-600 dark:text-amber-400 font-semibold">
                        Revision {selectedRev.id.slice(0, 8)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono ${getActionBadge(selectedRev.edit_type).color}`}>
                        {getActionBadge(selectedRev.edit_type).label}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-gray-500">
                      {new Date(selectedRev.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
                    {selectedRev.edit_note || t("editor.history.defaultNote")}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500 font-mono pt-1">
                    <span className="flex items-center gap-1.5">
                      <span>{t("users.profile.tabs.artists")}:</span>
                      {selectedRev.editor?.id ? (
                        <Link href={`/users/${selectedRev.editor.id}`} className="text-primary hover:underline font-semibold">
                          @{selectedRev.editor.username}
                        </Link>
                      ) : (
                        <span className="text-gray-400">Community</span>
                      )}
                      {selectedRev.editor?.role && (
                        <UserRoleBadge role={selectedRev.editor.role} t={t} />
                      )}
                    </span>
                  </div>

                  {selectedRev.source_urls && selectedRev.source_urls.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-black/5 dark:border-white/[0.04]">
                      <div className="text-[10px] font-mono text-gray-500">{t("editor.history.sourcesLabel")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedRev.source_urls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline font-mono bg-sky-500/10 px-2 py-0.5 rounded"
                          >
                            <span className="max-w-xs truncate">{url}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Diff Viewer Component */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t("editor.diff.title")}</span>
                  </div>

                  <DiffViewer diff={selectedRev.diff} editType={selectedRev.edit_type} />
                </div>
              </div>
            ) : (
              <div className="p-12 text-center font-mono text-xs text-gray-500">
                {t("editor.history.selectHint")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
