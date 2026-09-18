"use client";

// 单个分区的编辑器：标题（多语言）+ 收录规则（类型/字段/词表项/关系）+ 排序 + 图标。
// 规则形状与后台货架编辑器一致，只是这里的改动只写进用户自己的偏好，不碰系统货架。
import React, { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor } from "@/components/common/DynamicNamesEditor";
import {
  getFieldName,
  getRelationName,
  getTermName,
  getTypeName,
  resolveLocalizedName,
  type DynamicDefinitions,
} from "@/lib/definitions";
import {
  ICON_NAMES,
  ICONS,
  isValidSlug,
  type SectionRow,
  type SectionSort,
  type ShelfQuery,
} from "@/lib/homeSections";

const SORTS: SectionSort[] = ["updated", "created", "title"];

// 排序文案键写死在这里，不用 "前缀 + 码" 拼接：拼接出来的键在字典里查不到，
// 清理无引用词条时也会被误判成死键。
const SORT_LABEL_KEY: Record<SectionSort, string> = {
  updated: "home.customizeSortUpdated",
  created: "home.customizeSortCreated",
  title: "home.customizeSortTitle",
};

type Props = {
  row: SectionRow;
  defs: DynamicDefinitions | null;
  /** 只用于分区定义类字段；父组件据此把系统行标记为"已覆盖"。 */
  onChange: (patch: Partial<SectionRow>) => void;
};

/** 规则块里可删不可加的只读标签（选中项展示）。 */
function RuleChip({ label, code, onRemove }: { label: string; code?: string; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/25 text-[11px] font-mono">
      <span className="truncate max-w-[160px]">{label}</span>
      {code && code !== label && <span className="text-primary/50">{code}</span>}
      <button
        type="button"
        onClick={onRemove}
        className="hover:text-rose-400 cursor-pointer"
        title={t("common.delete")}
        aria-label={t("common.delete")}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** 可点选的候选标签（类型、词表项）。 */
function ToggleChip({
  label,
  code,
  active,
  onClick,
}: {
  label: string;
  code: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-2 py-0.5 rounded border text-[11px] font-mono transition-colors duration-fast ease-soft cursor-pointer " +
        (active
          ? "bg-primary/20 border-primary/40 text-primary"
          : "bg-emphasis/[0.03] border-line text-gray-400 hover:text-emphasis hover:bg-emphasis/[0.07]")
      }
    >
      <span>{label}</span>
      {code !== label && <span className="ml-1 text-gray-500">{code}</span>}
    </button>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-lg bg-emphasis/[0.02] border border-emphasis/[0.08] space-y-2">
      <div className="text-[11px] font-mono font-bold text-gray-300">{title}</div>
      {children}
    </div>
  );
}

const inputClass =
  "flex-1 min-w-0 px-2.5 py-1.5 rounded bg-black/30 border border-line text-xs text-emphasis font-mono placeholder:text-gray-600 focus:border-primary outline-none";

const addButtonClass =
  "px-2.5 py-1.5 rounded bg-emphasis/[0.06] hover:bg-emphasis/[0.12] text-gray-300 hover:text-emphasis text-xs cursor-pointer";

export function SectionRuleEditor({ row, defs, onChange }: Props) {
  const { t, locale } = useI18n();
  const query = row.query;
  const setQuery = (patch: Partial<ShelfQuery>) => onChange({ query: { ...query, ...patch } });

  const [typeInput, setTypeInput] = useState("");
  const [termFilter, setTermFilter] = useState("");
  const [vocabPick, setVocabPick] = useState("");
  const [vocabKeyInput, setVocabKeyInput] = useState("");
  const [termInput, setTermInput] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [relationInput, setRelationInput] = useState("");

  const typeCodes = useMemo(
    () => Object.keys(defs?.types || {}).filter((code) => defs?.types?.[code]?.enabled !== false),
    [defs],
  );
  const vocabCodes = useMemo(() => Object.keys(defs?.vocabularies || {}), [defs]);
  const fieldCodes = useMemo(() => Object.keys(defs?.fields || {}), [defs]);
  const relationCodes = useMemo(
    () => Object.keys(defs?.relations || {}).filter((code) => defs?.relations?.[code]?.enabled !== false),
    [defs],
  );

  const selectedTypes = query.types || [];
  const selectedRelations = query.relations || [];
  const selectedFields = query.fields || {};
  const selectedTerms = query.vocab_terms || {};

  // 词表只在服务端有定义时才给下拉；没有定义时退回"手填词表码 + 词条码"。
  const vocab = vocabCodes.length > 0 ? vocabPick || vocabCodes[0]! : vocabKeyInput.trim();
  const vocabTerms = useMemo(() => {
    const terms = defs?.vocabularies?.[vocab]?.terms || {};
    return Object.keys(terms).filter((code) => terms[code]?.enabled !== false);
  }, [defs, vocab]);
  const keyword = termFilter.trim().toLowerCase();
  const shownTypes = typeCodes
    .filter(
      (code) =>
        !keyword ||
        code.toLowerCase().includes(keyword) ||
        getTypeName(defs, code, locale).toLowerCase().includes(keyword),
    )
    .slice(0, 80);
  const shownTerms = vocabTerms
    .filter(
      (code) =>
        !keyword ||
        code.toLowerCase().includes(keyword) ||
        getTermName(defs, vocab, code, locale).toLowerCase().includes(keyword),
    )
    .slice(0, 80);

  const toggleType = (code: string) => {
    const next = selectedTypes.includes(code)
      ? selectedTypes.filter((x) => x !== code)
      : [...selectedTypes, code];
    setQuery({ types: next });
  };
  const toggleTerm = (code: string) => {
    const current = selectedTerms[vocab] || [];
    const next = current.includes(code) ? current.filter((x) => x !== code) : [...current, code];
    const merged = { ...selectedTerms };
    if (next.length > 0) merged[vocab] = next;
    else delete merged[vocab];
    setQuery({ vocab_terms: merged });
  };
  const addFreeTerm = () => {
    const code = termInput.trim();
    if (!code || !vocab) return;
    if (!(selectedTerms[vocab] || []).includes(code)) toggleTerm(code);
    setTermInput("");
  };

  return (
    <div className="space-y-2.5">
      {row.custom && (
        <div className="space-y-1">
          <label className="block text-[11px] font-mono text-gray-300" htmlFor={`mf-section-slug-${row.slug}`}>
            {t("home.customizeSlug")}
          </label>
          <input
            id={`mf-section-slug-${row.slug}`}
            value={row.slug}
            onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
            placeholder={t("home.customizeSlugPlaceholder")}
            className={inputClass + " w-full"}
          />
          {!isValidSlug(row.slug) && (
            <p className="text-[10px] text-amber-300 font-mono">{t("home.customizeError.slugInvalid")}</p>
          )}
        </div>
      )}

      <DynamicNamesEditor
        label={t("home.customizeName")}
        helperText={t("home.customizeNameHint")}
        required
        value={row.names}
        onChange={(names) => onChange({ names })}
      />

      <Block title={t("home.customizeTypes")}>
        {selectedTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedTypes.map((code) => (
              <RuleChip key={code} label={getTypeName(defs, code, locale)} code={code} onRemove={() => toggleType(code)} />
            ))}
          </div>
        )}
        {typeCodes.length === 0 ? (
          <p className="text-[11px] text-gray-500">{t("home.customizeDefsUnavailable")}</p>
        ) : (
          <>
            <input
              value={typeInput}
              onChange={(e) => setTypeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const code = typeInput.trim();
                  if (code && !selectedTypes.includes(code)) toggleType(code);
                  setTypeInput("");
                }
              }}
              placeholder={t("home.customizeTypePlaceholder")}
              className={inputClass + " w-full"}
            />
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {shownTypes.map((code) => (
                <ToggleChip
                  key={code}
                  label={getTypeName(defs, code, locale)}
                  code={code}
                  active={selectedTypes.includes(code)}
                  onClick={() => toggleType(code)}
                />
              ))}
            </div>
          </>
        )}
      </Block>

      <Block title={t("home.customizeTags")}>
        {Object.entries(selectedTerms).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(selectedTerms).flatMap(([key, values]) =>
              (values || []).map((value) => (
                <RuleChip
                  key={`${key}:${value}`}
                  label={`${resolveLocalizedName(defs?.vocabularies?.[key]?.names, locale, key)}:${getTermName(defs, key, value, locale)}`}
                  onRemove={() => {
                    const merged = { ...selectedTerms };
                    const next = (merged[key] || []).filter((x) => x !== value);
                    if (next.length > 0) merged[key] = next;
                    else delete merged[key];
                    setQuery({ vocab_terms: merged });
                  }}
                />
              )),
            )}
          </div>
        )}
        {vocabCodes.length > 0 ? (
          <select
            value={vocab}
            onChange={(e) => setVocabPick(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-black/30 border border-line text-xs text-emphasis font-mono focus:border-primary outline-none cursor-pointer"
          >
            {vocabCodes.map((code) => (
              <option key={code} value={code}>
                {resolveLocalizedName(defs?.vocabularies?.[code]?.names, locale, code)}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={vocabKeyInput}
            onChange={(e) => setVocabKeyInput(e.target.value)}
            placeholder={t("home.customizeVocabKeyPlaceholder")}
            className={inputClass + " w-full"}
          />
        )}
        <input
          value={termFilter}
          onChange={(e) => setTermFilter(e.target.value)}
          placeholder={t("home.customizeTermFilter")}
          className={inputClass + " w-full"}
        />
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          {shownTerms.map((code) => (
            <ToggleChip
              key={code}
              label={getTermName(defs, vocab, code, locale)}
              code={code}
              active={(selectedTerms[vocab] || []).includes(code)}
              onClick={() => toggleTerm(code)}
            />
          ))}
          {vocabTerms.length === 0 && (
            <span className="text-[11px] text-gray-500 font-mono">{t("home.customizeTermEmpty")}</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={termInput}
            onChange={(e) => setTermInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFreeTerm();
              }
            }}
            placeholder={t("home.customizeTermPlaceholder")}
            className={inputClass}
          />
          <button type="button" onClick={addFreeTerm} className={addButtonClass} title={t("home.customizeAddTerm")}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </Block>

      <Block title={t("home.customizeFields")}>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(selectedFields).flatMap(([key, values]) =>
            (values || []).map((value) => (
              <RuleChip
                key={`${key}=${value}`}
                label={getFieldName(defs, key, locale)}
                code={`=${value}`}
                onRemove={() => {
                  const merged = { ...selectedFields };
                  const next = (merged[key] || []).filter((x) => x !== value);
                  if (next.length > 0) merged[key] = next;
                  else delete merged[key];
                  setQuery({ fields: merged });
                }}
              />
            )),
          )}
          {Object.keys(selectedFields).length === 0 && (
            <span className="text-[11px] text-gray-500 font-mono">{t("home.customizeRuleNone")}</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            list={`mf-section-field-${row.slug}`}
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            placeholder={t("home.customizeFieldKeyPlaceholder")}
            className={inputClass}
          />
          <datalist id={`mf-section-field-${row.slug}`}>
            {fieldCodes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <input
            value={fieldValue}
            onChange={(e) => setFieldValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const key = fieldKey.trim();
                const value = fieldValue.trim();
                if (!key || !value) return;
                const merged = { ...selectedFields };
                merged[key] = Array.from(new Set([...(merged[key] || []), value]));
                setQuery({ fields: merged });
                setFieldValue("");
              }
            }}
            placeholder={t("home.customizeFieldValuePlaceholder")}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => {
              const key = fieldKey.trim();
              const value = fieldValue.trim();
              if (!key || !value) return;
              const merged = { ...selectedFields };
              merged[key] = Array.from(new Set([...(merged[key] || []), value]));
              setQuery({ fields: merged });
              setFieldValue("");
            }}
            className={addButtonClass}
            title={t("home.customizeAddField")}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </Block>

      <Block title={t("home.customizeRelations")}>
        <div className="flex flex-wrap gap-1.5">
          {selectedRelations.map((code) => (
            <RuleChip
              key={code}
              label={getRelationName(defs, code, true, locale)}
              code={code}
              onRemove={() => setQuery({ relations: selectedRelations.filter((x) => x !== code) })}
            />
          ))}
          {selectedRelations.length === 0 && (
            <span className="text-[11px] text-gray-500 font-mono">{t("home.customizeRuleNone")}</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            list={`mf-section-relation-${row.slug}`}
            value={relationInput}
            onChange={(e) => setRelationInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const code = relationInput.trim();
                if (code && !selectedRelations.includes(code)) {
                  setQuery({ relations: [...selectedRelations, code] });
                }
                setRelationInput("");
              }
            }}
            placeholder={t("home.customizeRelationPlaceholder")}
            className={inputClass}
          />
          <datalist id={`mf-section-relation-${row.slug}`}>
            {relationCodes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => {
              const code = relationInput.trim();
              if (!code || selectedRelations.includes(code)) return;
              setQuery({ relations: [...selectedRelations, code] });
              setRelationInput("");
            }}
            className={addButtonClass}
            title={t("home.customizeAddRelation")}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </Block>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Block title={t("home.customizeSort")}>
          <div className="flex flex-wrap gap-1.5">
            {SORTS.map((sort) => (
              <ToggleChip
                key={sort}
                label={t(SORT_LABEL_KEY[sort])}
                code={sort}
                active={row.sort === sort}
                onClick={() => onChange({ sort })}
              />
            ))}
          </div>
        </Block>
        <Block title={t("home.customizeIcon")}>
          <div className="flex flex-wrap gap-1.5">
            {ICON_NAMES.map((name) => {
              const Icon = ICONS[name]!;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange({ icon: name })}
                  aria-pressed={row.icon === name}
                  title={name}
                  className={
                    "w-7 h-7 rounded border grid place-items-center transition-colors duration-fast ease-soft cursor-pointer " +
                    (row.icon === name
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-line bg-emphasis/[0.03] text-gray-400 hover:text-emphasis hover:bg-emphasis/[0.08]")
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </Block>
      </div>
    </div>
  );
}
