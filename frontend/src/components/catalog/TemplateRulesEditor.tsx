"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { TEMPLATE_BLOCKS, type TemplateCondition } from "@/lib/definitions";
import { type Definitions, local } from "./api";

type Template = Definitions["templates"][string];

export function TemplateRulesEditor({ value, onChange, definitions }: {
  value: Template; onChange: (v: Template) => void; definitions: Definitions;
}) {
  const { t, locale } = useI18n();
  const fields = Object.entries(definitions.fields).filter(([,f]) =>
    (f.applicable_kinds?.length || 0) > 0 &&
    (!value.kinds?.length || value.kinds.every((kind) => f.applicable_kinds?.includes(kind))) &&
    ["text","enum","boolean","number","date","list"].includes(f.type)
  );
  const update = (index: number, next: TemplateCondition) => onChange({
    ...value, match: (value.match || []).map((item,i) => i === index ? next : item),
  });
  return <fieldset className="space-y-3 rounded border border-line p-3">
    <legend>{t("catalog.templateRules")}</legend>
    <p className="cv-hint">{t("catalog.templateRulesHint")}</p>
    <label className="!flex-row !items-center">
      <input type="checkbox" checked={value.match !== undefined} onChange={(e) => onChange({ ...value, match: e.target.checked ? [] : undefined })} />
      {t("catalog.explicitMatch")}
    </label>
    {value.match !== undefined && <>
      <label>{t("catalog.templatePriority")}<input type="number" value={value.priority || 0} onChange={(e) => onChange({...value, priority: Number(e.target.value)})} /></label>
      {value.match.map((condition,index) => {
        const field = definitions.fields[condition.field];
        const scalar = condition.operator === "contains" ? field?.items : field;
        const terms = definitions.vocabularies[scalar?.vocabulary || ""]?.terms || {};
        return <div key={index} className="grid gap-2 rounded border border-line-subtle p-2 sm:grid-cols-4">
          <label>{t("catalog.matchField")}<select value={condition.field} onChange={(e) => update(index,{field:e.target.value,operator:"exists"})}>
            {fields.map(([code,f]) => <option key={code} value={code}>{local(f.names,locale,"",code)}</option>)}
          </select></label>
          <label>{t("catalog.matchOperator")}<select value={condition.operator} onChange={(e) => update(index,{...condition,operator:e.target.value as TemplateCondition["operator"],value:undefined})}>
            <option value="exists">{t("catalog.matchExists")}</option>
            <option value={field?.type === "list" ? "contains" : "equals"}>{t(field?.type === "list" ? "catalog.matchContains" : "catalog.matchEquals")}</option>
          </select></label>
          {condition.operator !== "exists" && <label>{t("catalog.matchValue")}
            {scalar?.type === "enum" ? <select value={String(condition.value ?? "")} onChange={(e) => update(index,{...condition,value:e.target.value})}>
              <option value="">{t("catalog.none")}</option>
              {Object.entries(terms).map(([code,term]) => <option key={code} value={code}>{local(term.names,locale,"",code)}</option>)}
            </select> : scalar?.type === "boolean" ? <select value={condition.value === undefined ? "" : String(condition.value)} onChange={(e) => update(index,{...condition,value:e.target.value === "" ? undefined : e.target.value === "true"})}>
              <option value="">{t("catalog.none")}</option><option value="true">{t("catalog.booleanTrue")}</option><option value="false">{t("catalog.booleanFalse")}</option>
            </select> : <input type={scalar?.type === "number" ? "number" : "text"} value={String(condition.value ?? "")} onChange={(e) => update(index,{...condition,value:scalar?.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value})} />}
          </label>}
          <button type="button" onClick={() => onChange({...value,match:value.match?.filter((_,i) => i !== index)})}>{t("catalog.remove")}</button>
        </div>;
      })}
      <button type="button" disabled={!fields.length} onClick={() => onChange({...value,match:[...(value.match || []),{field:fields[0]?.[0] || "",operator:"exists"}]})}>{t("catalog.addMatch")}</button>
    </>}
    <label className="!flex-row !items-center"><input type="checkbox" checked={value.blocks !== undefined} onChange={(e) => onChange({...value,blocks:e.target.checked ? [...TEMPLATE_BLOCKS] : undefined})} />{t("catalog.configureBlocks")}</label>
    {value.blocks !== undefined && <>
      <div className="cv-checks">{TEMPLATE_BLOCKS.map((block) => <label key={block}>
        <input type="checkbox" checked={value.blocks?.includes(block)} onChange={(e) => onChange({...value,blocks:e.target.checked ? [...(value.blocks || []),block] : value.blocks?.filter((code) => code !== block)})} />
        {t(`catalog.block.${block}`)}
      </label>)}</div>
      <ol className="space-y-1">{value.blocks.map((block,index) => <li key={block} className="flex items-center gap-2">
        {t(`catalog.block.${block}`)}
        <button type="button" disabled={index === 0} aria-label={t("catalog.moveUp")} onClick={() => {
          const blocks = [...(value.blocks || [])]; [blocks[index-1],blocks[index]] = [blocks[index],blocks[index-1]]; onChange({...value,blocks});
        }}>↑</button>
        <button type="button" disabled={index === (value.blocks?.length || 0)-1} aria-label={t("catalog.moveDown")} onClick={() => {
          const blocks = [...(value.blocks || [])]; [blocks[index+1],blocks[index]] = [blocks[index],blocks[index+1]]; onChange({...value,blocks});
        }}>↓</button>
      </li>)}</ol>
    </>}
  </fieldset>;
}
