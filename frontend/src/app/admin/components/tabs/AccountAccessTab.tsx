"use client";

// 「账号与权限」管理台页签：实例设置 + 权限组 + 成员分配。
//
// 账号服务（metafusion-auth）与元数据系统、论坛是拆开的：
//   * 组、权限码、实例设置都存在账号服务里，界面只通过 /api/admin/* 读写；
//   * 元数据系统与论坛是**两套权限组语义**，但都来自同一份账号数据 ——
//     所以这里只有一套组管理界面：同一个组里可以同时勾 catalog.* 与 community.*，
//     各子系统只解释自己那些码，账号服务只负责存与算，不解释含义。
//
// 四个接口所需权限不同（auth.settings.manage / auth.groups.manage / auth.users.manage），
// 因此各自独立取数：任一 403 只让它自己那块降级，不牵连其余两块。

import React, { useMemo } from "react";
import { Info, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchAdminGroups,
  fetchAdminPermissions,
  fetchAdminSettings,
  fetchAdminUsers,
  groupPermissionsByPrefix,
  type AdminGroup,
  type AdminPermissionCode,
  type AdminUser,
  type SettingsMap,
} from "./accountAccess/api";
import { InstanceSettingsPanel } from "./accountAccess/InstanceSettingsPanel";
import { MemberAssignmentPanel } from "./accountAccess/MemberAssignmentPanel";
import { PermissionGroupsPanel } from "./accountAccess/PermissionGroupsPanel";
import { PrefixChip, serviceLabel, useAdminResource } from "./accountAccess/shared";

// 模块级常量：useAdminResource 的 initial 必须是稳定引用，否则会反复重新取数。
const EMPTY_SETTINGS: SettingsMap = {};
const EMPTY_GROUPS: AdminGroup[] = [];
const EMPTY_CATALOG: AdminPermissionCode[] = [];
const EMPTY_USERS: AdminUser[] = [];

export function AccountAccessTab() {
  const { t, tr } = useI18n();

  const settings = useAdminResource(fetchAdminSettings, EMPTY_SETTINGS, "auth.settings.manage");
  const groups = useAdminResource(fetchAdminGroups, EMPTY_GROUPS, "auth.groups.manage");
  const catalog = useAdminResource(fetchAdminPermissions, EMPTY_CATALOG, "auth.groups.manage");
  const users = useAdminResource(fetchAdminUsers, EMPTY_USERS, "auth.users.manage");

  const groupCodes = useMemo(() => groups.data.map((group) => group.code), [groups.data]);

  // 权限码前缀直接从清单里归纳，不写死前缀列表。
  const prefixes = useMemo(() => {
    const codes = catalog.data.map((item) => item.code).filter((code) => code !== "*");
    return groupPermissionsByPrefix(codes, catalog.data).map(({ prefix }) => prefix);
  }, [catalog.data]);

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-3">
        <h2 className="text-base font-semibold text-text-strong flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span>{t("admin.account.title")}</span>
        </h2>
        <p className="text-xs text-text-muted leading-relaxed">{t("admin.account.subtitle")}</p>

        <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-700 dark:text-sky-300">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>{t("admin.account.splitTitle")}</span>
          </div>
          <p className="text-[11px] text-sky-800/80 dark:text-sky-100/70 leading-relaxed">{t("admin.account.splitDesc")}</p>
          {prefixes.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-mono text-sky-700/80 dark:text-sky-200/70">
                {t("admin.account.splitPrefixes", { count: prefixes.length })}
              </div>
              <ul className="space-y-1">
                {prefixes.map((prefix) => (
                  <li key={prefix} className="flex items-start gap-2">
                    <PrefixChip prefix={prefix} />
                    <span className="text-[11px] text-sky-800/80 dark:text-sky-100/70 leading-relaxed">
                      {t("admin.account.splitPrefixLine", { service: serviceLabel(prefix, tr) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <InstanceSettingsPanel settings={settings} groupCodes={groupCodes} />

      <PermissionGroupsPanel groups={groups} catalog={catalog} />

      <MemberAssignmentPanel users={users} groups={groups} catalog={catalog} />
    </div>
  );
}
