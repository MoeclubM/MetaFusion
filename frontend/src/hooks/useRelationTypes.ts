"use client";

import { useEffect, useState } from "react";
import { fetchApi, RelationType } from "@/lib/api";

export function useRelationTypes(domain?: string) {
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    fetchApi<{ items: RelationType[] }>(`/catalog/relation-types${query}`)
      .then((res) => {
        if (!cancelled) setRelationTypes(res.items || []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load relation types");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  return { relationTypes, loading, error };
}
