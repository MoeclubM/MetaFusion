"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ListTree } from "lucide-react";
import { Entity, title as entityTitle } from "@/components/catalog/api";
import { fetchAllPages } from "@/components/catalog/api";
import { useI18n } from "@/i18n/I18nProvider";

type WorkContentDirectoryProps = {
  workId: string;
};

// 目录条目视图：按三种形态依次回退，页面始终有内容可看。
//   ① 篇目树（content_unit）——小说章节、动画分集；
//   ② 表达（expression）——无卷章树的作品（如 OST 的各个录音）；
//   ③ includes 关联的组成作品——专辑由独立歌曲 Work 构成时（歌曲保持自己的
//      创作身份与跨专辑复用，不把录音复制挂到专辑下），列出其组成作品。
// entry_role 是 definitions 声明的篇目类型；组成作品用 kind 标签区分。
type DirectoryEntry = {
  id: string;
  parentId: string;
  position: number;
  number: string;
  entryRole: string;
  /** 条目对应的实体 kind：组成作品列为 "work"，其余为篇目/表达本身。 */
  kind: string;
  title: string;
};

function toEntry(e: Entity, locale: string): DirectoryEntry {
  return {
    id: e.id || "",
    parentId: e.parent_id || "",
    position: e.position || 0,
    number: e.number || "",
    entryRole: String(e.attributes?.entry_role || ""),
    kind: e.kind || "",
    title: entityTitle(e, locale) || e.title || e.id || "",
  };
}

// componentEntries 从关系里取 includes 的组成作品：专辑页与歌曲页方向相反
// （专辑→歌曲为正向，歌曲→专辑为反向），两侧都取，只保留 work 对端。
// 顺序按关系 position，其次标题，保证曲序稳定。
type RelationRow = {
  type: string;
  source_id: string;
  target_id: string;
  position?: number;
};

function componentEntries(
  relations: RelationRow[],
  entities: Record<string, Entity>,
  selfId: string,
  locale: string,
): DirectoryEntry[] {
  const out: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r.type !== "includes") continue;
    const peerId = r.source_id === selfId ? r.target_id : r.source_id;
    if (!peerId || peerId === selfId || seen.has(peerId)) continue;
    const peer = entities[peerId];
    if (!peer || peer.kind !== "work") continue;
    seen.add(peerId);
    out.push({
      id: peerId,
      parentId: "",
      position: r.position || 0,
      number: "",
      entryRole: "",
      kind: "work",
      title: entityTitle(peer, locale) || peer.title || peerId,
    });
  }
  out.sort((a, b) => (a.position !== b.position ? a.position - b.position : a.title.localeCompare(b.title)));
  return out;
}

export function WorkContentDirectory({ workId }: WorkContentDirectoryProps) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const units = await fetchAllPages<Entity>(`/catalog/entities?kind=content_unit&work_id=${encodeURIComponent(workId)}`);
        if (units.length > 0) {
          if (active) setItems(units.map((e) => toEntry(e, locale)));
          return;
        }
        const exprs = await fetchAllPages<Entity>(`/catalog/entities?kind=expression&work_id=${encodeURIComponent(workId)}`);
        if (exprs.length > 0) {
          if (active) setItems(exprs.map((e) => toEntry(e, locale)));
          return;
        }
        // 专辑的歌曲以独立 Work 通过 includes 关联：列出组成作品，
        // 而不是把各歌曲的录音复制到专辑之下（那会丢掉歌曲的独立身份）。
        const rel = await fetch(`/api/catalog/entities/${encodeURIComponent(workId)}/relations`, {
          credentials: "same-origin",
        }).then((res) => (res.ok ? res.json() : { items: [], entities: {} }));
        if (active) {
          setItems(
            componentEntries(rel.items || [], rel.entities || {}, workId, locale),
          );
        }
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [workId, locale]);

  const children = useMemo(() => {
    const grouped = new Map<string, DirectoryEntry[]>();
    for (const item of items) {
      const key = item.parentId || "root";
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    }
    // 服务端列表默认按 updated_at 倒序，不排序会让新建/修改章节改变目录次序。
    // 在每个父节点内按结构位置稳定排序，编号仅作同位次时的次序兜底。
    for (const list of Array.from(grouped.values())) {
      list.sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.number.localeCompare(b.number, undefined, { numeric: true });
      });
    }
    return grouped;
  }, [items]);

  const renderEntries = (parentKey: string, depth: number): ReactNode[] => {
    return (children.get(parentKey) || []).flatMap((entry) => {
      const role = entry.entryRole || "main";
      return [
        <div
          key={entry.id}
          className="flex items-center gap-3 px-3.5 py-2.5 border-b border-black/5 dark:border-white/[0.06] last:border-b-0"
          style={{ paddingLeft: `${14 + depth * 22}px` }}
        >
          <span className="w-10 shrink-0 text-right font-mono text-xs text-gray-400">
            {entry.number || entry.position || "—"}
          </span>
          <Link href={`/catalog/${entry.id}`} className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200 hover:text-primary">
            {entry.title}
          </Link>
          <span className="shrink-0 rounded-sm border border-black/10 dark:border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
            {entry.kind === "work" ? t("catalog.kind.work") : t(`catalog.contents.role.${role}`)}
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
