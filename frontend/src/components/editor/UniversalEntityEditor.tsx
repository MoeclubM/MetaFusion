"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  Save,
  Link as LinkIcon,
  Globe,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Lock,
  LogIn,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  updateWork,
  updateArtist,
  updateRelease,
  updateFranchise,
  updateCanonicalEntry,
  fetchApi,
  catalogHubOf,
} from "@/lib/api";
import { useRelationTypes } from "@/hooks/useRelationTypes";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { EditorCoreFields } from "./EditorCoreFields";
import { EditorTemporalFields } from "./EditorTemporalFields";
import { EditorRelationsField } from "./EditorRelationsField";
import { EditorExternalIds } from "./EditorExternalIds";
import { EditorNotesField } from "./EditorNotesField";
import { DynamicAttributeForm } from "@/components/attributes/DynamicAttributeForm";
import { seedLocaleForm, translationsPayload } from "./localeForm";

export type EntityTypeTarget = "work" | "artist" | "release" | "franchise" | "canonical_entry";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetType: EntityTypeTarget;
  mode: "create" | "edit";
  initialData?: Record<string, any>;
  onSuccess?: (savedData: any) => void;
  isFullPage?: boolean;
}

export function UniversalEntityEditor({
  isOpen,
  onClose,
  targetType,
  mode,
  initialData = {},
  onSuccess,
  isFullPage = false,
}: Props) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const { relationTypes } = useRelationTypes();
  const { taxonomy } = useTaxonomy();
  const [activeTab, setActiveTab] = useState<"core" | "temporal" | "attributes" | "relations" | "external" | "note">("core");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form State
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [aliasesStr, setAliasesStr] = useState("");
  const [sourceUrlsStr, setSourceUrlsStr] = useState("");
  const [editNote, setEditNote] = useState("");
  const [relations, setRelations] = useState<
    Array<{
      target_id: string;
      target_type: string;
      relationship_type: string;
      qualifier?: string;
      begin_date?: string;
      end_date?: string;
      ended?: boolean;
      target_label?: string;
    }>
  >([]);

  useEffect(() => {
    if (isOpen) {
      initializeForm();
    }
  }, [isOpen, initialData?.id, targetType, mode]);

  useEffect(() => {
    if (targetType === "artist" && taxonomy?.entity_types?.[0]?.id) {
      setFormData((prev) => {
        if (!prev.entity_type) {
          return { ...prev, entity_type: taxonomy.entity_types[0].id };
        }
        return prev;
      });
    }
  }, [targetType, taxonomy]);

  const initializeForm = () => {
    const d = { ...initialData };
    if (targetType === "artist" && !d.entity_type) {
      d.entity_type = taxonomy?.entity_types?.[0]?.id || "";
    }
    if (targetType === "work" || targetType === "artist" || targetType === "franchise") {
      const seeded = seedLocaleForm(d, mode, locale);
      d.translations = seeded.translations;
      d.language = seeded.language;
    }
    setFormData(d);
    if (Array.isArray(d.aliases)) {
      setAliasesStr(d.aliases.join(", "));
    } else {
      setAliasesStr(d.aliases || "");
    }
    setSourceUrlsStr(Array.isArray(d.source_urls) ? d.source_urls.join("\n") : "");
    setEditNote(d.edit_note || "");
    setError("");
  };

  if (!isOpen) return null;

  const updateField = (key: string, val: any) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
  };

  const updateExternalId = (key: string, val: string) => {
    setFormData((prev) => ({
      ...prev,
      external_ids: {
        ...(prev.external_ids || {}),
        [key]: val,
      },
    }));
  };

  const addRelationRow = () => {
    const defaultType = relationTypes[0]?.code || "related";
    const defaultTarget = catalogHubOf(
      (relationTypes[0]?.allowed_target_types || [])[0] || "work"
    );
    setRelations((prev) => [
      ...prev,
      {
        target_id: "",
        target_type: defaultTarget,
        relationship_type: defaultType,
        qualifier: "",
        begin_date: "",
        end_date: "",
        ended: false,
      },
    ]);
  };

  const removeRelationRow = (idx: number) => {
    setRelations((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRelationRow = (idx: number, patch: Partial<(typeof relations)[0]>) => {
    setRelations((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError(t("editor.universal.needLoginToSave"));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const aliases = aliasesStr
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const sourceUrls = sourceUrlsStr
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, any> = {
        ...formData,
        aliases: aliases.length > 0 ? aliases : undefined,
        edit_note: editNote || (mode === "edit" ? t("editor.universal.defaultEditNote") : t("editor.universal.defaultCreateNote")),
        source_urls: sourceUrls,
      };

      if (targetType === "work" || targetType === "artist" || targetType === "franchise") {
        const translations = (formData.translations || {}) as Record<string, { title: string; summary: string }>;
        const defaultLoc = formData.language || "zh-CN";
        const def = translations[defaultLoc] || { title: "", summary: "" };
        payload.translations = translationsPayload(translations);
        payload.language = defaultLoc;
        delete payload.names;
        delete payload.romaji;
        if (targetType === "artist") {
          payload.name = def.title || formData.name;
          payload.biography = def.summary || formData.biography;
        } else {
          payload.title = def.title || formData.title;
          payload.summary = def.summary || formData.summary;
        }
        const romaji = typeof formData.romaji === "string" ? formData.romaji.trim() : "";
        if (romaji) {
          const merged = [...(aliases || [])];
          if (!merged.includes(romaji)) merged.push(romaji);
          payload.aliases = merged;
        }
        if (targetType === "work" || targetType === "franchise") {
          payload.tags = Array.isArray(formData.tags)
            ? formData.tags.map((t: any) => (typeof t === "string" ? t : t.name)).filter(Boolean)
            : [];
        }
        const displayName = targetType === "artist" ? payload.name : payload.title;
        if (!String(displayName || "").trim()) {
          setError(t("editor.core.defaultTitleRequired"));
          setSubmitting(false);
          return;
        }
      }

      if (targetType === "canonical_entry") {
        payload.title = String(formData.title || "").trim();
        if (!payload.title) {
          setError(t("editor.core.defaultTitleRequired"));
          setSubmitting(false);
          return;
        }
        payload.duration_seconds = Number(formData.duration_seconds ?? formData.duration) || 0;
        payload.isrc = formData.isrc ? String(formData.isrc).trim() : "";
        payload.isbn = formData.isbn ? String(formData.isbn).trim() : "";
        payload.artist_credit = formData.artist_credit ? String(formData.artist_credit).trim() : "";
        payload.sort_title = formData.sort_title ? String(formData.sort_title).trim() : "";
        payload.recording_date = formData.recording_date ? String(formData.recording_date).trim() : "";
      }

      let result: any = null;

      if (mode === "edit") {
        if (targetType === "work") {
          result = await updateWork(initialData.id, payload);
        } else if (targetType === "artist") {
          result = await updateArtist(initialData.id, payload);
        } else if (targetType === "release") {
          result = await updateRelease(initialData.id, payload);
        } else if (targetType === "franchise") {
          result = await updateFranchise(initialData.id, payload);
        } else if (targetType === "canonical_entry") {
          result = await updateCanonicalEntry(initialData.id, payload);
        }
      } else {
        // Create mode
        if (targetType === "work") {
          result = await fetchApi("/catalog/works", { method: "POST", body: JSON.stringify(payload) });
        } else if (targetType === "artist") {
          result = await fetchApi("/catalog/artists", { method: "POST", body: JSON.stringify(payload) });
        } else if (targetType === "release") {
          result = await fetchApi("/catalog/releases", { method: "POST", body: JSON.stringify(payload) });
        } else if (targetType === "franchise") {
          result = await fetchApi("/catalog/franchises", { method: "POST", body: JSON.stringify(payload) });
        } else if (targetType === "canonical_entry") {
          result = await fetchApi("/catalog/canonical-entries", { method: "POST", body: JSON.stringify(payload) });
        }
      }

      if (relations.length > 0 && (initialData.id || result?.work?.id || result?.artist?.id || result?.franchise?.id || result?.id)) {
        const entityId = initialData.id || result?.work?.id || result?.artist?.id || result?.franchise?.id || result?.id;
        const formattedRels = relations
          .filter((r) => r.target_id.trim())
          .map((r) => ({
            source_type: targetType,
            source_id: entityId,
            target_type: r.target_type || "artist",
            target_id: r.target_id.trim(),
            relationship_type: r.relationship_type,
            qualifier: r.qualifier || "",
            begin_date: r.begin_date || undefined,
            end_date: r.end_date || undefined,
            ended: r.ended || false,
            attributes: r.qualifier ? { locale: r.qualifier } : {},
          }));
        if (formattedRels.length > 0) {
          await fetchApi("/catalog/entity-relations", {
            method: "PUT",
            body: JSON.stringify({ relations: formattedRels }),
          });
        }
      }

      onClose();
      if (onSuccess) onSuccess(result);
      else window.location.reload();
    } catch (err: any) {
      setError(err.message || t("editor.universal.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const containerClasses = isFullPage
    ? "w-full max-w-4xl mx-auto rounded-lg border border-black/10 dark:border-white/10 bg-surface shadow-2xl overflow-hidden my-5"
    : "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in";

  const modalInnerClasses = isFullPage
    ? "w-full flex flex-col"
    : "w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg border border-black/10 dark:border-white/10 bg-surface shadow-2xl overflow-hidden";

  return (
    <div className={containerClasses}>
      <div className={modalInnerClasses}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/10 dark:border-white/[0.08] bg-background/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-amber-500/10 border border-amber-500/20 grid place-items-center">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                {mode === "edit" ? t("editor.universal.editTitle") : t("editor.universal.createTitle")}
              </h2>
              <p className="font-mono text-xs text-gray-500 truncate max-w-md">
                {targetType.toUpperCase()}: {formData.title || formData.name || formData.edition_name || t("editor.universal.newEntry")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Auth Warning if not logged in */}
        {!user && (
          <div className="mx-6 mt-4 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t("editor.universal.unauthWarning")}</span>
            </div>
            <Link
              href={`/login?redirect=${encodeURIComponent(pathname || "/")}`}
              className="px-3.5 py-1.5 rounded-full bg-amber-400 text-black font-semibold font-mono text-xs inline-flex items-center gap-1 hover:bg-amber-300 transition-colors shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              {t("editor.universal.loginNow")}
            </Link>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 px-6 pt-3 border-b border-black/5 dark:border-white/[0.06] bg-background/30 font-mono text-xs sm:text-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("core")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "core"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <FileText className="w-4 h-4" />
            {t("editor.universal.tabCore")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("temporal")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "temporal"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <Clock className="w-4 h-4" />
            {t("editor.universal.tabTemporal")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("attributes")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "attributes"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <Layers className="w-4 h-4" />
            {t("attributes.title")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("relations")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "relations"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <LinkIcon className="w-4 h-4" />
            {t("editor.universal.tabRelations")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("external")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "external"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <Globe className="w-4 h-4" />
            {t("editor.universal.tabExternal")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("note")}
            className={`px-4 py-2.5 rounded-t-sm border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "note"
                ? "border-amber-400 text-gray-900 dark:text-white bg-black/[0.03] dark:bg-white/[0.04] font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            {t("editor.universal.tabNote")}
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "core" && (
            <EditorCoreFields
              targetType={targetType}
              formData={formData}
              updateField={updateField}
              aliasesStr={aliasesStr}
              setAliasesStr={setAliasesStr}
              taxonomy={taxonomy}
            />
          )}

          {activeTab === "temporal" && (
            <EditorTemporalFields
              formData={formData}
              updateField={updateField}
              targetType={targetType}
            />
          )}

          {activeTab === "attributes" && (
            <DynamicAttributeForm
              entityType={targetType}
              category={formData.category_code}
              value={formData.attributes || {}}
              onChange={(attrs) => updateField("attributes", attrs)}
            />
          )}

          {activeTab === "relations" && (
            <EditorRelationsField
              relations={relations}
              relationTypes={relationTypes}
              sourceType={targetType}
              sourceEntityType={formData.entity_type}
              addRelationRow={addRelationRow}
              removeRelationRow={removeRelationRow}
              updateRelationRow={updateRelationRow}
            />
          )}

          {activeTab === "external" && (
            <EditorExternalIds
              externalIds={formData.external_ids || {}}
              updateExternalId={updateExternalId}
              category={targetType}
            />
          )}

          {activeTab === "note" && (
            <EditorNotesField
              editNote={editNote}
              setEditNote={setEditNote}
              sourceUrlsStr={sourceUrlsStr}
              setSourceUrlsStr={setSourceUrlsStr}
              mode={mode}
            />
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-black/10 dark:border-white/[0.08]">
            <span className="font-mono text-xs text-gray-500 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{t("editor.universal.footerNote")}</span>
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 h-10 rounded-lg border border-black/10 dark:border-white/10 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                {t("editor.universal.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting || !user}
                className="px-5 h-10 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>
                  {submitting
                    ? t("editor.universal.saving")
                    : !user
                    ? t("editor.universal.needLoginToSave")
                    : mode === "edit"
                    ? t("editor.universal.saveEdit")
                    : t("editor.universal.saveCreate")}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
