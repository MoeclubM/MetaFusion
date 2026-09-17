"use client";

// 自定义首页推荐弹窗：分区编辑器。
// 设计口径（与用户诉求一致）：系统预设只是**模板**，用户在这里改的是自己的偏好副本
// ——改标题 / 换规则 / 换图标 / 调顺序 / 隐藏，或从模板复制出自建分区；
// 系统货架本身不被改动，也不影响别人。
import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { DynamicDefinitions } from "@/lib/definitions";
import { SectionRuleEditor } from "@/components/home/SectionRuleEditor";
import {
  buildRows,
  describeRule,
  hasRequiredName,
  iconFor,
  isValidSlug,
  revertToTemplate,
  rowFromScratch,
  rowFromTemplate,
  shelfTitle,
  toPreferences,
  type HomePreferences,
  type SectionRow,
  type ShelfLike,
} from "@/lib/homeSections";

/** feed 里的一条分区：弹窗只用得到货架定义与条目数。 */
type FeedLike = { shelf: ShelfLike; items?: unknown[] };

type Props = {
  open: boolean;
  loading: boolean;
  prefs: HomePreferences;
  /** GET /catalog/shelves 的系统预设：既是"从模板添加"的候选，也是隐藏行的定义来源。 */
  templates: ShelfLike[];
  feedSections: FeedLike[];
  defs: DynamicDefinitions | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: HomePreferences) => void;
  onReset: () => void;
};

export function HomeCustomizeModal({
  open,
  loading,
  prefs,
  templates,
  feedSections,
  defs,
  saving,
  error,
  onClose,
  onSave,
  onReset,
}: Props) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<SectionRow[]>([]);
  // 展开单个分区：面板本身很长，同时展开多行会把列表挤没。
  const [expanded, setExpanded] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [localError, setLocalError] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const section of feedSections) map.set(section.shelf.slug, (section.items || []).length);
    return map;
  }, [feedSections]);

  // 打开（或偏好加载完成）时用服务端数据重建行；加载中不重建，避免把用户的编辑冲掉。
  useEffect(() => {
    if (!open || loading) return;
    setRows(buildRows(prefs, templates, feedSections.map((s) => s.shelf)));
    setExpanded(null);
    setPicking(false);
    setLocalError("");
  }, [open, loading, prefs, templates, feedSections]);

  if (!open) return null;

  const taken = new Set(rows.map((r) => r.slug));

  const patchRow = (index: number, patch: Partial<SectionRow>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch, overridden: true } : row)),
    );
  };

  const toggleHidden = (index: number) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, hidden: !row.hidden } : row)));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
    // 展开态跟着被移动的那一行走（相邻交换，两行互换即可）。
    setExpanded((prev) => (prev === index ? target : prev === target ? index : prev));
  };

  const removeRow = (index: number) => {
    const row = rows[index]!;
    if (!window.confirm(t("home.customizeDeleteConfirm", { name: shelfTitle(row, locale) }))) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    setExpanded((prev) => (prev === null || prev === index ? null : prev > index ? prev - 1 : prev));
  };

  const revertRow = (index: number) => {
    setRows((prev) => prev.map((row, i) => (i === index ? revertToTemplate(row) : row)));
  };

  const addBlank = () => {
    const row = rowFromScratch(locale, taken, t("home.customizeNewSection"));
    setRows((prev) => [...prev, row]);
    setExpanded(rows.length);
  };

  const addFromTemplate = (template: ShelfLike) => {
    const row = rowFromTemplate(template, taken, t("home.customizeNewSection"));
    setRows((prev) => [...prev, row]);
    setExpanded(rows.length);
    setPicking(false);
  };

  const validate = (): string => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!hasRequiredName(row.names)) {
        return t("home.customizeError.nameRequired");
      }
      if (!isValidSlug(row.slug)) return t("home.customizeError.slugInvalid");
      if (seen.has(row.slug)) return t("home.customizeError.slugTaken");
      seen.add(row.slug);
    }
    return "";
  };

  const handleSave = () => {
    const message = validate();
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError("");
    onSave(toPreferences(rows));
  };

  const handleReset = () => {
    if (!window.confirm(t("home.customizeResetConfirm"))) return;
    setLocalError("");
    onReset();
  };

  const shownError = localError || error;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-white/10 bg-surface shadow-elevated">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] shrink-0">
          <h2 className="font-display font-bold text-sm text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-primary" />
            {t("home.customizeTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surfaceHover text-gray-400 hover:text-white transition-colors duration-fast ease-soft cursor-pointer"
            aria-label={t("catalog.cancel")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto grow">
          <p className="text-xs text-gray-500">{t("home.customizeHint")}</p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addBlank}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-xs font-medium text-gray-300 hover:text-white transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("home.customizeAdd")}</span>
            </button>
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-xs font-medium text-primary transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{t("home.customizeAddTemplate")}</span>
            </button>
          </div>

          {picking && (
            <div className="p-3 rounded-lg border border-primary/25 bg-primary/[0.04] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-gray-300">
                  {t("home.customizeTemplateTitle")}
                </span>
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="p-1 rounded hover:bg-surfaceHover text-gray-400 hover:text-white cursor-pointer"
                  aria-label={t("catalog.cancel")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <p className="text-[11px] text-gray-500">{t("home.customizeTemplateHint")}</p>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {templates.length === 0 ? (
                  <span className="text-[11px] text-gray-500 font-mono">{t("home.customizeTemplateEmpty")}</span>
                ) : (
                  templates.map((template) => {
                    const Icon = iconFor(template);
                    return (
                      <button
                        key={template.slug}
                        type="button"
                        onClick={() => addFromTemplate(template)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-xs text-gray-300 hover:text-white transition-colors duration-fast ease-soft cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 text-primary" />
                        <span>{shelfTitle(template, locale)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-gray-500 py-8 text-center font-mono">{t("common.loadingGeneric")}</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-500 py-8 text-center">{t("home.customizeSectionsEmpty")}</p>
          ) : (
            rows.map((row, index) => {
              const Icon = iconFor(row);
              const rule = describeRule(row.query, defs, locale);
              const isOpen = expanded === index;
              const count = counts.get(row.slug);
              return (
                <div
                  key={index}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.02] overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleHidden(index)}
                      className={
                        "w-5 h-5 rounded border grid place-items-center shrink-0 transition-colors duration-fast ease-soft cursor-pointer " +
                        (row.hidden
                          ? "border-white/15 bg-transparent text-transparent"
                          : "border-primary bg-primary text-white")
                      }
                      aria-pressed={!row.hidden}
                      aria-label={t("home.toggleSection")}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <Icon className={"w-4 h-4 shrink-0 " + (row.hidden ? "text-gray-600" : "text-primary")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "text-xs truncate " + (row.hidden ? "text-gray-600 line-through" : "text-gray-200")
                          }
                        >
                          {shelfTitle(row, locale)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-500 text-[10px] font-mono shrink-0">
                          {row.custom ? t("home.customizeSourceCustom") : t("home.customizeSourceSystem")}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">
                        {rule.length > 0 ? rule.join(" · ") : t("home.customizeRuleAll")}
                      </div>
                    </div>
                    {typeof count === "number" && (
                      <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-gray-400 text-[10px] font-mono shrink-0">
                        {t("home.itemCount", { count: count.toString() })}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="p-1 rounded hover:bg-surfaceHover text-gray-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                      aria-label={t("home.moveUp")}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                      className="p-1 rounded hover:bg-surfaceHover text-gray-400 hover:text-white disabled:opacity-25 disabled:pointer-events-none cursor-pointer"
                      aria-label={t("home.moveDown")}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {row.template && row.overridden && (
                      <button
                        type="button"
                        onClick={() => revertRow(index)}
                        className="p-1 rounded hover:bg-surfaceHover text-gray-400 hover:text-white cursor-pointer"
                        title={t("home.customizeRevert")}
                        aria-label={t("home.customizeRevert")}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {row.custom && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="p-1 rounded hover:bg-rose-500/10 text-gray-400 hover:text-rose-400 cursor-pointer"
                        title={t("home.customizeDelete")}
                        aria-label={t("home.customizeDelete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : index)}
                      className={
                        "p-1 rounded hover:bg-surfaceHover cursor-pointer " + (isOpen ? "text-primary" : "text-gray-400 hover:text-white")
                      }
                      title={isOpen ? t("home.customizeCollapse") : t("common.edit")}
                      aria-label={isOpen ? t("home.customizeCollapse") : t("common.edit")}
                      aria-expanded={isOpen}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="px-3 py-3 border-t border-white/[0.08]">
                      <SectionRuleEditor row={row} defs={defs} onChange={(patch) => patchRow(index, patch)} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-4 border-t border-white/[0.08] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-400 hover:text-white transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t("home.customizeReset")}</span>
          </button>
          <div className="flex items-center gap-2">
            {shownError && <span className="text-[11px] text-red-400 font-mono max-w-[280px]">{shownError}</span>}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 rounded-lg border border-white/10 text-xs text-gray-300 hover:text-white hover:bg-surfaceHover transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
            >
              {t("catalog.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
