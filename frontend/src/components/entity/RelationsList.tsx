"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AdaptiveCover } from "@/components/common/AdaptiveCover";
import { catalogEntityHref, ConnectedEntityItem, EntityRelationship } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { getFieldName, useDefinitions } from "@/lib/definitions";
import { FieldValue } from "@/components/catalog/TemplateAttributeSections";
import { RelationFilterBar, useRelationFilter } from "@/components/entity/RelationFilterBar";

type Row = {
  href: string;
  name: string;
  originalName?: string;
  coverUrl?: string;
  entityType: string;
  /** 对端实体 kind：关系筛选的 kind 维度口径（与 entityType 同源，别名便于筛选层复用）。 */
  kind: string;
  label: string;
  /** 关系类型码与方向：正向名的本地化文案不能代表反向关系。 */
  type: string;
  direction?: "forward" | "reverse";
  /** 关系附加属性：键为 definitions 声明的字段码（适用章节、语言、职务等）。 */
  attributes?: Record<string, any>;
  beginDate?: string;
  endDate?: string;
  ended?: boolean;
  key: string;
  /** 关系行 id：同一对端存在多条边时用它做稳定 key，而不是靠类型字符串拼接。 */
  relationId?: string;
};

/** 同一关系类型下的卡片超过阈值就折叠，避免单个类型把整页拉长。 */
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
        entityType: it.entity_type,
        kind: it.entity_type,
        label: it.label || it.relationship_name || it.relationship_type,
        type: it.relationship_type,
        direction: it.direction,
        attributes: it.attributes,
        beginDate: it.begin_date,
        endDate: it.end_date,
        ended: it.ended,
        relationId: it.relation_id,
        key:
          it.relation_id ||
          `${it.entity_id}-${it.relationship_type}-${it.direction || "forward"}-${it.qualifier || ""}`,
      });
    } else {
      const it = raw as EntityRelationship;
      rows.push({
        href: catalogEntityHref(it.target_type, it.target_id),
        name: it.target_id.slice(0, 8),
        entityType: it.target_type,
        kind: it.target_type,
        label: it.relationship_type,
        type: it.relationship_type,
        attributes: it.attributes,
        beginDate: it.begin_date,
        endDate: it.end_date,
        ended: it.ended,
        relationId: it.id,
        key:
          it.id ||
          `${it.source_id}-${it.target_id}-${it.relationship_type}-${it.qualifier || ""}`,
      });
    }
  }
  return rows;
}

function RelationCard({ row, showLabel = false }: { row: Row; showLabel?: boolean }) {
  const { t, locale } = useI18n();
  const { definitions: defs } = useDefinitions();
  // 关系附加属性（适用章节、语言、职务…）：字段码与名称都取自 definitions，
  // 未声明的键不渲染，代码不写死任何关系属性字段。
  const attrEntries = Object.entries(row.attributes || {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  let date = "";
  if (row.beginDate || row.endDate) {
    const tail = row.endDate || (row.ended ? t("relations.dateEnded") : t("relations.dateTail"));
    date = `${row.beginDate} ~ ${tail}`;
  }
  return (
    <Link href={row.href} className="group block min-w-0">
      {/* 类型名已由分组标题承担；同一类型两个方向都在时才在卡上补方向名。 */}
      {showLabel && (
        <div className="mb-1 truncate text-[11px] text-text-muted" title={row.label}>
          {row.label}
        </div>
      )}
      <div className="overflow-hidden rounded-md border bg-black/[0.03] transition-all duration-base ease-soft group-hover:-translate-y-0.5 group-hover:shadow-sm border-line dark:bg-white/[0.04]">
        <AdaptiveCover
          src={row.coverUrl}
          alt={row.name}
          title={row.name}
          originalTitle={row.originalName}
          id={row.key}
          fallbackRatio={row.entityType === "agent" ? 1 : 2 / 3}
        />
      </div>
      <div className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-gray-900 transition-colors duration-fast ease-soft group-hover:text-primary dark:text-white">
        {row.name}
      </div>
      {date && <div className="mt-0.5 font-mono text-[11px] text-text-muted">{date}</div>}
      {attrEntries.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] text-text-muted">
          {attrEntries.map(([code, value]) => (
            <span key={code} className="inline-flex items-baseline gap-0.5">
              <span className="text-text-muted">
                {getFieldName(defs, code, locale)}:
              </span>
              <FieldValue code={code} value={value} defs={defs} locale={locale} />
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function TypeSection({ label, rows }: { label: string; rows: Row[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const collapsible = rows.length > COLLAPSED_COUNT;
  const visible = expanded || !collapsible ? rows : rows.slice(0, COLLAPSED_COUNT);
  // 类型名与卡上方向名不一致 = 该类型两个方向都有，卡上补方向名区分。
  const mixedDirections = rows.some((r) => r.label !== label);
  return (
    <div className="space-y-2">
      <h4 className="m-0 flex items-baseline gap-1.5 font-display text-sm font-semibold text-text-strong">
        <span>{label}</span>
        <span className="font-mono text-[11px] font-normal text-text-muted">({rows.length})</span>
      </h4>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-3.5 gap-y-4">
        {visible.map((r) => (
          <RelationCard key={r.key} row={r} showLabel={mixedDirections} />
        ))}
      </div>
      {collapsible && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-primary hover:underline underline-offset-2"
          >
            {expanded ? t("relations.collapse") : t("relations.showAll", { count: rows.length })}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 关联条目封面网格：按"关系分类 → 关系类型"归并，卡片自带关系名小字；
 * 无封面实体走 ProceduralCover 兜底。筛选维度（关联对象 / 分类 / 类型）
 * 由数据与 definitions 动态生成，同一维度的选项再点一次即取消。
 */
export function GroupedRelations({
  items,
  groupOrder,
}: {
  items: ConnectedEntityItem[] | EntityRelationship[] | undefined;
  /** 实体模板声明的分类顺序（relation_groups）。 */
  groupOrder?: string[];
}) {
  const { t } = useI18n();
  const rows = React.useMemo(() => toRows(items || []), [items]);
  const filter = useRelationFilter(rows, groupOrder);
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-4">
      <RelationFilterBar
        facets={filter.facets}
        selection={filter.selection}
        onToggle={filter.toggle}
      />
      {filter.visible.length === 0 ? (
        <p className="text-sm text-text-faint">{t("relations.filterEmpty")}</p>
      ) : (
        filter.sections.map((section) => (
          <div key={section.key} className="space-y-3">
            <h3 className="m-0 flex items-baseline gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>{section.label}</span>
              <span className="font-mono text-[11px] font-normal">({section.count})</span>
            </h3>
            {section.types.map((type) => (
              <TypeSection key={type.type} label={type.label} rows={type.rows} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
