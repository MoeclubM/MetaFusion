"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { displayNameOf } from "@/lib/api";
import { Users, Copy, Check, Pencil, X, AlertCircle } from "lucide-react";
import type { AdminDashboard } from "../../hooks/useAdminDashboard";

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function UsersTab({
  loading,
  filteredUsers,
  roleUpdatingId,
  user,
  handleUpdateRole,
  handleUpdateUser,
}: Pick<AdminDashboard, "loading" | "filteredUsers" | "roleUpdatingId" | "user" | "handleUpdateRole" | "handleUpdateUser">) {
  const { t } = useI18n();

  const [editing, setEditing] = useState<any | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1400);
    } catch {}
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setEditEmail(u.email || "");
    setEditDisplayName(((u as any).display_name as string) || "");
    setEditPassword("");
    setEditRole(u.role || "member");
    setEditErr(null);
  };

  const submitEdit = async () => {
    if (!editing) return;
    const originalEmail = (editing.email || "").trim();
    const originalDn = (((editing as any).display_name as string) || "").trim();
    const nextEmail = editEmail.trim();
    const nextDn = editDisplayName.trim();
    const nextRole = editRole.trim();
    const nextPw = editPassword;

    const payload: Record<string, string> = {};
    if (nextEmail !== originalEmail && nextEmail !== "") payload.email = nextEmail;
    if (nextDn !== originalDn) payload.display_name = nextDn;
    if (nextRole !== editing.role) payload.role = nextRole;
    if (nextPw !== "") {
      if (nextPw.length < 8) {
        setEditErr(t("admin.users.passwordTooShort") || "密码至少 8 位");
        return;
      }
      payload.password = nextPw;
    }
    if (Object.keys(payload).length === 0) {
      setEditErr(t("admin.users.noChanges") || "未做任何修改");
      return;
    }
    setEditSaving(true);
    setEditErr(null);
    try {
      await handleUpdateUser(editing.id, payload);
      setEditing(null);
    } catch (e: any) {
      setEditErr(e.message || t("auth.requestFailed"));
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            {t("admin.users.title")}
          </h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.users.subtitle")}</p>
        </div>
        {!loading && filteredUsers.length > 0 && (
          <span className="text-[11px] font-mono text-gray-500 border border-white/10 rounded-full px-2.5 py-1 bg-white/[0.03]">
            {t("admin.users.total", { count: String(filteredUsers.length) }) || `${filteredUsers.length} members`}
          </span>
        )}
      </div>

      <p className="text-[11px] font-mono text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
        {t("admin.users.selfProtectHint") ||
          "提示：不可封禁/降权自己；系统会保留至少一名管理员。昵称留空则回退显示用户名。"}
      </p>

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="bg-background/80 text-gray-400 border-b border-surfaceBorder text-[11px] font-mono">
              <tr>
                <th className="py-3 px-3">{t("admin.users.colId") || "ID"}</th>
                <th className="py-3 px-3">{t("admin.users.colUser")}</th>
                <th className="py-3 px-3">{t("admin.users.colNickname") || "昵称"}</th>
                <th className="py-3 px-3">{t("admin.users.colEmail") || "邮箱"}</th>
                <th className="py-3 px-3">{t("admin.users.colRole")}</th>
                <th className="py-3 px-3">{t("admin.users.colTime")}</th>
                <th className="py-3 px-3 text-right">{t("common.edit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surfaceBorder/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500 font-mono">
                    {t("common.loadingGeneric")}
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500 font-mono">
                    {t("admin.users.noData")}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u: any) => {
                  const dn = displayNameOf(u);
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => copyText(u.id, `id-${u.id}`)}
                          title={u.id}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-300 hover:text-amber-300 border border-white/10 rounded px-1.5 py-0.5 bg-white/[0.03] transition-colors"
                        >
                          <span>{shortId(u.id)}</span>
                          {copiedId === `id-${u.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-60" />}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          <span className="truncate max-w-[120px]">{u.username}</span>
                          {u.role === "admin" && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">ADMIN</span>
                          )}
                          {u.role === "archivist" && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">ARCHIVIST</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono">{u.invite_code || "—"}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={dn !== u.username ? "text-white font-medium" : "text-gray-400"}>{dn}</span>
                        {dn !== u.username && <span className="ml-1 text-[10px] text-gray-500 font-mono">@{u.username}</span>}
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono text-[11px] text-gray-300 truncate max-w-[160px] inline-block align-middle">{u.email || "—"}</span>
                        {u.email && (
                          <button
                            type="button"
                            onClick={() => copyText(u.email, `em-${u.id}`)}
                            className="ml-1 inline-grid place-items-center w-5 h-5 rounded bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] align-middle"
                            title={t("common.copy")}
                          >
                            {copiedId === `em-${u.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-gray-400" />}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <select
                          value={u.role}
                          disabled={roleUpdatingId === u.id || isSelf}
                          onChange={(e) => handleUpdateRole(u.id, e.target.value)}
                          className="px-2 py-1 rounded bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400 disabled:opacity-40"
                        >
                          <option value="member">{t("admin.users.roleUser")}</option>
                          <option value="archivist">{t("admin.users.roleArchivist")}</option>
                          <option value="admin">{t("admin.users.roleAdmin")}</option>
                          <option value="banned">{t("admin.users.roleBanned")}</option>
                        </select>
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-400 text-[11px] whitespace-nowrap">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-medium transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          {t("common.edit")}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="close" onClick={() => setEditing(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#141418] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">{t("admin.users.editTitle") || "编辑成员"}</h3>
              <button type="button" onClick={() => setEditing(null)} className="w-7 h-7 grid place-items-center rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="rounded-md bg-white/[0.04] border border-white/10 px-3 py-2 font-mono text-[11px] text-gray-400">
                <div className="flex justify-between gap-2">
                  <span>ID</span>
                  <span className="text-gray-200 truncate ml-2">{editing.id}</span>
                </div>
                <div className="flex justify-between gap-2 mt-1">
                  <span>{t("admin.users.colUser")}</span>
                  <span className="text-gray-200">{editing.username}</span>
                </div>
              </div>

              {editErr && (
                <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md px-2.5 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{editErr}</span>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-300">{t("admin.users.fieldEmail") || "邮箱"}</span>
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full h-8.5 px-3 rounded-md bg-white/[0.06] border border-white/15 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-300">{t("admin.users.fieldNickname") || "昵称"}</span>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder={t("settings.displayNamePlaceholder") || "留空则显示用户名"}
                  maxLength={64}
                  className="w-full h-8.5 px-3 rounded-md bg-white/[0.06] border border-white/15 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
                />
                <span className="text-[11px] text-gray-500 font-mono">{t("admin.users.fieldNicknameHint") || "昵称独立于用户名，留空回退到用户名"}</span>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-300">{t("admin.users.fieldPassword") || "新密码（留空不改）"}</span>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-8.5 px-3 rounded-md bg-white/[0.06] border border-white/15 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-300">{t("admin.users.fieldRole") || "角色"}</span>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  disabled={editing.id === user?.id}
                  className="w-full h-8.5 px-2 rounded-md bg-white/[0.06] border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400 disabled:opacity-40"
                >
                  <option value="member">{t("admin.users.roleUser")}</option>
                  <option value="archivist">{t("admin.users.roleArchivist")}</option>
                  <option value="admin">{t("admin.users.roleAdmin")}</option>
                  <option value="banned">{t("admin.users.roleBanned")}</option>
                </select>
              </label>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditing(null)} className="flex-1 h-8.5 rounded-md bg-white/[0.06] border border-white/10 text-sm text-gray-300 hover:bg-white/[0.10]">
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={editSaving}
                  className="flex-1 h-8.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {editSaving && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
                  {t("common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
