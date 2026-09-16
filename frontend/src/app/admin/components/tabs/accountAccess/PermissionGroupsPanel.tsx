"use client";

// 权限组面板：GET|POST /api/admin/groups、PUT|DELETE /api/admin/groups/:code。
//
// 组码、四语名、权限码都来自接口；系统组（is_system）不可删，因为"注册默认组""管理员"
// 这类语义挂在它们身上。同一个组可以同时持有 catalog.* 与 community.* 权限码 ——
// 元数据系统与论坛各解释自己那些码，这里不做两套割裂的组管理。

import React, { useState } from "react";
import { Ban, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import {
  createAdminGroup,
  deleteAdminGroup,
  describeAdminError,
  groupPermissionsByPrefix,
  updateAdminGroup,
  type AdminGroup,
  type AdminPermissionCode,
} from "./api";
import { PermissionPicker } from "./PermissionPicker";
import {
  EmptyBlock,
  ErrorNotice,
  GROUP_CODE_RE,
  LoadingBlock,
  MultilingualTextEditor,
  PrefixBreakdown,
  PrefixChip,
  RefreshButton,
  SectionHeader,
  StatusMessage,
  SystemLockNotice,
  hasAllLocaleNames,
  sortGroups,
  type Resource,
} from "./shared";

const EMPTY_GROUP: AdminGroup = { code: "", names: {}, descriptions: {}, permissions: [], sort_order: 0 };

/** 新组的默认排序值取现有最大值 +10，和后端播种的 0/10/20… 风格一致。 */
function nextSortOrder(groups: AdminGroup[]): number {
  let max = 0;
  for (const group of groups) max = Math.max(max, group.sort_order ?? 0);
  return max + 10;
}

export function PermissionGroupsPanel({
  groups,
  catalog,
}: {
  groups: Resource<AdminGroup[]>;
  catalog: Resource<AdminPermissionCode[]>;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState<AdminGroup>(EMPTY_GROUP);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const list = sortGroups(groups.data);
  const codeLocked = editingCode !== null;

  const openCreate = () => {
    setEditingCode(null);
    setForm({ ...EMPTY_GROUP, sort_order: nextSortOrder(list) });
    setMessage(null);
    setOpen(true);
  };

  const openEdit = (group: AdminGroup) => {
    setEditingCode(group.code);
    setForm({
      code: group.code,
      names: { ...(group.names ?? {}) },
      descriptions: { ...(group.descriptions ?? {}) },
      permissions: [...(group.permissions ?? [])],
      sort_order: group.sort_order ?? 0,
    });
    setMessage(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setMessage(null);
  };

  const handleSave = async () => {
    setMessage(null);
    if (!codeLocked && !GROUP_CODE_RE.test(form.code.trim())) {
      setMessage({ kind: "err", text: t("admin.account.errCodeInvalid") });
      return;
    }
    if (!hasAllLocaleNames(form.names)) {
      setMessage({ kind: "err", text: t("admin.account.errNamesRequired") });
      return;
    }
    setBusy(true);
    try {
      if (codeLocked) {
        await updateAdminGroup(editingCode as string, form);
      } else {
        await createAdminGroup({ ...form, code: form.code.trim() });
      }
      setOpen(false);
      setMessage({ kind: "ok", text: t("admin.account.groupSaved") });
      groups.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeAdminError(err, t, "auth.groups.manage") });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (group: AdminGroup) => {
    if (group.is_system) return;
    if (!window.confirm(t("admin.account.groupDeleteConfirm", { code: group.code }))) return;
    setMessage(null);
    try {
      await deleteAdminGroup(group.code);
      setMessage({ kind: "ok", text: t("admin.account.groupDeleted", { code: group.code }) });
      groups.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeAdminError(err, t, "auth.groups.manage") });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<KeyRound className="w-4 h-4 text-sky-400" />}
        title={t("admin.account.groupsTitle")}
        desc={t("admin.account.groupsDesc")}
        actions={
          <>
            <button
              type="button"
              onClick={openCreate}
              disabled={Boolean(catalog.error)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-400 text-black text-xs font-semibold hover:bg-sky-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("admin.account.groupNew")}</span>
            </button>
            <RefreshButton onClick={groups.reload} loading={groups.loading} />
          </>
        }
      />

      {groups.error ? (
        <ErrorNotice message={groups.error} onRetry={groups.reload} />
      ) : null}
      {catalog.error ? (
        <ErrorNotice
          message={catalog.error}
          onRetry={catalog.reload}
          permissionHint={t("admin.account.catalogForbiddenHint")}
        />
      ) : null}

      {message ? <StatusMessage kind={message.kind} text={message.text} /> : null}

      {groups.loading && list.length === 0 ? <LoadingBlock /> : null}
      {!groups.loading && list.length === 0 ? <EmptyBlock /> : null}

      {list.length > 0 ? (
        <div className="rounded-xl border border-line-subtle bg-surface/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono">
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colCode")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colNames")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colDescs")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colPerms")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colSystem")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.account.colSort")}</th>
                  <th className="py-2.5 px-3 font-medium text-right">{t("admin.account.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {list.map((group) => {
                  const permissions = group.permissions ?? [];
                  const breakdown = groupPermissionsByPrefix(permissions, catalog.data);
                  return (
                    <tr key={group.code} className="hover:bg-surfaceSubtle align-top">
                      <td className="py-2.5 px-3 font-mono text-sky-300 font-semibold whitespace-nowrap">
                        {group.code}
                      </td>
                      <td className="py-2.5 px-3 text-text-body">
                        {group.names?.[locale] ?? group.names?.["zh-CN"] ?? group.names?.["en-US"] ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 text-text-muted max-w-xs">
                        {group.descriptions?.[locale] ??
                          group.descriptions?.["zh-CN"] ??
                          group.descriptions?.["en-US"] ??
                          "—"}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-mono text-text-body">
                            {t("admin.account.permCount", { count: permissions.length })}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {breakdown.map(({ prefix }) => (
                              <PrefixChip key={prefix} prefix={prefix} />
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {group.is_system ? (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono"
                            title={t("admin.account.groupSystemLocked")}
                          >
                            <Ban className="w-2.5 h-2.5" />
                            {t("admin.account.groupSystemBadge")}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-text-faint">
                            {t("admin.account.groupCustom")}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-text-muted">
                        {group.sort_order ?? 0}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(group)}
                            title={t("common.edit")}
                            className="p-1.5 rounded-md hover:bg-surfaceHover text-text-muted hover:text-text-strong transition-colors duration-fast ease-soft cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(group)}
                            disabled={Boolean(group.is_system)}
                            title={
                              group.is_system
                                ? t("admin.account.groupSystemLocked")
                                : t("admin.account.groupDelete")
                            }
                            className="p-1.5 rounded-md text-text-muted hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-muted transition-colors duration-fast ease-soft cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      <SystemLockNotice />

      <Modal
        open={open}
        onClose={close}
        title={codeLocked ? t("admin.account.groupEditTitle", { code: form.code }) : t("admin.account.groupCreateTitle")}
        icon={<KeyRound className="w-4 h-4 text-sky-400" />}
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
              {t("admin.account.colCode")}
              <span className="text-rose-400 ml-1">*</span>
            </label>
            <input
              type="text"
              value={form.code}
              disabled={codeLocked}
              onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
              placeholder="e.g. catalog_curator"
              className="w-full px-3 py-2 rounded-lg bg-surfaceSubtle border border-line text-text-strong font-mono focus:outline-none focus:border-sky-400 disabled:opacity-50"
            />
            <p className="text-[10px] text-text-faint mt-1 leading-relaxed">
              {t("admin.account.groupCodeHint")}
            </p>
          </div>

          <MultilingualTextEditor
            label={t("admin.account.groupNames")}
            value={form.names}
            onChange={(names) => setForm({ ...form, names })}
            required
            helperText={t("admin.account.groupNamesHint")}
          />

          <MultilingualTextEditor
            label={t("admin.account.groupDescs")}
            value={form.descriptions}
            onChange={(descriptions) => setForm({ ...form, descriptions })}
            helperText={t("admin.account.groupDescsHint")}
            rows={2}
          />

          <div className="space-y-2">
            <label className="block text-[11px] font-mono text-text-body font-medium">
              {t("admin.account.colPerms")}
            </label>
            {catalog.loading && catalog.data.length === 0 ? (
              <LoadingBlock />
            ) : catalog.data.length === 0 ? (
              <EmptyBlock />
            ) : (
              <PermissionPicker
                catalog={catalog.data}
                selected={form.permissions ?? []}
                onChange={(permissions) => setForm({ ...form, permissions })}
              />
            )}
          </div>

          <div className="p-3 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-2">
            <div className="text-[11px] font-mono text-text-body font-medium">
              {t("admin.account.groupPermScopeTitle")}
            </div>
            <PrefixBreakdown codes={form.permissions ?? []} catalog={catalog.data} />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
              {t("admin.account.colSort")}
            </label>
            <input
              type="number"
              value={form.sort_order ?? 0}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              className="w-full sm:w-40 px-3 py-2 rounded-lg bg-surfaceSubtle border border-line text-text-strong font-mono focus:outline-none focus:border-sky-400"
            />
          </div>

          {message ? <StatusMessage kind={message.kind} text={message.text} /> : null}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-lg border border-line text-text-muted hover:text-text-strong transition-colors duration-fast ease-soft cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-sky-400 text-black font-semibold hover:bg-sky-300 disabled:opacity-50 transition-colors duration-fast ease-soft cursor-pointer"
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>

          {codeLocked && list.find((g) => g.code === editingCode)?.is_system ? (
            <p className="text-[11px] text-amber-400/80 leading-relaxed">
              {t("admin.account.groupSystemEditNote")}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
