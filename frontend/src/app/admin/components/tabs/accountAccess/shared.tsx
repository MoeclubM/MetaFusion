"use client";

// 「账号与权限」各面板共用的取数与呈现原语。
//
// 取数刻意按端点各自独立：设置 / 权限组 / 权限码清单 / 成员 四个接口的所需权限不同
// （auth.settings.manage、auth.groups.manage、auth.users.manage），
// 任何一个 403 只应让它自己那一块降级，不能把整页拖黑。

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { locales } from "@/i18n/routing";
import {
  describeAdminError,
  groupPermissionsByPrefix,
  type AdminGroup,
  type AdminPermissionCode,
  type TranslateOrFn,
} from "./api";

export interface Resource<T> {
  loading: boolean;
  error: string | null;
  data: T;
  reload: () => void;
}

/**
 * 独立的只读资源加载器。
 * loader 必须是稳定引用（直接传模块级函数），initial 必须是模块级常量，
 * 否则每次渲染都会重新发起请求。
 */
export function useAdminResource<T>(
  loader: () => Promise<T>,
  initial: T,
  requiredPermission: string
): Resource<T> {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T>(initial);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError(null);
      })
      .catch((err) => {
        // 失败时保留上一次成功的数据，但错误必须如实显示。
        if (alive) setError(describeAdminError(err, t, requiredPermission));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loader, nonce, t, requiredPermission]);

  return { loading, error, data, reload };
}

// ── 前缀展示：把一个组/一个人的权限码按子系统拆开，讲清"各解释自己那些码" ──

const PREFIX_PALETTE = [
  "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "bg-rose-500/15 text-rose-300 border-rose-500/30",
];

/** 前缀配色只求稳定可辨，不承载语义。 */
export function prefixColor(prefix: string): string {
  let hash = 0;
  for (let i = 0; i < prefix.length; i++) hash = (hash * 31 + prefix.charCodeAt(i)) % 997;
  return PREFIX_PALETTE[hash % PREFIX_PALETTE.length] ?? PREFIX_PALETTE[0] ?? "";
}

export function PrefixChip({ prefix }: { prefix: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono shrink-0 ${prefixColor(prefix)}`}>
      {prefix === "*" ? "*" : `${prefix}.*`}
    </span>
  );
}

/** 子系统显示名：接口给的前缀是权威键，未登记的前缀原样显示，不臆造名称。 */
export function serviceLabel(prefix: string, tr: TranslateOrFn): string {
  if (prefix === "*") return tr("admin.account.service.*", prefix);
  return tr(`admin.account.service.${prefix}`, prefix);
}

/** 设置项标签是可选的翻译覆盖层：接口返回新键时回退显示键名，不维护字段清单。 */
export function settingLabel(key: string, tr: TranslateOrFn): string {
  return tr(`admin.account.setting.${key}`, key);
}

/** 设置项说明同样按需覆盖；未登记则返回空串，由调用方跳过渲染。 */
export function settingHint(key: string, tr: TranslateOrFn): string {
  return tr(`admin.account.setting.${key}.hint`, "");
}

/**
 * 把权限码按前缀分行，并逐行标明该前缀由哪个子系统解释。
 * 这是"元数据系统与论坛共用同一份权限组，但各解释自己那些码"的可视化落点。
 */
export function PrefixBreakdown({ codes, catalog }: { codes: string[]; catalog: AdminPermissionCode[] }) {
  const { t, tr } = useI18n();
  const grouped = groupPermissionsByPrefix(codes, catalog);

  if (grouped.length === 0) {
    return <span className="text-[10px] font-mono text-text-faint">{t("admin.account.groupNoPerms")}</span>;
  }

  return (
    <ul className="space-y-1">
      {grouped.map(({ prefix, codes: list }) => (
        <li key={prefix} className="flex items-start gap-2">
          <PrefixChip prefix={prefix} />
          <span className="text-[11px] text-text-muted leading-relaxed">
            {prefix === "*"
              ? t("admin.account.permWildcard")
              : t("admin.account.permOwnerLine", {
                  service: serviceLabel(prefix, tr),
                  count: list.length,
                })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── 通用块 ──

export function SectionHeader({
  icon,
  title,
  desc,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text-strong flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </h3>
        <p className="text-[11px] text-text-muted leading-relaxed mt-1 max-w-3xl">{desc}</p>
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("admin.account.reload")}
      className="p-2 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body transition-colors duration-fast ease-soft cursor-pointer"
    >
      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-primary" : ""}`} />
    </button>
  );
}

export function ErrorNotice({
  message,
  onRetry,
  permissionHint,
}: {
  message: string;
  onRetry?: () => void;
  /** 中立的"本块需要什么权限"说明：无论当前是 403 还是上游不可用都成立。 */
  permissionHint?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
      <div className="flex items-start gap-2 text-rose-300 text-xs leading-relaxed">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{message}</span>
      </div>
      {permissionHint ? (
        <p className="text-[11px] text-rose-300/70 leading-relaxed">{permissionHint}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium transition-colors duration-fast ease-soft cursor-pointer"
        >
          {t("admin.account.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function LoadingBlock() {
  const { t } = useI18n();
  return (
    <div className="py-10 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
      <span>{t("admin.account.loading")}</span>
    </div>
  );
}

export function EmptyBlock() {
  const { t } = useI18n();
  return (
    <div className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
      {t("admin.account.empty")}
    </div>
  );
}

export function StatusMessage({ kind, text }: { kind: "ok" | "err"; text: string }) {
  return (
    <div
      className={`p-2.5 rounded-lg text-[11px] font-mono leading-relaxed ${
        kind === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/20 text-rose-300"
      }`}
    >
      {text}
    </div>
  );
}

export function SystemLockNotice() {
  const { t } = useI18n();
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-amber-400/80 leading-relaxed">
      <Ban className="w-3 h-3 shrink-0 mt-0.5" />
      <span>{t("admin.account.groupSystemLocked")}</span>
    </p>
  );
}

// ── 多语言文本编辑 ──
//
// 项目要求四语齐全，所以这里固定按 zh-CN / zh-TW / ja-JP / en-US 呈现；
// 数据里已有的其他语言键也一并渲染，避免编辑时丢失既有翻译。

export function MultilingualTextEditor({
  label,
  value,
  onChange,
  required,
  helperText,
  rows = 2,
}: {
  label: string;
  value?: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  required?: boolean;
  helperText?: string;
  rows?: number;
}) {
  const current = value ?? {};
  const ordered: string[] = [];
  for (const code of locales) ordered.push(code);
  for (const code of Object.keys(current)) {
    if (!ordered.includes(code)) ordered.push(code);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-[11px] font-mono text-text-body font-medium">
          {label}
          {required ? <span className="text-rose-400 ml-1">*</span> : null}
        </label>
        {helperText ? <span className="text-[10px] text-text-faint font-mono">{helperText}</span> : null}
      </div>
      <div className="space-y-1.5">
        {ordered.map((code) => (
          <div key={code} className="flex items-start gap-2">
            <span className="px-2 py-1.5 rounded bg-surfaceSubtle text-text-body text-[10px] font-mono shrink-0 w-[62px] text-center">
              {code}
            </span>
            <textarea
              rows={rows}
              value={current[code] ?? ""}
              onChange={(e) => onChange({ ...current, [code]: e.target.value })}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong focus:border-primary outline-none resize-y"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 组码格式来自接口约束（auth/store/access.go: ^[a-z][a-z0-9_-]{1,63}$）。 */
export const GROUP_CODE_RE = /^[a-z][a-z0-9_-]{1,63}$/;

/** 四语名称都要有真实译文：缺任何一个都不提交，避免出现英文占位。 */
export function hasAllLocaleNames(names: Record<string, string> | undefined): boolean {
  if (!names) return false;
  return locales.every((code) => (names[code] ?? "").trim() !== "");
}

export function sortGroups(groups: AdminGroup[]): AdminGroup[] {
  return [...groups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
}
