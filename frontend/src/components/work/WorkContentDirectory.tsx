"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ListTree } from "lucide-react";
import { CanonicalEntry, fetchWorkContents } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type WorkContentDirectoryProps = {
  workId: string;
};

export function WorkContentDirectory({ workId }: WorkContentDirectoryProps) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<CanonicalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchWorkContents(workId)
      .then((response) => {
        if (active) setItems(response.items || []);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workId]);

  const children = useMemo(() => {
    const grouped = new Map<string, CanonicalEntry[]>();
    for (const item of items) {
      const key = item.parent_id || "root";
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    }
    return grouped;
  }, [items]);

  const titleFor = (entry: CanonicalEntry) => {
    const translations = entry.translations || {};
    return (
      entry.localized_title ||
      translations[locale]?.title ||
      translations["en-US"]?.title ||
      translations[entry.original_language || ""]?.title ||
      entry.title
    );
  };

  const renderEntries = (parentKey: string, depth: number): ReactNode[] => {
    return (children.get(parentKey) || []).flatMap((entry) => {
      const role = entry.entry_role || "main";
      return [
        <div
          key={entry.id}
          className="flex items-center gap-3 px-3.5 py-2.5 border-b border-black/5 dark:border-white/[0.06] last:border-b-0"
          style={{ paddingLeft: `${14 + depth * 22}px` }}
        >
          <span className="w-10 shrink-0 text-right font-mono text-xs text-gray-400">
            {entry.number || entry.position || "—"}
          </span>
          <Link href={`/canonical-entries/${entry.id}`} className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200 hover:text-primary">
            {titleFor(entry)}
          </Link>
          <span className="shrink-0 rounded-sm border border-black/10 dark:border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
            {t(`catalog.contents.role.${role}`)}
          </span>
        </div>,
        ...renderEntries(entry.id, depth + 1),
      ];
    });
  };

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
      <div className="px-3.5 sm:px-4 py-3 border-b border-black/5 dark:border-white/[0.06] flex items-center gap-2">
        <span className="w-9 h-9 grid place-items-center rounded-md bg-primary/10 border border-primary/20">
          <ListTree className="w-4 h-4 text-primary" strokeWidth={1.5} />
        </span>
        <h2 className="font-display text-base font-bold tracking-tight text-gray-900 dark:text-white">
          {t("work.contents.title")}
        </h2>
        {!loading && <span className="font-mono text-sm text-gray-500">{t("work.contents.count", { count: items.length })}</span>}
      </div>
      {loading ? (
        <div className="p-6 text-center font-mono text-sm text-gray-500">{t("work.contents.loading")}</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center font-mono text-sm text-gray-500">{t("work.contents.empty")}</div>
      ) : (
        <div>{renderEntries("root", 0)}</div>
      )}
    </section>
  );
}
