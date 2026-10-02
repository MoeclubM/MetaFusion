"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { getRelationName, useDefinitions } from "@/lib/definitions";
import { api, type Entity, type Relation, title } from "./api";
import { ErrorMessage } from "./Fields";

type Item = {relation: Relation; entity: Entity};
type Composition = {parts: Item[]; wholes: Item[]; definition_etag: string};

export function ExpressionCompositionPanel({expression}: {expression: Entity}) {
  const {t,locale} = useI18n();
  const {definitions,etag} = useDefinitions();
  const [value,setValue] = useState<Composition>();
  const [error,setError] = useState("");
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setValue(undefined); setError("");
    api<Composition>(`/catalog/expressions/${expression.id}/composition`).then((result) => {if (active) setValue(result)})
      .catch((e) => {if (active) setError(e.message)});
    return () => {active = false};
  },[expression.id,expression.version,etag,retry]);
  if (error) return <div><ErrorMessage error={error}/><button type="button" onClick={() => setRetry(retry+1)}>{t("catalog.retry")}</button></div>;
  if (!value) return <p className="cv-muted">{t("catalog.loading")}</p>;
  if (!value.parts.length && !value.wholes.length) return <p className="cv-muted">{t("catalog.noComposition")}</p>;
  return <div className="space-y-4">
    {([{items:value.parts,forward:true,label:"catalog.compositionParts"},{items:value.wholes,forward:false,label:"catalog.compositionWholes"}]).filter((group) => group.items.length).map((group) =>
      <section key={group.label}>
        <h3 className="mb-2 font-semibold">{t(group.label)}</h3>
        <ol className="list-none space-y-2 p-0">{group.items.map((item) => <li key={item.relation.id} className="flex flex-wrap items-center gap-2 rounded border border-line-subtle px-3 py-2">
          {group.forward && <span className="font-mono text-xs text-text-faint">{item.relation.position+1}</span>}
          <Link className="text-primary hover:underline" href={`/catalog/${item.entity.id}`}>{title(item.entity,locale)}</Link>
          <span className="text-xs text-text-faint">{getRelationName(definitions,item.relation.type,group.forward,locale)}</span>
        </li>)}</ol>
      </section>
    )}
  </div>;
}
