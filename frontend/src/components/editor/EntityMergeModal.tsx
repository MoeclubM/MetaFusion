"use client";

import React, { useState } from "react";
import { X, GitMerge, AlertTriangle, CheckCircle2, Lock, LogIn } from "lucide-react";
import Link from "next/link";
import { catalogEntityHref, isCatalogHub, mergeEntities } from "@/lib/api";
import { localizeCatalogError } from "@/lib/catalogErrors";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 实体 kind：决定合并后跳转的详情路由。 */
  targetType: string;
  sourceEntity: {
    id: string;
    title: string;
    sub?: string;
  };
  onMergeSuccess?: (targetId: string) => void;
}

export function EntityMergeModal({ isOpen, onClose, targetType, sourceEntity, onMergeSuccess }: Props) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [targetId, setTargetId] = useState("");
  const [mergeNote, setMergeNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError(t("editor.universal.needLoginToSave"));
      return;
    }
    if (!targetId.trim()) {
      setError(t("editor.merge.targetUuidPlaceholder"));
      return;
    }
    if (!mergeNote.trim()) {
      setError(t("editor.merge.notePlaceholder"));
      return;
    }
    // 自合并（源与目标同一条）服务端必然回 invalid_merge_target：先在本地拦掉并讲清楚原因。
    if (targetId.trim() === sourceEntity.id) {
      setError(t("catalog.error.invalidMergeTarget"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await mergeEntities({
        source_id: sourceEntity.id,
        target_id: targetId.trim(),
        merge_note: mergeNote.trim(),
        source_urls: sourceUrl.trim() ? [sourceUrl.trim()] : [],
        // 没填考据链接时的 self 来源文案：用既有键，不硬编码中文。
        citation: t("editor.merge.title"),
      });
      alert(res.message || t("editor.merge.successAlert"));
      onClose();
      if (onMergeSuccess) {
        onMergeSuccess(res.target_id);
      } else {
        // 合并后目标实体可能已改为重定向行，硬跳转到它的详情页。kind 走 CATALOG_HUBS 白名单、
        // id 必须是 UUID，二者都校验后再拼地址，不把接口返回值原样当 URL。
        const kind = isCatalogHub(targetType) ? targetType : "work";
        const id = String(res.target_id || "");
        window.location.href = UUID_PATTERN.test(id) ? catalogEntityHref(kind, id) : "/";
      }
    } catch (err: any) {
      // 后端给稳定错误码（invalid_merge_target / invalid_status / evidence_required …）：
      // 走码表翻成人话，未知码才回退原文，不把裸码直接贴给用户。
      setError(localizeCatalogError(String(err?.message || ""), t) || t("editor.merge.failedMsg"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl flex flex-col rounded-lg border border-line bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-emphasis/[0.08] bg-background/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-purple-500/10 border border-purple-500/20 grid place-items-center">
              <GitMerge className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-emphasis flex items-center gap-2">
                {t("editor.merge.title")}
              </h2>
              <p className="font-mono text-[10px] text-gray-400">
                {targetType.toUpperCase()}: {sourceEntity.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("revisions.close")}
            className="w-7 h-7 grid place-items-center rounded-md hover:bg-emphasis/10 text-gray-400 hover:text-emphasis transition-colors duration-fast ease-soft"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Callout */}
        <div className="mx-5 mt-3.5 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>{t("editor.merge.cautionLabel")}</span>
          </div>
          <p className="text-[11px] text-amber-200/90 leading-relaxed font-mono">
            {t("editor.merge.warning")}
          </p>
        </div>

        {/* Auth warning if not logged in */}
        {!user && (
          <div className="mx-5 mt-2.5 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 flex items-center justify-between gap-2.5 text-xs text-rose-200">
            <div className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>{t("editor.universal.unauthWarning")}</span>
            </div>
            <Link
              href="/login"
              className="px-2.5 py-1 rounded-md bg-rose-400 text-black font-semibold text-xs inline-flex items-center gap-1 shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{t("editor.universal.loginNow")}</span>
            </Link>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3 font-mono text-xs">
          {/* Source Entity Info */}
          <div className="space-y-1">
            <label className="text-gray-400 text-[10px] uppercase tracking-wider">{t("editor.merge.sourceEntity")}</label>
            <div className="p-2.5 rounded-md bg-background/70 border border-line text-emphasis flex items-center justify-between">
              <div>
                <span className="font-semibold text-xs">{sourceEntity.title}</span>
                {sourceEntity.sub && <span className="text-gray-400 ml-2 text-[11px]">({sourceEntity.sub})</span>}
              </div>
              <span className="text-[10px] text-gray-500 font-mono">{sourceEntity.id}</span>
            </div>
          </div>

          {/* Target UUID Input */}
          <div className="space-y-1">
            <label className="block text-gray-300 font-semibold text-[10px] uppercase tracking-wider">
              {t("editor.merge.targetUuidLabel")} <span className="text-purple-400">*</span>
            </label>
            <input
              type="text"
              required
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder={t("editor.merge.targetUuidPlaceholder")}
              className="w-full px-3 h-10 rounded-md bg-background border border-line text-emphasis font-mono text-xs focus:outline-none focus:border-purple-400"
            />
          </div>

          {/* Merge Note */}
          <div className="space-y-1">
            <label className="block text-gray-300 font-semibold text-[10px] uppercase tracking-wider">
              {t("editor.merge.noteLabel")} <span className="text-purple-400">*</span>
            </label>
            <textarea
              rows={2}
              required
              value={mergeNote}
              onChange={(e) => setMergeNote(e.target.value)}
              placeholder={t("editor.merge.notePlaceholder")}
              className="w-full p-2.5 rounded-md bg-background border border-line text-emphasis text-xs leading-relaxed resize-none focus:outline-none focus:border-purple-400"
            />
          </div>

          {/* Source URL */}
          <div className="space-y-1">
            <label className="block text-gray-300 text-[10px] uppercase tracking-wider">
              {t("editor.merge.sourceUrlLabel")}
            </label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://musicbrainz.org/artist/..."
              className="w-full px-3 h-10 rounded-md bg-background border border-line text-emphasis font-mono text-xs focus:outline-none focus:border-purple-400"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-emphasis/[0.08]">
            <span className="text-gray-500 text-[10px] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
              <span>{t("editor.merge.footerSnapshot")}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 h-7 rounded-md border border-line text-xs text-gray-300 hover:bg-emphasis/10 transition-colors duration-fast ease-soft"
              >
                {t("editor.universal.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting || !user}
                className="px-3.5 h-7 rounded-md bg-purple-500 hover:bg-purple-400 text-emphasis text-xs font-semibold flex items-center gap-1.5 transition-colors duration-fast ease-soft disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>{submitting ? t("editor.merge.submitting") : t("editor.merge.submitBtn")}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
