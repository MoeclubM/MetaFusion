"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ListTree } from "lucide-react";
import { Entity, title as entityTitle } from "@/components/catalog/api";
import { fetchAllPages } from "@/components/catalog/api";
import { useI18n } from "@/i18n/I18nProvider";
import { getTermName, useDefinitions } from "@/lib/definitions";

type WorkContentDirectoryProps = {
  workId: string;
  /** 模板声明的目录形态（definitions.templates[*].directory）：tree 保留层级缩进，
   *  list 拍平为单层编号列表。两者共用同一份数据，只改变呈现，不改变内容。 */
  directory?: string;
};

// 目录条目视图：三种形态**各自独立**成区块，不再互斥回退。
//   ① 篇目树（content_unit）——小说章节、动画分集；
//   ② 表达（expression）——无卷章树的作品（如 OST 的各个录音）；
//   ③ includes 关联的**组成作品**——专辑由独立歌曲 Work 构成时的正向关系；
//   ④ includes 关联的**所属集合/作品**——歌曲在专辑之下的反向关系。
// 情形 ①②③④ 可以同时存在：专辑既有自身表达，又由独立歌曲构成时，
// 旧实现只显示其中一个，把其余内容全部隐藏。entry_role 是篇目类型，组成作品用 kind 标签区分。
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
  // 表达（expression）通过 content_unit_id 挂载到所属章节，章节（content_unit）通过 parent_id 支持树形层级
  const parentId = e.kind === "expression"
    ? (e.content_unit_id || e.parent_id || "")
    : (e.parent_id || "");
  return {
    id: e.id || "",
    parentId,
    position: e.position || 0,
    number: e.number || "",
    entryRole: String(e.attributes?.entry_role || ""),
    kind: e.kind || "",
    title: entityTitle(e, locale) || e.title || e.id || "",
  };
}

// componentEntries 从 includes 关系里取关联作品，并按**方向**区分语义：
//   self 是包含方（source_id） → 对端是"组成内容"；
//   self 是被包含方（target_id） → 对端是"所属集合/作品"。
// 旧实现把两个方向都当"组成内容"，于是歌曲页会把所属专辑列进自己的内容目录。
// 报告复现场景的回归锚点：歌曲无 Expression 时所属专辑不得进组成内容，
// 专辑有自身表达时组成歌曲不得被隐藏（三区块独立成段，见下方 blocks）。
export type RelationRow = {
  type: string;
  source_id: string;
  target_id: string;
  position?: number;
};

export function componentEntries(
  relations: RelationRow[],
  entities: Record<string, Entity>,
  selfId: string,
  locale: string,
  /** 由调用方按关系定义判定"这条关系是否表达组成/聚合"，避免写死关系码。 */
  isAggregate: (code: string) => boolean = () => false,
): { includes: DirectoryEntry[]; includedIn: DirectoryEntry[] } {
  const includes: DirectoryEntry[] = [];
  const includedIn: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (!isAggregate(r.type)) continue;
    const outgoing = r.source_id === selfId;
    const peerId = outgoing ? r.target_id : r.source_id;
    if (!peerId || peerId === selfId || seen.has(peerId)) continue;
    const peer = entities[peerId];
    if (!peer || (peer.kind !== "work" && peer.kind !== "collection")) continue;
    seen.add(peerId);
    const entry: DirectoryEntry = {
      id: peerId,
      parentId: "",
      position: r.position || 0,
      number: "",
      entryRole: "",
      kind: peer.kind || "work",
      title: entityTitle(peer, locale) || peer.title || peerId,
    };
    (outgoing ? includes : includedIn).push(entry);
  }
  const byOrder = (a: DirectoryEntry, b: DirectoryEntry) =>
    a.position !== b.position ? a.position - b.position : a.title.localeCompare(b.title);
  includes.sort(byOrder);
  includedIn.sort(byOrder);
  return { includes, includedIn };
}

export function WorkContentDirectory({ workId, directory = "tree" }: WorkContentDirectoryProps) {
  const { t, tr, locale } = useI18n();
  const { definitions: defs } = useDefinitions();
  const [items, setItems] = useState<DirectoryEntry[]>([]);
  const [components, setComponents] = useState<DirectoryEntry[]>([]);
  const [includedIn, setIncludedIn] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        // 篇目与表达分开展示，各取各的；不再"有篇目就不看表达"。
        const [units, exprs] = await Promise.all([
          fetchAllPages<Entity>(`/catalog/entities?kind=content_unit&work_id=${encodeURIComponent(workId)}`),
          fetchAllPages<Entity>(`/catalog/entities?kind=expression&work_id=${encodeURIComponent(workId)}`),
        ]);
        // 专辑的歌曲以独立 Work 通过 includes 关联：列出组成作品与所属作品，
        // 而不是把各歌曲的录音复制到专辑之下（那会丢掉歌曲的独立身份）。
        const rel = await fetch(`/api/catalog/entities/${encodeURIComponent(workId)}/relations`, {
          credentials: "same-origin",
        }).then((res) => (res.ok ? res.json() : { items: [], entities: {} }));
        const { includes, includedIn: parents } = componentEntries(
          rel.items || [],
          rel.entities || {},
          workId,
          locale,
          // 组成关系由定义声明（aggregate），新增聚合类关系不用改这里。
          (code) => defs?.relations?.[code]?.aggregate === true,
        );
        if (!active) return;
        setItems([...units.map((e) => toEntry(e, locale)), ...exprs.map((e) => toEntry(e, locale))]);
        setComponents(includes);
        setIncludedIn(parents);
      } catch {
        if (active) {
          setItems([]);
          setComponents([]);
          setIncludedIn([]);
        }
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

  // 篇目用途名称以 definitions 的 entry_role 词表为准（后台新增用途即刻显示）；
  // 词表未声明该用途时回退内置文案，仍缺失则显示原始码。
  const roleLabel = (role: string): string => {
    const name = getTermName(defs, "entry_role", role, locale);
    return name !== role ? name : tr(`catalog.contents.role.${role}`, role);
  };

  const renderEntries = (parentKey: string, depth: number): ReactNode[] => {
    return (children.get(parentKey) || []).flatMap((entry) => {
      const role = entry.entryRole || "main";
      // directory=list 时拍平为单层（仍保留原次序并完整展开子章节），tree 时按父子层级缩进。
      const indent = directory === "list" ? 0 : depth * 22;
      const isCollectionOrWork = entry.kind === "work" || entry.kind === "collection";
      return [
        <div
          key={entry.id}
          className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line-subtle last:border-b-0"
          style={{ paddingLeft: `${14 + indent}px` }}
        >
          <span className="w-10 shrink-0 text-right font-mono text-xs text-gray-400">
            {entry.number || entry.position || "—"}
          </span>
          <Link href={`/catalog/${entry.id}`} className="min-w-0 flex-1 truncate text-sm text-text-strong hover:text-primary">
            {entry.title}
          </Link>
          <span className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
            {isCollectionOrWork ? t(`catalog.kind.${entry.kind}`) : roleLabel(role)}
          </span>
        </div>,
        ...renderEntries(entry.id, depth + 1),
      ];
    });
  };

  // 三个区块各自独立呈现：篇目/表达、组成内容（includes 正向）、
  // 所属作品/集合（includes 反向）。同一页可同时出现多个，不再互斥回退。
  const blocks: { key: string; title: string; entries: DirectoryEntry[] }[] = [];
  if (items.length > 0) blocks.push({ key: "items", title: t("work.contents.title"), entries: items });
  if (components.length > 0) blocks.push({ key: "components", title: t("work.contents.components"), entries: components });
  if (includedIn.length > 0) blocks.push({ key: "includedIn", title: t("work.contents.includedIn"), entries: includedIn });

  const renderSimple = (entries: DirectoryEntry[]) =>
    entries.map((entry) => (
      <div
        key={entry.id}
        className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line-subtle last:border-b-0"
      >
        <span className="w-10 shrink-0 text-right font-mono text-xs text-gray-400">{entry.number || entry.position || "—"}</span>
        <Link href={`/catalog/${entry.id}`} className="min-w-0 flex-1 truncate text-sm text-text-strong hover:text-primary">
          {entry.title}
        </Link>
        <span className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
          {t(`catalog.kind.${entry.kind}`)}
        </span>
      </div>
    ));

  return (
    <div className="space-y-3">
      {blocks.map((block) => (
        <section
          key={block.key}
          className="rounded-lg border border-line bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden"
        >
          <div className="px-3.5 sm:px-4 py-3 border-b border-line-subtle flex items-center gap-2">
            <span className="w-9 h-9 grid place-items-center rounded-md bg-primary/10 border border-primary/20">
              <ListTree className="w-4 h-4 text-primary" strokeWidth={1.5} />
            </span>
            <h2 className="font-display text-base font-bold tracking-tight text-text-strong">
              {block.title}
            </h2>
            {!loading && (
              <span className="font-mono text-sm text-gray-500">{t("work.contents.count", { count: block.entries.length })}</span>
            )}
          </div>
          {loading ? (
            <div className="p-6 text-center font-mono text-sm text-gray-500">{t("work.contents.loading")}</div>
          ) : block.key === "items" ? (
            <div>{renderEntries("root", 0)}</div>
          ) : (
            <div>{renderSimple(block.entries)}</div>
          )}
        </section>
      ))}
      {!loading && blocks.length === 0 && (
        <section className="rounded-lg border border-line bg-surface/80 backdrop-blur-md shadow-soft overflow-hidden">
          <div className="px-3.5 sm:px-4 py-3 border-b border-line-subtle flex items-center gap-2">
            <span className="w-9 h-9 grid place-items-center rounded-md bg-primary/10 border border-primary/20">
              <ListTree className="w-4 h-4 text-primary" strokeWidth={1.5} />
            </span>
            <h2 className="font-display text-base font-bold tracking-tight text-text-strong">
              {t("work.contents.title")}
            </h2>
          </div>
          <div className="p-6 text-center font-mono text-sm text-gray-500">{t("work.contents.empty")}</div>
        </section>
      )}
    </div>
  );
}