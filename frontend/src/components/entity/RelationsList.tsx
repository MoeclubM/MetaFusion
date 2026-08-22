"use client";

import React from "react";
import Link from "next/link";
import { catalogEntityHref, ConnectedEntityItem, EntityRelationship } from "@/lib/api";
import { CATALOG_LOCALE_CODES } from "@/components/editor/localeForm";

type Row = {
  href: string;
  name: string;
  label: string;
  type: string;
  qualifier?: string;
  attributes?: Record<string, any>;
  key: string;
};

function attrText(attrs: Record<string, any> | undefined, key: string): string {
  if (!attrs) return "";
  const v = attrs[key];
  if (v == null || typeof v === "boolean") return "";
  return String(v).trim();
}

/** ja / zh-CN / en-US 等语种可展示；railgun、fgo 这类内部 slug 不展示。 */
function isLanguageQualifier(q?: string): boolean {
  if (!q) return false;
  const v = q.trim();
  if (!v) return false;
  const low = v.toLowerCase();
  if ((CATALOG_LOCALE_CODES as readonly string[]).some((c) => c.toLowerCase() === low)) return true;
  if (/^[a-z]{2}$/i.test(v)) {
    return (CATALOG_LOCALE_CODES as readonly string[]).some(
      (c) => c.toLowerCase() === low || c.toLowerCase().startsWith(`${low}-`)
    );
  }
  return false;
}

function readableHints(row: Row): string[] {
  const attrs = row.attributes;
  const out: string[] = [];
  for (const key of ["role_type", "form_name", "position"] as const) {
    const s = attrText(attrs, key);
    if (s) out.push(s);
  }
  const langCandidate = isLanguageQualifier(row.qualifier)
    ? row.qualifier!.trim()
    : isLanguageQualifier(typeof attrs?.locale === "string" ? attrs.locale : undefined)
      ? String(attrs!.locale).trim()
      : "";
  if (langCandidate && !out.some((x) => x.toLowerCase() === langCandidate.toLowerCase())) {
    out.push(langCandidate);
  }
  return out;
}

function toRows(items: ConnectedEntityItem[] | EntityRelationship[]): Row[] {
  const rows: Row[] = [];
  for (const raw of items) {
    if ("entity_id" in raw) {
      const it = raw as ConnectedEntityItem;
      rows.push({
        href: catalogEntityHref(it.entity_type, it.entity_id),
        name: it.entity_name,
        label: it.label || it.relationship_name || it.relationship_type,
        type: it.relationship_type,
        qualifier: it.qualifier,
        attributes: it.attributes,
        key: `${it.entity_id}-${it.relationship_type}-${it.qualifier || ""}`,
      });
    } else {
      const it = raw as EntityRelationship;
      rows.push({
        href: catalogEntityHref(it.target_type, it.target_id),
        name: it.target_id.slice(0, 8),
        label: it.relationship_type,
        type: it.relationship_type,
        qualifier: it.qualifier,
        attributes: it.attributes,
        key: `${it.source_id}-${it.target_id}-${it.relationship_type}-${it.qualifier || ""}`,
      });
    }
  }
  return rows;
}

function RelationRowLink({ row }: { row: Row }) {
  const hints = readableHints(row);
  return (
    <Link
      href={row.href}
      className="text-sm text-primary hover:underline underline-offset-2 inline-flex items-center gap-2 py-0.5"
    >
      <span>{row.name}</span>
      {hints.length > 0 && (
        <span className="font-mono text-[11px] text-gray-500">{hints.join(" · ")}</span>
      )}
    </Link>
  );
}

export function GroupedRelations({
  items,
}: {
  items: ConnectedEntityItem[] | EntityRelationship[] | undefined;
}) {
  if (!items || items.length === 0) return null;
  const rows = toRows(items);
  const order: string[] = [];
  const map = new Map<string, { label: string; rows: Row[] }>();
  for (const r of rows) {
    if (!map.has(r.type)) {
      order.push(r.type);
      map.set(r.type, { label: r.label || r.type, rows: [] });
    }
    map.get(r.type)!.rows.push(r);
  }
  return (
    <div className="space-y-3">
      {order.map((type, i) => {
        const b = map.get(type)!;
        return (
          <div
            key={type}
            className={i > 0 ? "pt-3 border-t border-black/5 dark:border-white/[0.06] space-y-1.5" : "space-y-1.5"}
          >
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-gray-500">{b.label}</h3>
            <ul className="space-y-0.5">
              {b.rows.map((r) => (
                <li key={r.key}>
                  <RelationRowLink row={r} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function RelationsList({
  items,
}: {
  items: ConnectedEntityItem[] | EntityRelationship[];
}) {
  return <GroupedRelations items={items} />;
}
