"use client";

// 通用署名区（一行即用）：自己拉 /catalog/entities/:id/relations，用通用构造喂
// StaffCharacterSection。各实体详情页（作品/发行版/载体/通用详情）统一用它，
// 不再各写一套演职员展示。无署名关系时渲染空。

import React, { useEffect, useMemo, useState } from "react";
import { fetchApi } from "@/lib/api";
import { useDefinitions } from "@/lib/definitions";
import { useI18n } from "@/i18n/I18nProvider";
import type { Entity } from "@/components/catalog/api";
import { StaffCharacterSection } from "./StaffCharacterSection";
import { buildStaffCredits, type RelationLike } from "./staffCredits";

export function EntityStaffSection({
  entityId,
  onCount,
}: {
  entityId: string;
  /** 条目数回告：包卡片/页签的页面据此决定显隐（空时不留空卡）。 */
  onCount?: (n: number) => void;
}) {
  const { tr, locale } = useI18n();
  const { definitions: defs } = useDefinitions();
  const [relations, setRelations] = useState<RelationLike[]>([]);
  const [relEntities, setRelEntities] = useState<Record<string, Entity>>({});

  useEffect(() => {
    let alive = true;
    fetchApi<{ items: RelationLike[]; entities: Record<string, Entity> }>(
      `/catalog/entities/${encodeURIComponent(entityId)}/relations`,
    )
      .then((r) => {
        if (!alive) return;
        setRelations(Array.isArray(r.items) ? r.items : []);
        // entities 归一化：现行后端给 ID→Entity 映射，旧响应可能为数组（按 id 建表）。
        const raw: unknown = r.entities;
        if (Array.isArray(raw)) {
          const map: Record<string, Entity> = {};
          for (const item of raw) {
            const ent = item as Partial<Entity> | null;
            if (ent && typeof ent.id === "string" && ent.id) map[ent.id] = item as Entity;
          }
          setRelEntities(map);
        } else {
          setRelEntities(raw && typeof raw === "object" ? (raw as Record<string, Entity>) : {});
        }
      })
      .catch(() => {
        if (!alive) return;
        setRelations([]);
        setRelEntities({});
      });
    return () => {
      alive = false;
    };
  }, [entityId]);

  const credits = useMemo(
    () => buildStaffCredits({ entityId, relations, relEntities, defs, locale, tr }),
    [entityId, relations, relEntities, defs, locale, tr],
  );
  useEffect(() => {
    onCount?.(credits.length);
  }, [credits.length, onCount]);
  if (credits.length === 0) return null;
  return <StaffCharacterSection credits={credits} />;
}
