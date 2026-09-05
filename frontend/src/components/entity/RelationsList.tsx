"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { catalogEntityHref, ConnectedEntityItem, EntityRelationship } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type Row = {
  href: string;
  name: string;
  originalName?: string;
  coverUrl?: string;
  coverAspect?: string;
  entityType: string;
  label: string;
  type: string;
  beginDate?: string;
  endDate?: string;
  ended?: boolean;
  key: string;
};

const COLLAPSED_COUNT = 12;

function toRows(items: ConnectedEntityItem[] | EntityRelationship[]): Row[] {
  const rows: Row[] = [];
  for (const raw of items) {
    if ("entity_id" in raw) {
      const it = raw as ConnectedEntityItem;
      rows.push({
        href: catalogEntityHref(it.entity_type, it.entity_id),
        name: it.entity_name,
        originalName: it.original_name,
        coverUrl: it.cover_url,
        coverAspect: it.cover_aspect,
        entityType: it.entity_type,
        label: it.label || it.relationship_name || it.relationship_type,
        type: it.relationship_type,
        beginDate: it.begin_date,
        endDate: it.end_date,
        ended: it.ended,
        key: `${it.entity_id}-${it.relationship_type}-${it.qualifier || ""}`,
      });
    } else {
      const it = raw as EntityRelationship;
      rows.push({
        href: catalogEntityHref(it.target_type, it.target_id),
        name: it.target_id.slice(0, 8),
        entityType: it.target_type,
        label: it.relationship_type,
        type: it.relationship_type,
        beginDate: it.begin_date,
        endDate: it.end_date,
        ended: it.ended,
        key: `${it.source_id}-${it.target_id}-${it.relationship_type}-${it.qualifier || ""}`,
      });
    }
  }
  return rows;
}

function RelationCard({ row }: { row: Row }) {
  const { t } = useI18n();
  let date = "";
  if (row.beginDate || row.endDate) {
    const tail = row.endDate || (row.ended ? t("relations.dateEnded") : t("relations.dateTail"));
    date = `${row.beginDate} ~ ${tail}`;
  }
  return (
    <Link href={row.href} className="group block min-w-0">
      <div className="mb-1 truncate text-[11px] text-gray-500 dark:text-gray-400" title={row.label}>
        {row.label}
      </div>
      <div className="overflow-hidden rounded-md border border-black/10 bg-black/[0.03] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
        <AdaptiveCover
          src={row.coverUrl}
          alt={row.name}
          title={row.name}
          originalTitle={row.originalName}
          id={row.key}
          aspect={row.coverAspect || undefined}
          fallbackRatio={row.entityType === "artist" ? 1 : 2 / 3}
        />
      </div>
      <div className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-gray-900 transition-colors group-hover:text-primary dark:text-white">
        {row.name}
      </div>
      {date && <div className="mt-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400">{date}</div>}
    </Link>
  );
}

/**
 * Bangumi 式关联条目封面网格：每卡自带关系类型小字（同类型相邻排列），
 * 无封面实体走 ProceduralCover 兜底；超过阈值折叠，展开/收起走 i18n。
 */
export function GroupedRelations({
  items,
}: {
  items: ConnectedEntityItem[] | EntityRelationship[] | undefined;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!items || items.length === 0) return null;
  const rows = toRows(items);
  // 稳定按关系类型首次出现顺序排列，让同类型卡片相邻但不打断为分组标题
  const typeOrder = new Map<string, number>();
  for (const r of rows) {
    if (!typeOrder.has(r.type)) typeOrder.set(r.type, typeOrder.size);
  }
  const sorted = [...rows].sort((a, b) => typeOrder.get(a.type)! - typeOrder.get(b.type)!);
  const collapsible = sorted.length > COLLAPSED_COUNT;
  const visible = expanded || !collapsible ? sorted : sorted.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-3.5 gap-y-4">
        {visible.map((r) => (
          <RelationCard key={r.key} row={r} />
        ))}
      </div>
      {collapsible && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm font-medium text-primary hover:underline underline-offset-2"
          >
            {expanded ? t("relations.collapse") : t("relations.showAll", { count: sorted.length })}
          </button>
        </div>
      )}
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
