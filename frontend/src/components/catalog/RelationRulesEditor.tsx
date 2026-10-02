"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { type Definitions, local } from "./api";

type Rule = Definitions["relations"][string];
const scopes: Record<string, string[]> = {
  work:["work","content_unit","expression"], release:["release","medium","track"], medium:["medium","track"],
};
export function RelationRulesEditor({value,onChange,definitions}: {
  value: Rule; onChange: (v: Rule) => void; definitions: Definitions;
}) {
  const {t,locale} = useI18n();
  return <fieldset className="space-y-3 rounded border border-line p-3">
    <legend>{t("catalog.relationRules")}</legend>
    <label>{t("catalog.relationUsage")}<select value={value.usage || ""} onChange={(e) => {
      const usage = e.target.value;
      if (usage === "expression_composition") onChange({...value,usage,source_kinds:["expression"],target_kinds:["expression"],scope:"work",acyclic:true,cycle_group:"expression_composition",aggregate:true,unique_position:true,max_outgoing:0,max_incoming:0,reference_scopes:{},symmetric:false});
      else if (usage === "release_group") onChange({...value,usage,source_kinds:["release"],target_kinds:["work","collection"],scope:"",acyclic:false,cycle_group:"",aggregate:false,unique_position:false,max_outgoing:1,max_incoming:0,reference_scopes:{},symmetric:false});
      else onChange({...value,usage});
    }}>
      <option value="">{t("catalog.usageGeneral")}</option>
      <option value="expression_composition">{t("catalog.usageComposition")}</option>
      <option value="release_group">{t("catalog.usageReleaseGroup")}</option>
    </select></label>
    <p className="cv-hint">{t("catalog.relationRulesHint")}</p>
    <label>{t("catalog.sameScope")}<select value={value.scope || ""} onChange={(e) => onChange({...value,scope:e.target.value})}>
      <option value="">{t("catalog.ruleUnbounded")}</option>
      {Object.keys(scopes).map((code) => <option key={code} value={code}>{t(`catalog.scope.${code}`)}</option>)}
    </select></label>
    <label>{t("catalog.cycleGroup")}<input value={value.cycle_group || ""} onChange={(e) => onChange({...value,cycle_group:e.target.value})} /></label>
    <label className="!flex-row !items-center"><input type="checkbox" checked={value.unique_position === true} onChange={(e) => onChange({...value,unique_position:e.target.checked})} />{t("catalog.uniqueRelationPosition")}</label>
    {(value.fields || []).filter((code) => definitions.fields[code]?.type === "entity").map((field) => {
      const options = Object.entries(scopes).flatMap(([scope,kinds]) => ["source","target"].filter((endpoint) =>
        (endpoint === "source" ? value.source_kinds : value.target_kinds).every((kind) => kinds.includes(kind)) &&
        definitions.fields[field].kinds?.every((kind) => kinds.includes(kind))
      ).map((endpoint) => ({code:`${endpoint}_${scope}`,label:`${t(`catalog.endpoint.${endpoint}`)} · ${t(`catalog.scope.${scope}`)}`})));
      return <label key={field}>{t("catalog.referenceScope")} · {local(definitions.fields[field].names,locale,"",field)}
        <select value={value.reference_scopes?.[field] || ""} onChange={(e) => {
          const reference_scopes = {...value.reference_scopes}; if (e.target.value) reference_scopes[field] = e.target.value; else delete reference_scopes[field];
          onChange({...value,reference_scopes});
        }}><option value="">{t("catalog.ruleUnbounded")}</option>
          {options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        </select>
      </label>;
    })}
  </fieldset>;
}
