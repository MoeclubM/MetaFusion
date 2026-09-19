"use client";

// /compare 的版本对比模式：?revisions=<entityId>:<version>,<entityId>:<version>
// 取两版快照，用与历史页签同一套 RevisionDiffInspector 渲染。实体 id 可相同可不同。

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "./api";
import { RevisionDiffInspector, type DiffSnapshot } from "./RevisionDiffInspector";
import type { RevisionItem } from "./EntityRevisions";

interface RevRef {
  entityId: string;
  version: number;
}

function parseRefs(query: string): RevRef[] {
  return query
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.lastIndexOf(":");
      if (i <= 0) return null;
      const version = Number(part.slice(i + 1));
      if (!Number.isFinite(version)) return null;
      return { entityId: part.slice(0, i), version };
    })
    .filter((x): x is RevRef => !!x);
}

export function RevisionsCompare({ query }: { query: string }) {
  const { t } = useI18n();
  const refs = useMemo(() => parseRefs(query), [query]);
  const [snaps, setSnaps] = useState<(DiffSnapshot | null)[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (refs.length !== 2) {
      setSnaps([]);
      setError(t("compare.revisions.invalid"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all(
      refs.map((r) =>
        api<{ items: RevisionItem[] }>(`/catalog/entities/${encodeURIComponent(r.entityId)}/revisions`).then(
          (res) => {
            const hit = (Array.isArray(res.items) ? res.items : []).find((v) => Number(v.version) === r.version);
            if (!hit) throw new Error("not_found:" + r.entityId + ":" + r.version);
            return hit as DiffSnapshot;
          },
        ),
      ),
    )
      .then((found) => {
        if (cancelled) return;
        setSnaps(found);
        setError("");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSnaps([]);
        setError(e instanceof Error ? e.message : t("compare.revisions.notFound"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, t]);

  if (loading) {
    return <p className="text-sm text-text-faint font-mono">{t("common.loading")}</p>;
  }
  if (error || snaps.length !== 2 || !snaps[0] || !snaps[1]) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-500 font-mono">{error || t("compare.revisions.notFound")}</p>
        <p className="text-xs text-text-faint font-mono">{t("compare.revisions.hint")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Link href="/compare" className="text-xs font-mono text-primary hover:underline">
        {t("compare.revisions.backToEntities")}
      </Link>
      <RevisionDiffInspector base={snaps[0]} current={snaps[1]} />
    </div>
  );
}
