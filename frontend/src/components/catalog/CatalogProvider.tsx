"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { api, Capability } from "./api";
import { useI18n } from "@/i18n/I18nProvider";

// 目录页的共享上下文只保留非定义职责：模块开关与实例初始化状态。
// 定义（types/fields/relations/vocabularies…）的唯一来源是 lib/definitions.ts 的
// useDefinitions()（带版本缓存、订阅与发布后失效）；会话用户来自 lib/authContext 的
// useAuth()。这两样此前在这里各存了一份 React state，于是同一份数据有了第二份缓存：
// 后台发布新定义后，只有拿到 Provider 那一份的组件会变，没挂 Provider 的路由
// （/compare、/releases/[id]）则连字段名都取不到，只能显示裸字段码。
const Context = createContext<{
  modules: Capability[];
  setup: boolean;
  refresh: () => Promise<void>;
}>({ modules: [], setup: false, refresh: async () => {} });

export const useCatalog = () => useContext(Context);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [modules, setModules] = useState<Capability[]>([]);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    const results = await Promise.allSettled([
      api<{ modules: Capability[] }>("/capabilities"),
      api<{ needed: boolean }>("/setup"),
    ]);
    // 能力探测失败会让依赖模块的分节整块消失（如社区分节）：必须说清是实例连不上，
    // 而不是"这个功能不存在"，并留一个重试入口。
    if (results[0].status === "fulfilled") {
      // 契约漂移防御：/capabilities 少了 modules（或它不是数组）时，绝不能让 undefined 进 state——
      // 消费方（详情页、定义编辑器）是**渲染路径**上的 .some()/.map()，抛一次就是整页白屏。
      // 取不到就落回空列表，等价于"没有可用子系统"，页面自然降级而不是崩掉。
      setModules(Array.isArray(results[0].value?.modules) ? results[0].value.modules : []);
      setError("");
    } else setError((results[0].reason as Error).message);
    setSetup(results[1].status === "fulfilled" && results[1].value.needed);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Context.Provider value={{ modules, setup, refresh }}>
      {error && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500/20 text-danger text-xs font-mono text-center">
          {t("catalog.connectionError")}
          <button onClick={refresh} className="ml-2 underline">{t("catalog.retry")}</button>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
