"use client";

import { useI18n } from "@/i18n/I18nProvider";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

export function TopicsTab({
  loading,
  topicsList,
  handleDeleteTopic,
}: Pick<AdminDashboard, "loading" | "topicsList" | "handleDeleteTopic">) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-400" />
            {t("admin.topics.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.topics.subtitle")}</p>
        </div>
      </div>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
            <tr>
              <th className="py-3 px-4">{t("admin.topics.colTitle")}</th>
              <th className="py-3 px-3">{t("admin.topics.colAuthor")}</th>
              <th className="py-3 px-3">{t("admin.topics.colBoard")}</th>
              <th className="py-3 px-3">{t("admin.topics.colTime")}</th>
              <th className="py-3 px-4 text-right">{t("admin.topics.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surfaceBorder/60">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("common.loadingGeneric")}
                </td>
              </tr>
            ) : topicsList.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500 font-mono">
                  {t("admin.topics.noData")}
                </td>
              </tr>
            ) : (
              topicsList.map((topic) => (
                <tr key={topic.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-4">
                    <Link href={`/community/${topic.id}`} target="_blank" className="font-semibold text-white hover:text-amber-400 transition-colors">
                      {topic.title}
                    </Link>
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-300">{topic.user?.username || "—"}</td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-white/[0.06] border border-white/10 text-gray-300">{topic.board_code}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-gray-400 text-[11px]">{new Date(topic.created_at).toLocaleDateString()}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDeleteTopic(topic.id)}
                      className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs"
                    >
                      {t("admin.topics.delete")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
