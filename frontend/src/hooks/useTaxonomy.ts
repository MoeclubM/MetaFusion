"use client";

import { useEffect, useState } from "react";
import { fetchApi, TaxonomyResponse } from "@/lib/api";

let cachedTaxonomy: TaxonomyResponse | null = null;
let pendingPromise: Promise<TaxonomyResponse> | null = null;

export function fetchTaxonomyCached(): Promise<TaxonomyResponse> {
  if (cachedTaxonomy) {
    return Promise.resolve(cachedTaxonomy);
  }
  if (pendingPromise) {
    return pendingPromise;
  }
  pendingPromise = fetchApi<TaxonomyResponse>("/catalog/taxonomy")
    .then((data) => {
      cachedTaxonomy = data;
      pendingPromise = null;
      return data;
    })
    .catch((err) => {
      pendingPromise = null;
      throw err;
    });
  return pendingPromise;
}

export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(cachedTaxonomy);
  const [loading, setLoading] = useState(!cachedTaxonomy);

  useEffect(() => {
    let active = true;
    if (!cachedTaxonomy) {
      setLoading(true);
      fetchTaxonomyCached()
        .then((data) => {
          if (active) {
            setTaxonomy(data);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });
    } else {
      setTaxonomy(cachedTaxonomy);
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, []);

  return { taxonomy, loading };
}
