"use client";

// 成员治理面板：列表 + 搜索 + 改角色 + 改密码 + 封禁/解封 + 权限组分配。
//
// 契约来源（只读核对，未改账号服务代码）：
//   metafusion-auth/internal/handler/handler.go:299-355  —— 路由与响应形状
//   metafusion-auth/internal/store/identity.go:295-478   —— 护栏与稳定错误码
//   metafusion-auth/internal/store/groups.go:200-245     —— SetUserGroups 覆盖式写入
//
// 两个只读来源的所需权限不同（列表要 auth.users.manage、权限组清单要 auth.groups.manage），
// 所以各自独立取数：任一 403 只让它自己那块降级，不能把整页拖黑。
//
// 角色与权限组是同一份事实的两处投影：store.UpdateUserRole 会把成员关系整组删掉再按
// RoleToGroups 重建，手工分配的自定义组因此会被覆盖。界面不藏这个副作用——改角色时
// 直接锁住组选择并写明原因，而不是先提交再让管理员发现权限没了。

import React, { useMemo, useState } from "react";
import { Ban, KeyRound, RefreshCw, Search, ShieldCheck, UserCheck, UserCog, UserPlus, Users } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import {
  ADMIN_ROLES,
  createAdminUser,
  describeUserAdminError,
  fetchAdminGroups,
  fetchAdminUsers,
  resetAdminUserPassword,
  roleLabelKey,
  setAdminUserBanned,
  setAdminUserGroups,
  updateAdminUserRole,
  type AdminGroup,
  type AdminUser,
} from "./accountAccess/api";
import {
  ErrorNotice,
  LoadingBlock,
  RefreshButton,
  SectionHeader,
  StatusMessage,
  sortGroups,
  useAdminResource,
} from "./accountAccess/shared";

// 模块级常量：useAdminResource 的 initial 必须是稳定引用，否则会反复重新取数。
const EMPTY_USERS: AdminUser[] = [];
const EMPTY_GROUPS: AdminGroup[] = [];
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 72;

function sameGroupSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((code) => set.has(code));
}

export function UsersTab() {
  const { t } = useI18n();
  const { user: me } = useAuth();

  const users = useAdminResource(fetchAdminUsers, EMPTY_USERS, "auth.users.manage");
  const groups = useAdminResource(fetchAdminGroups, EMPTY_GROUPS, "auth.groups.manage");

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<{ role: string; password: string; groups: string[] }>({
    role: "user",
    password: "",
    groups: [],
  });
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [roleConfirm, setRoleConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // 建号表单与成员列表同属一个资源：放在这里，创建成功后能直接重拉列表，
  // 而不是让管理员自己按刷新才发现新成员没出现。
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", email: "", password: "" });
  const [creating, setCreating] = useState(false);

  const groupList = useMemo(() => sortGroups(groups.data), [groups.data]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users.data.filter((u) => {
    if (!normalizedQuery) return true;
    return (
      u.username?.toLowerCase().includes(normalizedQuery) ||
      (u.email ?? "").toLowerCase().includes(normalizedQuery) ||
      u.id.toLowerCase().includes(normalizedQuery)
    );
  });

  const currentRole = editing?.role ?? "user";
  const roleChanged = editing != null && form.role !== currentRole;
  const groupsChanged =
    editing != null && !roleChanged && !sameGroupSet(form.groups, editing.groups ?? []);
  const wantsPassword = form.password !== "";
  const passwordTooShort = wantsPassword && (form.password.length < MIN_PASSWORD || form.password.length > MAX_PASSWORD);

  const openEditor = (u: AdminUser) => {
    setEditing(u);
    setForm({ role: u.role ?? "user", password: "", groups: [...(u.groups ?? [])] });
    setRoleConfirm(false);
    setMessage(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setRoleConfirm(false);
    setMessage(null);
  };

  const toggleGroup = (code: string) => {
    setForm((prev) => ({
      ...prev,
      groups: prev.groups.includes(code)
        ? prev.groups.filter((c) => c !== code)
        : [...prev.groups, code],
    }));
  };

  const applyChanges = async () => {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      // 先角色后组：改角色会重建成员关系，此时刻意不再提交组选择（两个写入会互相覆盖，
      // 只剩最后一个赢）。角色改完后重新取数，界面显示的是角色默认组。
      if (roleChanged) await updateAdminUserRole(editing.id, form.role);
      if (wantsPassword) await resetAdminUserPassword(editing.id, form.password);
      if (groupsChanged) await setAdminUserGroups(editing.id, form.groups);
      setEditing(null);
      setRoleConfirm(false);
      setMessage({ kind: "ok", text: t("admin.users.saveSuccess") });
      // 改角色/改组都会动成员关系，所以一律重拉列表：本地推算出来的组名会与服务端不一致。
      users.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeUserAdminError(err, t, "auth.users.manage") });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (busy || !editing) return;
    if (passwordTooShort) {
      setMessage({ kind: "err", text: t("admin.users.passwordTooShort") });
      return;
    }
    if (!roleChanged && !groupsChanged && !wantsPassword) {
      setMessage({ kind: "err", text: t("admin.users.noChanges") });
      return;
    }
    // 改角色是覆盖式副作用（组会被重建），逐次确认；其余是可直接撤销的补丁。
    if (roleChanged) {
      setRoleConfirm(true);
      return;
    }
    void applyChanges();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setMessage(null);
    try {
      await createAdminUser({
        username: createForm.username.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
      });
      setCreateForm({ username: "", email: "", password: "" });
      setCreateOpen(false);
      setMessage({ kind: "ok", text: t("admin.console.userCreated") });
      users.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeUserAdminError(err, t, "auth.users.manage") });
    } finally {
      setCreating(false);
    }
  };

  const handleBanToggle = async () => {
    if (!banTarget) return;
    setBusy(true);
    setMessage(null);
    const next = !banTarget.banned;
    try {
      await setAdminUserBanned(banTarget.id, next);
      setMessage({ kind: "ok", text: next ? t("admin.users.banSuccess") : t("admin.users.unbanSuccess") });
      setBanTarget(null);
      users.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeUserAdminError(err, t, "auth.users.manage") });
      setBanTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Users className="w-4 h-4 text-primary" />}
        title={t("admin.users.title")}
        desc={t("admin.users.subtitle")}
        actions={<RefreshButton onClick={users.reload} loading={users.loading} />}
      />

      {createOpen ? (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-3 max-w-md"
        >
          <h3 className="font-semibold text-text-strong text-xs">{t("admin.console.createEditorTitle")}</h3>
          <div>
            <label className="block text-xs font-medium text-text-body mb-1">
              {t("catalog.username")}
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={createForm.username}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-body mb-1">
              {t("admin.users.fieldEmail")}
            </label>
            <input
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
              className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong focus:border-primary outline-none"
            />
            <p className="mt-1 text-[11px] text-text-faint leading-relaxed">{t("admin.users.fieldEmailHint")}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-body mb-1">
              {t("admin.console.fieldPassword")}
            </label>
            <input
              type="password"
              required
              value={createForm.password}
              autoComplete="new-password"
              onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full p-2.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong focus:border-primary outline-none"
            />
            <p className="mt-1 text-[11px] text-text-faint leading-relaxed">{t("admin.users.passwordRule")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creating || createForm.password.length < MIN_PASSWORD}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-xs font-semibold transition-colors duration-fast ease-soft cursor-pointer"
            >
              {creating ? t("admin.console.creating") : t("admin.console.createUser")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setMessage(null);
              }}
              className="px-3 py-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs transition-colors duration-fast ease-soft cursor-pointer"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreateOpen(true);
            setMessage(null);
          }}
          className="px-3 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>{t("admin.console.createUser")}</span>
        </button>
      )}

      {users.error ? (
        <ErrorNotice
          message={users.error}
          onRetry={users.reload}
          permissionHint={t("admin.users.forbiddenHint")}
        />
      ) : null}

      {message && !editing ? <StatusMessage kind={message.kind} text={message.text} /> : null}

      {/* 角色语义由管理台自己解释：这一行同时是"改角色会重置权限组"的背景说明。 */}
      <p className="text-[11px] text-text-faint leading-relaxed">{t("admin.console.usersDesc")}</p>

      <div className="relative flex items-center max-w-md">
        <Search className="absolute left-3 w-3.5 h-3.5 text-text-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
        />
      </div>

      {!users.loading && !users.error ? (
        <p className="text-[11px] text-text-faint font-mono">
          {t("admin.users.total", { count: visibleUsers.length })}
        </p>
      ) : null}

      {users.loading && users.data.length === 0 ? <LoadingBlock /> : null}
      {!users.loading && !users.error && visibleUsers.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
          {query.trim() ? t("admin.users.filterEmpty") : t("admin.users.noData")}
        </div>
      ) : null}

      {visibleUsers.length > 0 ? (
        <div className="rounded-xl border border-line-subtle bg-surface/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono">
                  <th className="py-2.5 px-3 font-medium">{t("admin.users.colUser")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.users.fieldRole")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.users.colStatus")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.users.colGroups")}</th>
                  <th className="py-2.5 px-3 font-medium text-right">{t("admin.users.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {visibleUsers.map((u) => {
                  const isSelf = me?.id === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-text-strong">{u.username}</span>
                          {isSelf ? (
                            <span className="px-1 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-mono">
                              {t("admin.users.you")}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-text-faint font-mono">
                          {u.email ? `${u.email} · ` : ""}
                          {u.id}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-surfaceSubtle text-[10px] font-mono">
                          {t(roleLabelKey(u.role ?? "user"))}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            u.banned ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {u.banned ? t("admin.users.roleBanned") : t("admin.users.statusActive")}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {(u.groups ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(u.groups ?? []).map((code) => (
                              <span key={code} className="px-1 py-0.5 rounded bg-surfaceSubtle text-[9px] text-text-muted font-mono">
                                {code}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-text-faint font-mono text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditor(u)}
                            className="px-2 py-1 rounded bg-surfaceSubtle hover:bg-surfaceHover text-text-body hover:text-text-strong text-[11px] transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1"
                          >
                            <UserCog className="w-3 h-3" />
                            <span>{t("admin.users.edit")}</span>
                          </button>
                          {/* 封禁自己会被服务端以 cannot_ban_self 拒（封完只能求别人解开），
                              这里提前置灰并说明，而不是让管理员点了才知道。 */}
                          <span title={u.banned ? "" : t("admin.users.selfProtectHint")}>
                            <button
                              type="button"
                              disabled={!u.banned && isSelf}
                              onClick={() => {
                                setMessage(null);
                                setBanTarget(u);
                              }}
                              className={`px-2 py-1 rounded text-[11px] transition-colors duration-fast ease-soft inline-flex items-center gap-1 ${
                                u.banned
                                  ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 cursor-pointer"
                                  : "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              }`}
                            >
                              {u.banned ? <UserCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                              <span>{u.banned ? t("admin.users.unban") : t("admin.users.ban")}</span>
                            </button>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <Modal
        open={editing != null}
        onClose={closeEditor}
        title={t("admin.users.editTitle")}
        icon={<ShieldCheck className="w-4 h-4 text-primary" />}
      >
        {editing ? (
          <div className="space-y-4 text-xs">
            <div className="p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle font-mono text-[11px] text-text-muted">
              {editing.username} · {editing.id}
            </div>

            {message && editing ? <StatusMessage kind={message.kind} text={message.text} /> : null}

            <div>
              <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
                {t("admin.users.fieldRole")}
              </label>
              <select
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                className="w-full p-2 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong focus:border-primary outline-none cursor-pointer"
              >
                {ADMIN_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(roleLabelKey(role))}
                  </option>
                ))}
              </select>
              {roleChanged ? (
                <p className="mt-1.5 text-[11px] text-amber-400/90 leading-relaxed">
                  {t("admin.users.roleResetsGroups")}
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
                {t("admin.users.fieldPassword")}
              </label>
              <input
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="••••••••••••"
                className="w-full p-2 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
              />
              <p className="mt-1.5 text-[11px] text-text-faint leading-relaxed">
                {t("admin.users.passwordRule")}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-[11px] font-mono text-text-body font-medium">
                  {t("admin.users.colGroups")}
                </label>
                {groups.error ? (
                  <span className="text-[10px] font-mono text-rose-300">
                    {t("admin.users.groupsForbiddenHint")}
                  </span>
                ) : null}
              </div>
              {groups.error ? (
                // 组清单取不到时不禁用整块编辑：角色与密码仍然可改，只是组选择降级为只读展示。
                <p className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 leading-relaxed">
                  {groups.error}
                </p>
              ) : null}
              <div className="p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle space-y-1.5 max-h-52 overflow-y-auto">
                {groupList.length === 0 ? (
                  <span className="text-[11px] text-text-faint font-mono">{t("admin.account.empty")}</span>
                ) : null}
                {groupList.map((group) => (
                  <label
                    key={group.code}
                    className={`flex items-center gap-2 ${roleChanged || groups.error ? "opacity-50" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      disabled={roleChanged || groups.error != null}
                      checked={form.groups.includes(group.code)}
                      onChange={() => toggleGroup(group.code)}
                      className="accent-primary"
                    />
                    <span className="font-mono text-[11px] text-text-strong">{group.code}</span>
                    <span className="text-[10px] text-text-faint">
                      {t("admin.users.groupPermCount", { count: (group.permissions ?? []).length })}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-text-faint leading-relaxed">
                {t("admin.users.groupsHint")}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeEditor}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy || passwordTooShort}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
              >
                {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                <span>{busy ? t("admin.users.saving") : t("admin.users.save")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={roleConfirm}
        title={t("admin.users.roleConfirmTitle")}
        message={t("admin.users.roleConfirm", {
          username: editing?.username ?? "",
          role: t(roleLabelKey(form.role)),
        })}
        confirmLabel={t("admin.users.save")}
        busy={busy}
        onClose={() => setRoleConfirm(false)}
        onConfirm={() => void applyChanges()}
      />

      <ConfirmDialog
        open={banTarget != null}
        title={banTarget?.banned ? t("admin.users.unban") : t("admin.users.ban")}
        message={
          banTarget?.banned
            ? t("admin.users.unbanConfirm", { username: banTarget?.username ?? "" })
            : t("admin.users.banConfirm", { username: banTarget?.username ?? "" })
        }
        confirmLabel={banTarget?.banned ? t("admin.users.unban") : t("admin.users.ban")}
        busy={busy}
        onClose={() => setBanTarget(null)}
        onConfirm={() => void handleBanToggle()}
      />
    </div>
  );
}
