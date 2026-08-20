"use client";

import React, { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { fetchApi, InviteInfoResponse } from "@/lib/api";
import { useAuth } from "@/lib/authContext";
import { Copy, Check, Link2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export default function InvitesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [inviteInfo, setInviteInfo] = useState<InviteInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (user) {
      fetchApi<InviteInfoResponse>("/auth/invite")
        .then(setInviteInfo)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else setLoading(false);
  }, [user]);

  const inviteCode = inviteInfo?.invite_code || (user as any)?.invite_code || t("invite.fallbackCode");
  const invitedUsers = inviteInfo?.invited_users || [];

  const copy = (type: "code" | "link") => {
    const text = type === "code" ? inviteCode : `${typeof window !== "undefined" ? window.location.origin : ""}/login?invite=${encodeURIComponent(inviteCode)}`;
    navigator.clipboard.writeText(text);
    setCopiedField(type);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-5 w-full flex-1 space-y-4 sm:space-y-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{t("invite.title")}</h1>

        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-soft">
          <div>
            <div className="font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-white">{inviteCode}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => copy("code")}
              className="h-7.5 px-3 rounded-md bg-primary text-white keep-white hover:opacity-90 font-medium inline-flex items-center gap-1.5 text-xs transition-opacity shadow-xs"
            >
              {copiedField === "code" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === "code" ? t("common.copied") : t("common.copy")}</span>
            </button>
            <button
              onClick={() => copy("link")}
              className="h-7.5 px-3 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:text-primary inline-flex items-center gap-1.5 text-xs transition-colors"
            >
              {copiedField === "link" ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>{copiedField === "link" ? t("common.copied") : t("common.copyLink")}</span>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface overflow-hidden shadow-soft">
          <div className="px-3.5 py-2.5 border-b border-black/5 dark:border-white/[0.06] flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
            <span className="font-medium text-gray-900 dark:text-white text-xs">{t("invite.invitedMembers", { count: invitedUsers.length })}</span>
            <span className="font-mono text-[10px] uppercase text-gray-500">{t("invite.invitedMembersShort")}</span>
          </div>
          {loading ? (
            <div className="p-8 text-center font-mono text-xs text-gray-500">{t("invite.loading")}</div>
          ) : invitedUsers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-xs text-gray-900 dark:text-white font-medium">{t("invite.noMembers")}</p>
              <p className="font-mono text-[11px] text-gray-500 mt-1">{t("invite.noMembersHint")}</p>
            </div>
          ) : (
            <div className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {invitedUsers.map((member) => (
                <div key={member.id} className="px-3.5 py-2.5 flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                  <div>
                    <span className="text-xs font-medium text-gray-900 dark:text-white">{member.username}</span>
                    <span className="block font-mono text-[10px] text-gray-500">{member.email}</span>
                  </div>
                  <span className="font-mono text-[10px] text-gray-500">
                    {member.created_at ? new Date(member.created_at).toLocaleDateString() : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
