"use client";

import React, { useEffect, useState } from "react";
import { X, History, User, Clock, ArrowRight, ExternalLink, GitCommit, FileText, CheckCircle2 } from "lucide-react";
import { fetchEntityRevisions, EntityRevision } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DiffViewer } from "./DiffViewer";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetType: "work" | "artist" | "release";
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg border border-white/10 bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-background/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 grid place-items-center">
              <History className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                {t("editor.history.title")}
              </h2>
              <p className="font-mono text-xs text-gray-400 truncate max-w-md">
                {entityTitle} · {targetType.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Layout: Left Revision List, Right Diff View */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-white/[0.08]">
          {/* Left Column: Revision Timeline List */}
          <div className="md:col-span-4 overflow-y-auto p-4 space-y-2 bg-background/30">
            <div className="text-[11px] font-mono text-gray-500 uppercase tracking-wider px-2 pb-1">
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
                return (
                  <button
                    key={rev.id}
                    onClick={() => setSelectedRev(rev)}
                    className={`w-full text-left p-3 rounded-card border transition-all text-xs font-mono space-y-1.5 ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500/30 text-white shadow-soft"
                        : "bg-surface/50 border-white/[0.04] text-gray-400 hover:bg-white/[0.03] hover:text-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-200 flex items-center gap-1.5">
                        <GitCommit className="w-3.5 h-3.5 text-amber-400" />
                        Rev #{revisions.length - idx}
                      </span>
                      {isHead && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                          {t("editor.history.currentBadge")}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-gray-300 line-clamp-1">
                      {rev.edit_note || "元数据修订"}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-white/[0.04]">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {rev.editor?.username || "Community"}
                      </span>
                      <span className="flex items-center gap-1">
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
          <div className="md:col-span-8 overflow-y-auto p-6 space-y-5">
            {selectedRev ? (
              <div className="space-y-5">
                {/* Meta Box */}
                <div className="p-4 rounded-card bg-background/60 border border-white/[0.08] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-amber-400 font-semibold">
                      Revision {selectedRev.id.slice(0, 8)}
                    </span>
                    <span className="font-mono text-[11px] text-gray-500">
                      {new Date(selectedRev.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-sm font-medium text-white">
                    {selectedRev.edit_note || "元数据修订"}
                  </div>

                  {selectedRev.source_urls && selectedRev.source_urls.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-white/[0.04]">
                      <div className="text-[10px] font-mono text-gray-500">参考考据链接 (Sources):</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedRev.source_urls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline font-mono bg-sky-500/10 px-2 py-0.5 rounded"
                          >
                            <span>{url}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Diff Viewer Component */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t("editor.diff.title")}</span>
                  </div>

                  <DiffViewer diff={selectedRev.diff} editType={selectedRev.edit_type} />
                </div>
              </div>
            ) : (
              <div className="p-12 text-center font-mono text-xs text-gray-500">
                请在左侧选择一次修订历史以查看字段差异
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
