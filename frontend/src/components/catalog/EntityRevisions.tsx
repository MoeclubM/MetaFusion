"use client";

import React, { useState, useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  GitCommit,
  GitBranch,
  GitCompare,
  History,
  User as UserIcon,
  ExternalLink,
  FileText,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowRight,
  Eye,
  Code,
  Shield,
  Layers,
  Sparkles,
} from "lucide-react";

export interface RevisionItem {
  id?: number | string;
  version: number;
  actor_id?: string;
  actor_name?: string;
  actor_role?: string;
  edit_note?: string;
  summary?: string;
  status?: string;
  sources?: Array<{ kind?: string; citation?: string; url?: string }>;
  snapshot?: any;
  created_at: string;
}

interface FieldDiff {
  key: string;
  label: string;
  oldVal: any;
  newVal: any;
  type: "added" | "removed" | "modified";
}

function formatVal(v: any, emptyLabel: string): string {
  if (v === null || v === undefined) return emptyLabel;
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function computeDiff(oldSnap: any = {}, newSnap: any = {}): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  // Top level primitive fields
  const checkField = (key: string, label: string) => {
    const o = oldSnap[key];
    const n = newSnap[key];
    if (o === undefined && n === undefined) return;
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      if (o === undefined) diffs.push({ key, label, oldVal: o, newVal: n, type: "added" });
      else if (n === undefined) diffs.push({ key, label, oldVal: o, newVal: n, type: "removed" });
      else diffs.push({ key, label, oldVal: o, newVal: n, type: "modified" });
    }
  };

  checkField("title", "field:title");
  checkField("kind", "field:kind");
  checkField("status", "field:status");
  checkField("original_language", "field:original_language");

  // Types array
  const oldTypes: string[] = oldSnap.types || [];
  const newTypes: string[] = newSnap.types || [];
  if (JSON.stringify(oldTypes) !== JSON.stringify(newTypes)) {
    diffs.push({
      key: "types",
      label: "field:types",
      oldVal: oldTypes.join(", ") || "\u0000",
      newVal: newTypes.join(", ") || "\u0000",
      type: "modified",
    });
  }

  // Attributes map
  const oldAttr: Record<string, any> = oldSnap.attributes || {};
  const newAttr: Record<string, any> = newSnap.attributes || {};
  const allAttrKeys = Array.from(new Set([...Object.keys(oldAttr), ...Object.keys(newAttr)]));
  for (const k of allAttrKeys) {
    const ov = oldAttr[k];
    const nv = newAttr[k];
    if (JSON.stringify(ov) !== JSON.stringify(nv)) {
      if (ov === undefined) {
        diffs.push({ key: "attributes." + k, label: "attr:" + k, oldVal: ov, newVal: nv, type: "added" });
      } else if (nv === undefined) {
        diffs.push({ key: "attributes." + k, label: "attr:" + k, oldVal: ov, newVal: nv, type: "removed" });
      } else {
        diffs.push({ key: "attributes." + k, label: "attr:" + k, oldVal: ov, newVal: nv, type: "modified" });
      }
    }
  }

  // Translations map
  const oldTrans: Record<string, any> = oldSnap.translations || {};
  const newTrans: Record<string, any> = newSnap.translations || {};
  const allTransKeys = Array.from(new Set([...Object.keys(oldTrans), ...Object.keys(newTrans)]));
  for (const lang of allTransKeys) {
    const ot = oldTrans[lang];
    const nt = newTrans[lang];
    if (JSON.stringify(ot) !== JSON.stringify(nt)) {
      diffs.push({
        key: "translations." + lang,
        label: "trans:" + lang,
        oldVal: ot ? ot.title || JSON.stringify(ot) : "\u0001",
        newVal: nt ? nt.title || JSON.stringify(nt) : "\u0001",
        type: ot === undefined ? "added" : nt === undefined ? "removed" : "modified",
      });
    }
  }

  // Pictures
  const oldPics = (oldSnap.pictures || []).map((p: any) => p.url).filter(Boolean);
  const newPics = (newSnap.pictures || []).map((p: any) => p.url).filter(Boolean);
  if (JSON.stringify(oldPics) !== JSON.stringify(newPics)) {
    diffs.push({
      key: "pictures",
      label: "field:pictures",
      oldVal: oldPics.join(", ") || "\u0002",
      newVal: newPics.join(", ") || "\u0002",
      type: "modified",
    });
  }

  return diffs;
}

function generateUnifiedDiff(oldObj: any, newObj: any, oldLabel: string, newLabel: string): string {
  const oldLines = JSON.stringify(oldObj, null, 2).split("\n");
  const newLines = JSON.stringify(newObj, null, 2).split("\n");

  const header = [
    "--- " + oldLabel,
    "+++ " + newLabel,
    "@@ -1," + oldLines.length + " +1," + newLines.length + " @@",
  ];

  const diffOutput: string[] = [...header];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (o !== undefined) diffOutput.push("  " + o);
    } else {
      if (o !== undefined) diffOutput.push("- " + o);
      if (n !== undefined) diffOutput.push("+ " + n);
    }
  }
  return diffOutput.join("\n");
}

export function EntityRevisions({
  revisions = [],
  currentEntity,
}: {
  revisions: RevisionItem[];
  currentEntity?: any;
}) {
  const { t } = useI18n();

  // Selected revision for snapshot viewing
  const [inspectingRev, setInspectingRev] = useState<RevisionItem | null>(null);

  // Selected revisions for diff comparison
  const [diffTarget, setDiffTarget] = useState<{ base: RevisionItem | null; current: RevisionItem | null } | null>(null);
  const [diffTab, setDiffTab] = useState<"visual" | "unified">("visual");

  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sort revisions newest first
  const sortedRevisions = useMemo(() => {
    return [...revisions].sort((a, b) => (b.version || 0) - (a.version || 0));
  }, [revisions]);

  // Contributors aggregate stats
  const anonymousName = t("revisions.anonymousEditor");
  const defaultRole = t("revisions.defaultRole");
  const contributorStats = useMemo(() => {
    const map = new Map<string, { name: string; role: string; count: number }>();
    for (const r of sortedRevisions) {
      const name = r.actor_name || anonymousName;
      const role = r.actor_role || defaultRole;
      const existing = map.get(name) || { name, role, count: 0 };
      existing.count += 1;
      map.set(name, existing);
    }
    return Array.from(map.values());
  }, [sortedRevisions, anonymousName, defaultRole]);

  const handleCopy = (text: string, id: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  // Compare with previous revision
  const handleCompareWithPrev = (curr: RevisionItem, idx: number) => {
    const prev = sortedRevisions[idx + 1] || null;
    setDiffTarget({ base: prev, current: curr });
  };

  const diffLabel = (label: string): string => {
    if (label.startsWith("field:")) {
      const field = label.slice("field:".length);
      const known: Record<string, string> = {
        title: t("revisions.fieldTitle"),
        kind: t("revisions.fieldKind"),
        status: t("revisions.fieldStatus"),
        original_language: t("revisions.fieldOriginalLanguage"),
        types: t("revisions.fieldTypes"),
        pictures: t("revisions.fieldPictures"),
      };
      return known[field] || field;
    }
    if (label.startsWith("attr:")) return t("revisions.fieldAttr", { key: label.slice("attr:".length) });
    if (label.startsWith("trans:")) return t("revisions.fieldTrans", { lang: label.slice("trans:".length) });
    return label;
  };

  const diffVal = (v: any): string => {
    if (v === "\u0000") return t("revisions.emptyValue");
    if (v === "\u0001") return t("revisions.unsetValue");
    if (v === "\u0002") return t("revisions.noPictures");
    return formatVal(v, t("revisions.emptyValue"));
  };

  // Compute diff fields if diffTarget is active
  const systemActor = t("revisions.systemActor");
  const initialLabel = t("revisions.initialVersion");
  const activeDiff = useMemo(() => {
    if (!diffTarget?.current) return null;
    const baseSnap = diffTarget.base ? diffTarget.base.snapshot || diffTarget.base : {};
    const currSnap = diffTarget.current.snapshot || diffTarget.current;
    const fields = computeDiff(baseSnap, currSnap);
    const oldLabel = diffTarget.base ? "v" + diffTarget.base.version + " (" + (diffTarget.base.actor_name || systemActor) + ")" : initialLabel;
    const newLabel = "v" + diffTarget.current.version + " (" + (diffTarget.current.actor_name || systemActor) + ")";
    const unified = generateUnifiedDiff(baseSnap, currSnap, oldLabel, newLabel);
    return { fields, unified, oldLabel, newLabel };
  }, [diffTarget, systemActor, initialLabel]);

  return (
    <div className="space-y-6">
      {/* Top Header & Contributor Summary (Git Insights Style) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-2xs">
            <GitBranch className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-white text-sm">
                {t("revisions.mainLog")}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-mono font-bold">
                {t("revisions.commitsUnit", { count: sortedRevisions.length })}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {t("revisions.appendOnly")}
            </p>
          </div>
        </div>

        {/* Contributors Avatars */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-400 hidden md:inline">
            {t("revisions.contributors")}
          </span>
          <div className="flex items-center -space-x-1.5 overflow-hidden">
            {contributorStats.map((c, idx) => (
              <div
                key={idx}
                title={t("revisions.contribCountTitle", { name: c.name, count: c.count })}
                className="w-7 h-7 rounded-full bg-surface border-2 border-surface flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-200 shadow-xs cursor-default ring-1 ring-black/10 dark:ring-white/10"
              >
                {c.name.slice(0, 1).toUpperCase()}
              </div>
            ))}
          </div>
          <span className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300 ml-1">
            {contributorStats.map(c => "@" + c.name).join(", ")}
          </span>
        </div>
      </div>

      {/* Diff Inspector Modal / Banner (If Active) */}
      {diffTarget && activeDiff && (
        <div className="p-5 rounded-xl border border-primary/30 bg-primary/[0.02] dark:bg-primary/[0.04] space-y-4 animate-scale-in shadow-soft">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-primary/20 pb-3">
            <div className="flex items-center gap-2.5">
              <GitCompare className="w-5 h-5 text-primary shrink-0" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                  <span>{t("revisions.diffInspector")}</span>
                  <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs font-mono">
                    {activeDiff.oldLabel} → {activeDiff.newLabel}
                  </span>
                </h3>
                <p className="text-[11px] font-mono text-gray-500 mt-0.5">
                  {t("revisions.fieldsChanged", { count: activeDiff.fields.length })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-black/[0.04] dark:bg-white/[0.06] p-0.5 rounded-lg border border-black/5 dark:border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setDiffTab("visual")}
                  className={"px-2.5 py-1 rounded-md transition-all " + (diffTab === "visual" ? "bg-surface text-primary font-bold shadow-2xs" : "text-gray-500 hover:text-gray-900 dark:hover:text-white")}
                >
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{t("revisions.visualView")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDiffTab("unified")}
                  className={"px-2.5 py-1 rounded-md transition-all " + (diffTab === "unified" ? "bg-surface text-primary font-bold shadow-2xs" : "text-gray-500 hover:text-gray-900 dark:hover:text-white")}
                >
                  <span className="flex items-center gap-1"><Code className="w-3.5 h-3.5" />{t("revisions.unifiedView")}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDiffTarget(null)}
                className="px-2.5 py-1 rounded-lg text-xs font-mono bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition-colors"
              >
                {t("revisions.closeDiff")}
              </button>
            </div>
          </div>

          {diffTab === "visual" ? (
            activeDiff.fields.length === 0 ? (
              <div className="p-6 text-center text-xs font-mono text-gray-500 bg-surface rounded-lg border border-black/5 dark:border-white/5">
                {t("revisions.noDiff")}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 font-mono text-xs">
                {activeDiff.fields.map((f, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface shadow-2xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        {diffLabel(f.label)}
                      </span>
                      <span className={"px-1.5 py-0.2 rounded text-[10px] uppercase font-bold " + (
                        f.type === "added"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : f.type === "removed"
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      )}>
                        {f.type}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                      <div className="p-2 rounded bg-rose-500/[0.06] dark:bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 break-all whitespace-pre-wrap">
                        <div className="text-[9px] uppercase tracking-wider text-rose-500 font-bold mb-0.5">{t("revisions.oldVersion", { version: diffTarget.base?.version || 0 })}</div>
                        {diffVal(f.oldVal)}
                      </div>
                      <div className="p-2 rounded bg-emerald-500/[0.06] dark:bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 break-all whitespace-pre-wrap">
                        <div className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold mb-0.5">{t("revisions.newVersion", { version: diffTarget.current?.version || 0 })}</div>
                        {diffVal(f.newVal)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="relative">
              <pre className="p-3.5 rounded-lg bg-black/[0.04] dark:bg-black/50 border border-black/10 dark:border-white/10 font-mono text-[11px] text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 leading-relaxed">
                {activeDiff.unified}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(activeDiff.unified, "diff-copy")}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-surface border border-black/10 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white shadow-xs text-xs flex items-center gap-1"
                title={t("revisions.copyDiffTitle")}
              >
                {copiedId === "diff-copy" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Snapshot Inspector Modal / Banner (If Active) */}
      {inspectingRev && (
        <div className="p-5 rounded-xl border border-sky-500/30 bg-sky-500/[0.02] dark:bg-sky-500/[0.04] space-y-3 animate-scale-in shadow-soft">
          <div className="flex items-center justify-between border-b border-sky-500/20 pb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                {t("revisions.snapshotAt", { version: inspectingRev.version })}
              </h3>
              <span className="text-xs font-mono text-gray-500">
                ({new Date(inspectingRev.created_at).toLocaleString()})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(JSON.stringify(inspectingRev.snapshot || inspectingRev, null, 2), "snap-copy")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-xs font-mono text-gray-700 dark:text-gray-300 hover:text-primary transition-colors shadow-2xs"
              >
                {copiedId === "snap-copy" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedId === "snap-copy" ? t("revisions.copied") : t("revisions.copyJson")}</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectingRev(null)}
                className="px-2.5 py-1 rounded-lg text-xs font-mono bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-300 transition-colors"
              >
                {t("revisions.close")}
              </button>
            </div>
          </div>

          <pre className="p-3.5 rounded-lg bg-black/[0.04] dark:bg-black/50 border border-black/10 dark:border-white/10 font-mono text-[11px] text-gray-800 dark:text-gray-200 overflow-x-auto max-h-80 leading-relaxed">
            {JSON.stringify(inspectingRev.snapshot || inspectingRev, null, 2)}
          </pre>
        </div>
      )}

      {/* Git Commit Tree & History List */}
      <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-2.5 sm:before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-linear-to-b before:from-primary before:via-primary/30 before:to-transparent">
        {sortedRevisions.map((rev, idx) => {
          const revKey = String(rev.id || idx);
          const author = rev.actor_name || anonymousName;
          const role = rev.actor_role || defaultRole;
          const note = rev.edit_note || rev.summary || (idx === sortedRevisions.length - 1 ? t("revisions.initialNote") : t("revisions.updateNote"));
          const sources = rev.sources || [];
          const isLatest = idx === 0;

          return (
            <div key={revKey} className="relative group">
              {/* Commit Node Icon */}
              <div
                className={"absolute -left-6 sm:-left-8 top-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shadow-xs transition-transform group-hover:scale-110 " + (
                  isLatest
                    ? "border-primary bg-primary text-white"
                    : "border-black/20 dark:border-white/20 bg-surface text-gray-500 group-hover:border-primary group-hover:text-primary"
                )}
              >
                <div className={"w-1.5 h-1.5 rounded-full " + (isLatest ? "bg-white" : "bg-primary")} />
              </div>

              {/* Commit Card */}
              <div className="p-4 rounded-xl border border-black/10 dark:border-white/[0.08] bg-surface hover:shadow-soft transition-all space-y-3">
                {/* Commit Top Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/5 dark:border-white/[0.06] pb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={"px-2 py-0.5 rounded-md text-[11px] font-mono font-bold uppercase " + (
                      isLatest
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "bg-black/[0.04] dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 border border-black/10 dark:border-white/10"
                    )}>
                      v{rev.version || sortedRevisions.length - idx}
                    </span>

                    {isLatest && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold">
                        HEAD / LATEST
                      </span>
                    )}

                    <span className="font-mono text-[11px] text-gray-400">
                      rev #{rev.id || idx + 1}
                    </span>

                    <span className="text-gray-300 dark:text-gray-600">•</span>

                    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                      <div className="w-4 h-4 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-[9px]">
                        {author.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-white">@{author}</span>
                      <span className="px-1 rounded bg-black/[0.04] dark:bg-white/[0.06] text-[10px] font-mono text-gray-500 uppercase">
                        {role}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-mono text-gray-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(rev.created_at).toLocaleString()}</span>
                  </div>
                </div>

                {/* Commit Message (edit_note) */}
                <div className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">
                  {note}
                </div>

                {/* Commit Evidence / Sources List */}
                {sources.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setExpandedSources(prev => ({ ...prev, [revKey]: !prev[revKey] }))}
                      className="inline-flex items-center gap-1.5 text-[11px] font-mono text-primary hover:underline cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>{t("revisions.evidenceSources", { count: sources.length })}</span>
                      {expandedSources[revKey] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {expandedSources[revKey] && (
                      <div className="mt-2 p-2.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1.5 text-xs font-mono animate-fade-in">
                        {sources.map((s: any, sIdx: number) => (
                          <div key={sIdx} className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
                            <span className="text-primary font-bold">[{s.kind || "url"}]</span>
                            <span className="text-gray-800 dark:text-gray-200 font-medium">{s.citation || t("revisions.officialSource")}</span>
                            {s.url && (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline truncate max-w-xs sm:max-w-md inline-block"
                              >
                                {s.url}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Revision Action Tools */}
                <div className="pt-2 border-t border-black/5 dark:border-white/[0.04] flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    {/* Compare with previous */}
                    {idx < sortedRevisions.length - 1 && (
                      <button
                        type="button"
                        onClick={() => handleCompareWithPrev(rev, idx)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-primary/15 hover:text-primary text-gray-700 dark:text-gray-300 transition-colors cursor-pointer shadow-2xs"
                      >
                        <GitCompare className="w-3 h-3 text-amber-500" />
                        <span>{t("revisions.diffVsPrev")}</span>
                      </button>
                    )}

                    {/* View full snapshot */}
                    <button
                      type="button"
                      onClick={() => setInspectingRev(rev)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.06] hover:bg-sky-500/15 hover:text-sky-500 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Eye className="w-3 h-3 text-sky-500" />
                      <span>{t("revisions.snapshot")}</span>
                    </button>
                  </div>

                  <span className="text-[10px] text-gray-400">
                    {t("revisions.immutableBadge")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
