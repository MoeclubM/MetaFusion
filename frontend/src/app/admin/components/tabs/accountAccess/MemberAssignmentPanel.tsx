"use client";

// 成员分配面板：GET /api/admin/users + PUT /api/admin/users/:id/groups。
//
// 用户列表里已经带 groups（组码）与 permissions（服务端展开后的权限集合，含 * 短路），
// 所以"当前属于哪些组""通过组拿到哪些权限"都能直接看出来；
// 分配是覆盖式写入（传空数组即清空），保存后回读确认。

import React, { useState } from "react";
import { AlertTriangle, Check, Search, UserCog, Users } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import {
  describeAdminError,
  expandPermissions,
  groupPermissionsByPrefix,
  permissionGranters,
  setAdminUserGroups,
  type AdminGroup,
  type AdminPermissionCode,
  type AdminUser,
} from "./api";
import {
  EmptyBlock,
  ErrorNotice,
  LoadingBlock,
  PrefixBreakdown,
  PrefixChip,
  RefreshButton,
  SectionHeader,
  StatusMessage,
  serviceLabel,
  sortGroups,
  type Resource,
} from "./shared";

export function MemberAssignmentPanel({
  users,
  groups,
  catalog,
}: {
  users: Resource<AdminUser[]>;
  groups: Resource<AdminGroup[]>;
  catalog: Resource<AdminPermissionCode[]>;
}) {
  const { t, tr } = useI18n();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const groupList = sortGroups(groups.data);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users.data.filter((user) => {
    if (!normalizedQuery) return true;
    return (
      user.username.toLowerCase().includes(normalizedQuery) ||
      (user.email ?? "").toLowerCase().includes(normalizedQuery)
    );
  });

  const openEditor = (user: AdminUser) => {
    setEditing(user);
    setSelection([...(user.groups ?? [])]);
    setMessage(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setMessage(null);
  };

  const toggleGroup = (code: string) => {
    setSelection((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await setAdminUserGroups(editing.id, selection);
      setMessage({ kind: "ok", text: t("admin.account.memberSaved") });
      setEditing(null);
      users.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeAdminError(err, t, "auth.users.manage") });
    } finally {
      setBusy(false);
    }
  };

  // 预览：本地镜像服务端的 ExpandPermissions，保存前就能看出会拿到什么。
  const previewPermissions = expandPermissions(selection, groupList);
  const previewGranters = permissionGranters(selection, groupList);
  const previewByPrefix = groupPermissionsByPrefix(previewPermissions, catalog.data);
  const adminGroupSelected = selection.includes("admin");
  const adminGroupWasSet = (editing?.groups ?? []).includes("admin");

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Users className="w-4 h-4 text-purple-400" />}
        title={t("admin.account.membersTitle")}
        desc={t("admin.account.membersDesc")}
        actions={<RefreshButton onClick={users.reload} loading={users.loading} />}
      />

      {users.error ? (
        <ErrorNotice
          message={users.error}
          onRetry={users.reload}
          permissionHint={t("admin.account.membersForbiddenHint")}
        />
      ) : null}
      {groups.error ? <ErrorNotice message={groups.error} onRetry={groups.reload} /> : null}

      {message && !editing ? <StatusMessage kind={message.kind} text={message.text} /> : null}

      <div className="relative flex items-center max-w-md">
        <Search className="absolute left-3 w-3.5 h-3.5 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.account.memberSearch")}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white placeholder:text-gray-500 focus:border-primary outline-none"
        />
      </div>

      <p className="text-[11px] text-gray-500 leading-relaxed">{t("admin.account.roleDerived")}</p>

      {users.loading && users.data.length === 0 ? <LoadingBlock /> : null}
      {!users.loading && visibleUsers.length === 0 ? <EmptyBlock /> : null}

      {visibleUsers.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-surface/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02] text-gray-400 font-mono">
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colUser")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colRole")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colGroups")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colEffective")}</th>
                  <th className="py-2.5 px-3 font-medium text-right">{t("admin.account.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {visibleUsers.map((user) => {
                  const userGroups = user.groups ?? [];
                  const permissions = user.permissions ?? [];
                  const byPrefix = groupPermissionsByPrefix(permissions, catalog.data);
                  return (
                    <tr key={user.id} className="hover:bg-white/[0.02] align-top">
                      <td className="py-2.5 px-3">
                        <div className="text-white font-semibold">{user.username}</div>
                        <div className="text-[10px] font-mono text-gray-500 break-all">
                          {user.email || "—"}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-gray-300">
                          {user.role ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {userGroups.length === 0 ? (
                          <span className="text-[10px] font-mono text-gray-500">
                            {t("admin.account.memberNoGroups")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {userGroups.map((code) => (
                              <span
                                key={code}
                                className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[10px] font-mono"
                              >
                                {code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        {permissions.length === 0 ? (
                          <span className="text-[10px] font-mono text-gray-500">—</span>
                        ) : (
                          <div className="space-y-1">
                            {byPrefix.slice(0, 3).map(({ prefix, codes }) => (
                              <div key={prefix} className="flex items-start gap-1.5">
                                <PrefixChip prefix={prefix} />
                                <span className="text-[10px] font-mono text-gray-400">
                                  {t("admin.account.permCount", { count: codes.length })}
                                </span>
                              </div>
                            ))}
                            {byPrefix.length > 3 ? (
                              <span className="text-[10px] font-mono text-gray-500">
                                {t("admin.account.memberMorePrefixes", { count: byPrefix.length - 3 })}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(user)}
                          disabled={Boolean(groups.error)}
                          title={groups.error ? t("admin.account.memberNeedsGroups") : t("admin.account.memberEdit")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[11px] text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast ease-soft cursor-pointer"
                        >
                          <UserCog className="w-3 h-3" />
                          <span>{t("admin.account.memberEdit")}</span>
                        </button>
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
        open={editing !== null}
        onClose={closeEditor}
        title={t("admin.account.memberEditTitle", { name: editing?.username ?? "" })}
        icon={<UserCog className="w-4 h-4 text-purple-400" />}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4 text-xs">
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-gray-300 font-medium">
              {t("admin.account.memberGroupsLabel")}
            </div>
            {groupList.length === 0 ? (
              <EmptyBlock />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {groupList.map((group) => {
                  const active = selection.includes(group.code);
                  const permissions = group.permissions ?? [];
                  return (
                    <button
                      key={group.code}
                      type="button"
                      onClick={() => toggleGroup(group.code)}
                      className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors duration-fast ease-soft cursor-pointer ${
                        active
                          ? "bg-primary/15 border-primary/40"
                          : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded border shrink-0 grid place-items-center ${
                          active ? "bg-primary border-primary text-white" : "border-white/25"
                        }`}
                      >
                        {active ? <Check className="w-2.5 h-2.5" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-mono text-white">
                          {group.code}
                          {group.is_system ? (
                            <span className="ml-1.5 text-[9px] text-amber-300">
                              {t("admin.account.groupSystemBadge")}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-[10px] text-gray-400 truncate">
                          {t("admin.account.permCount", { count: permissions.length })}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {groupPermissionsByPrefix(permissions, catalog.data).map(({ prefix }) => (
                            <PrefixChip key={prefix} prefix={prefix} />
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {adminGroupWasSet && !adminGroupSelected ? (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-400/80 leading-relaxed">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{t("admin.account.soleAdminWarning")}</span>
            </p>
          ) : null}

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="text-[11px] font-mono text-gray-300 font-medium">
              {t("admin.account.memberPreview")}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              {t("admin.account.memberPreviewHint")}
            </p>
            {previewPermissions.length === 0 ? (
              <span className="text-[10px] font-mono text-gray-500">
                {t("admin.account.memberNoGroups")}
              </span>
            ) : (
              <div className="space-y-2">
                {previewByPrefix.map(({ prefix, codes }) => (
                  <div key={prefix} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <PrefixChip prefix={prefix} />
                      <span className="text-[10px] text-gray-400">
                        {prefix === "*"
                          ? t("admin.account.permWildcardShort")
                          : t("admin.account.permOwnerLine", {
                              service: serviceLabel(prefix, tr),
                              count: codes.length,
                            })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {codes.map((code) => (
                        <span
                          key={code}
                          title={t("admin.account.memberGrantedBy", {
                            groups: (previewGranters.get(code) ?? []).join(", "),
                          })}
                          className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-[10px] font-mono text-gray-300"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <PrefixBreakdown codes={previewPermissions} catalog={catalog.data} />
          </div>

          {message ? <StatusMessage kind={message.kind} text={message.text} /> : null}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={closeEditor}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors duration-fast ease-soft cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors duration-fast ease-soft cursor-pointer"
            >
              {busy ? t("common.saving") : t("admin.account.memberSave")}
            </button>
          </div>
        </div>
      </Modal>

      <p className="text-[11px] text-gray-500 leading-relaxed">
        {t("admin.account.memberNoGroupAccess", { code: "auth.users.manage" })}
      </p>
    </div>
  );
}
