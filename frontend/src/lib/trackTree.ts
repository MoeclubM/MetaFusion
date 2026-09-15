import type { Entity } from "@/components/catalog/api";

// orderedTracksWithDepth：把曲目树（章 / 子轨）深度优先展开成"父轨后紧跟其子轨"的
// 展示序列，子轨带层级深度供缩进；排序只看 position，不用曲号充当身份。
// 发行页与介质页共用同一实现，避免同一棵树在两处各自排序、各写一份而漂移。
export function orderedTracksWithDepth(
  tracks: Entity[]
): { track: Entity; depth: number }[] {
  const byId = new Map<string, Entity>();
  for (const tr of tracks) if (tr.id) byId.set(tr.id, tr);
  const childrenOf = new Map<string, Entity[]>();
  const roots: Entity[] = [];
  for (const tr of tracks) {
    const pid = tr.parent_id || "";
    if (pid && byId.has(pid)) {
      const list = childrenOf.get(pid) || [];
      list.push(tr);
      childrenOf.set(pid, list);
    } else {
      roots.push(tr);
    }
  }
  const byPos = (a: Entity, b: Entity) => (a.position || 0) - (b.position || 0);
  roots.sort(byPos);
  childrenOf.forEach((list) => list.sort(byPos));
  const out: { track: Entity; depth: number }[] = [];
  const walk = (list: Entity[], depth: number) => {
    for (const tr of list) {
      out.push({ track: tr, depth });
      const kids = childrenOf.get(tr.id!) || [];
      if (kids.length > 0) walk(kids, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
