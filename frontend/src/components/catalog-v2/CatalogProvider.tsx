"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { api, Capability, Definition, User } from "./api";
import { useI18n } from "@/i18n/I18nProvider";
const Context = createContext<{
  definition?: Definition;
  user?: User;
  modules: Capability[];
  setup: boolean;
  refresh: () => Promise<void>;
}>({ modules: [], setup: false, refresh: async () => {} });
export const useCatalog = () => useContext(Context);
export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const [definition, setDefinition] = useState<Definition>();
  const [user, setUser] = useState<User>();
  const [modules, setModules] = useState<Capability[]>([]);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    const results = await Promise.allSettled([
      api<Definition>("/catalog/definitions"),
      api<User>("/auth/me"),
      api<{ modules: Capability[] }>("/capabilities"),
      api<{ needed: boolean }>("/setup"),
    ]);
    if (results[0].status === "fulfilled") {
      setDefinition(results[0].value);
      setError("");
    } else setError(results[0].reason.message);
    setUser(results[1].status === "fulfilled" ? results[1].value : undefined);
    setModules(
      results[2].status === "fulfilled" ? results[2].value.modules : [],
    );
    setSetup(results[3].status === "fulfilled" && results[3].value.needed);
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Context.Provider value={{ definition, user, modules, setup, refresh }}>
      <div className="catalog-v2">
        
        <main className="cv-main">
          {error && (
            <div role="alert" className="cv-error">
              {t("catalogV2.connectionError")}
              <button onClick={refresh}>{t("catalogV2.retry")}</button>
            </div>
          )}
          {children}
        </main>
      </div>
    </Context.Provider>
  );
}
