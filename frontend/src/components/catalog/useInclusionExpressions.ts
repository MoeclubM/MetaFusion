"use client";

import { useEffect, useState } from "react";
import { api, Entity, mapLimit } from "./api";

/** 将整个目录的表达引用去重后批量读取，避免每个收录行单独请求。 */
export function useInclusionExpressions(ids: string[], viewerId = "") {
  const key = Array.from(new Set(ids.filter(Boolean))).sort().join(",");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    viewerId: string;
    expressions: Record<string, Entity>;
    loading: boolean;
    failedCount: number;
  }>({ key: "", viewerId: "", expressions: {}, loading: false, failedCount: 0 });

  useEffect(() => {
    let active = true;
    if (!key) {
      setState({ key, viewerId, expressions: {}, loading: false, failedCount: 0 });
      return;
    }
    setState({ key, viewerId, expressions: {}, loading: true, failedCount: 0 });
    const requested = key.split(",");
    const batches: string[][] = [];
    // POST /expressions/details 的契约上限为 500 个 id。
    for (let i = 0; i < requested.length; i += 500) batches.push(requested.slice(i, i + 500));
    void (async () => {
      const expressions: Record<string, Entity> = {};
      await mapLimit(batches, 2, async (batch) => {
        try {
          const result = await api<{ items: Record<string, { entity: Entity }> }>(
            "/catalog/expressions/details", "POST", { ids: batch },
          );
          for (const id of batch) {
            const entity = result.items?.[id]?.entity;
            if (entity?.kind === "expression") expressions[id] = entity;
          }
        } catch {
          // 缺口保留为失败，不逐行回退请求，也不伪装成没有收录。
        }
      });
      if (active) setState({
        key, viewerId, expressions, loading: false,
        failedCount: requested.filter((id) => !expressions[id]).length,
      });
    })();
    return () => { active = false; };
  }, [key, viewerId, attempt]);

  const current: Pick<typeof state, "expressions" | "loading" | "failedCount"> = state.key === key && state.viewerId === viewerId
    ? state
    : { expressions: {}, loading: Boolean(key), failedCount: 0 };
  return { ...current, retry: () => setAttempt((value) => value + 1) };
}
