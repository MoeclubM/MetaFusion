"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity } from "@/components/catalog/api";
import { EntityRevisions, RevisionItem } from "@/components/catalog/EntityRevisions";
import { getKindName, useDefinitions } from "@/lib/definitions";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  targetType: string;
  targetId: string;
  entityTitle: string;
}

// 专用作品页与通用详情共用历史展示、对比与还原流程。
export function RevisionHistoryModal({ isOpen, onClose, targetType, targetId, entityTitle }: Props) {
  const { t, tr, locale } = useI18n();
  const { kinds } = useDefinitions();
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [entity, setEntity] = useState<Entity>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isOpen || !targetId) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    Promise.all([
      api<Entity>(`/catalog/entities/${targetId}`),
      api<{ items: RevisionItem[] }>(`/catalog/entities/${targetId}/revisions`),
    ]).then(([current, history]) => {
      if (active) {
        setEntity(current);
        setRevisions(history.items || []);
      }
    }).catch(() => {
      if (active) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [isOpen, targetId]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="revision-dialog-title"
        className="w-full max-w-5xl max-h-[88vh] flex flex-col rounded-xl border border-line bg-surface shadow-2xl text-text-strong">
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div>
            <h2 id="revision-dialog-title" className="text-sm font-bold">{t("editor.history.title")}</h2>
            <p className="text-xs text-text-faint">
              {entityTitle} ·{" "}
              {getKindName(kinds, targetType, locale, tr(`catalog.kind.${targetType}`, targetType))}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("revisions.close")} className="p-2">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {loading ? <p>{t("catalog.loading")}</p> : failed ? <p role="alert">{t("catalog.connectionError")}</p> :
            <EntityRevisions revisions={revisions} currentEntity={entity} />}
        </div>
      </div>
    </div>
  );
}
