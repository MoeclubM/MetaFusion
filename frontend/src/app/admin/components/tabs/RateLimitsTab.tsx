"use client";

import { useEffect, useState } from "react";
import { Gauge, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  fetchAdminRateLimits,
  saveAdminRateLimits,
  RateLimitConfig,
  RateLimitPolicy,
  RateLimitRule,
} from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";

// 单行编辑态：额度一律存字符串，空串表示「未声明、继承下一级」；
// unlimited 与 per_minute 互斥——开启解除限制时不再下发额度。
interface RuleRow {
  key: string;
  unlimited: boolean;
  perMinute: string;
}

interface PendingDelete {
  kind: "group" | "account";
  index: number;
  key: string;
}

// per_minute 的合法区间与后端校验一致：非负整数且不超过 1000000。
const MAX_PER_MINUTE = 1000000;

function rowsFromRecord(record?: Record<string, RateLimitRule>): RuleRow[] {
  return Object.entries(record || {}).map(([key, rule]) => ({
    key,
    unlimited: rule?.unlimited === true,
    perMinute: typeof rule?.per_minute === "number" ? String(rule.per_minute) : "",
  }));
}

function rowToRule(row: RuleRow): RateLimitRule {
  if (row.unlimited) return { unlimited: true };
  const trimmed = row.perMinute.trim();
  // 空串 = 未声明：这个键仍然保留（PUT 是整体替换），只是不写额度。
  return trimmed === "" ? {} : { per_minute: Number(trimmed) };
}

function recordFromRows(rows: RuleRow[]): Record<string, RateLimitRule> {
  const out: Record<string, RateLimitRule> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = rowToRule(row);
  }
  return out;
}

// 空文档 = 全部沿用各路由内置额度（120 / 60 / 10 / 300 等），界面要能把这件事讲出来。
function policyIsEmpty(policy: RateLimitPolicy): boolean {
  return (
    policy.default_per_minute == null &&
    policy.default_unlimited !== true &&
    Object.keys(policy.groups || {}).length === 0 &&
    Object.keys(policy.accounts || {}).length === 0
  );
}

export function RateLimitsTab() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // 版本冲突单独呈现（提示 + 重新加载），不与普通失败混在一句里。
  const [conflict, setConflict] = useState(false);

  const [etag, setEtag] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [policyEmpty, setPolicyEmpty] = useState(true);

  const [defaultUnlimited, setDefaultUnlimited] = useState(false);
  const [defaultPerMinute, setDefaultPerMinute] = useState("");
  const [groups, setGroups] = useState<RuleRow[]>([]);
  const [accounts, setAccounts] = useState<RuleRow[]>([]);
  const [editNote, setEditNote] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const applyConfig = (config: RateLimitConfig) => {
    const policy = config?.policy || {};
    setEtag(typeof config?.etag === "string" ? config.etag : "");
    setUpdatedAt(typeof config?.updated_at === "string" ? config.updated_at : "");
    setPolicyEmpty(policyIsEmpty(policy));
    setDefaultUnlimited(policy.default_unlimited === true);
    setDefaultPerMinute(
      policy.default_unlimited === true || policy.default_per_minute == null
        ? ""
        : String(policy.default_per_minute),
    );
    setGroups(rowsFromRecord(policy.groups));
    setAccounts(rowsFromRecord(policy.accounts));
  };

  // 后端错误码翻成人话；认不出的码原样呈现（宁可露出码，也不假装成功）。
  const describeError = (err: unknown, fallback: string): string => {
    const code = String((err as Error)?.message || err || "").trim();
    switch (code) {
      case "version_conflict":
        return t("admin.ratelimits.versionConflict");
      case "evidence_required":
        return t("admin.ratelimits.evidenceRequired");
      case "invalid_rate_limit":
        return t("admin.ratelimits.invalidRateLimit");
      case "forbidden":
        return t("admin.ratelimits.forbidden");
      default:
        return code || fallback;
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setNotice("");
    setConflict(false);
    try {
      const config = await fetchAdminRateLimits();
      applyConfig(config);
      setEditNote("");
      setLoaded(true);
    } catch (err) {
      setError(describeError(err, t("admin.ratelimits.loadFailed")));
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // 额度取值：空串 = null（继承下一级）；非法（非整数 / 越界）返回 NaN。
  const rateValue = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PER_MINUTE) return Number.NaN;
    return n;
  };

  const keyInvalid = (row: RuleRow) => row.key.trim() === "" || row.key !== row.key.trim();
  const rateInvalid = (unlimited: boolean, raw: string) =>
    !unlimited && Number.isNaN(rateValue(raw) as number);

  const noteProvided = editNote.trim().length > 0;
  const groupKeyInvalid = groups.some(keyInvalid);
  const accountKeyInvalid = accounts.some(keyInvalid);
  const groupRateInvalid = groups.some((row) => rateInvalid(row.unlimited, row.perMinute));
  const accountRateInvalid = accounts.some((row) => rateInvalid(row.unlimited, row.perMinute));
  const defaultRateInvalid = rateInvalid(defaultUnlimited, defaultPerMinute);

  // 保存被拦下的第一个原因：界面要说明为什么按钮是灰的，不能只给一个禁用态。
  const blockReason = !noteProvided
    ? t("admin.ratelimits.editNoteRequired")
    : defaultRateInvalid || groupRateInvalid || accountRateInvalid
      ? t("admin.ratelimits.invalidRange")
      : groupKeyInvalid || accountKeyInvalid
        ? t("admin.ratelimits.invalidKey")
        : "";
  const canSave = blockReason === "" && !saving && loaded && etag !== "";

  const buildPolicy = (): RateLimitPolicy => {
    const policy: RateLimitPolicy = {};
    if (defaultUnlimited) {
      policy.default_unlimited = true;
    } else if (defaultPerMinute.trim() !== "") {
      policy.default_per_minute = Number(defaultPerMinute.trim());
    }
    const groupRecord = recordFromRows(groups);
    if (Object.keys(groupRecord).length > 0) policy.groups = groupRecord;
    const accountRecord = recordFromRows(accounts);
    if (Object.keys(accountRecord).length > 0) policy.accounts = accountRecord;
    return policy;
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setNotice("");
    setConflict(false);
    try {
      const config = await saveAdminRateLimits(buildPolicy(), etag, editNote);
      // 用响应里的新 etag 与 policy 刷新本地状态：下一次保存才带得对并发令牌。
      applyConfig(config);
      setEditNote("");
      setNotice(t("admin.ratelimits.saveSuccess"));
    } catch (err) {
      const code = String((err as Error)?.message || err || "").trim();
      if (code === "version_conflict") setConflict(true);
      setError(describeError(err, t("admin.ratelimits.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const patchRow = (
    list: RuleRow[],
    setList: (rows: RuleRow[]) => void,
    index: number,
    patch: Partial<RuleRow>,
  ) => {
    setList(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    if (target.kind === "group") setGroups(groups.filter((_, i) => i !== target.index));
    else setAccounts(accounts.filter((_, i) => i !== target.index));
  };

  if (loading && !loaded) {
    return (
      <div className="py-20 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
        <span>{t("common.loadingGeneric")}</span>
      </div>
    );
  }

  // 取不到配置时不渲染半截表单：给可读错误 + 重新加载，避免 403 / 网络失败变成白屏。
  if (!loaded) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="p-8 rounded-xl border border-rose-500/30 bg-rose-500/5 text-center text-xs space-y-3"
        >
          <p className="text-danger leading-relaxed">{error ?? t("admin.ratelimits.loadFailed")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs font-mono transition-colors duration-fast ease-soft cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("admin.ratelimits.reload")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 标题与重新加载 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text-strong flex items-center gap-2">
            <Gauge className="w-4 h-4 text-info" aria-hidden="true" />
            <span>{t("admin.ratelimits.title")}</span>
          </h2>
          <p className="text-xs text-text-muted font-mono mt-0.5">{t("admin.ratelimits.desc")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs font-mono transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          <span>{t("admin.ratelimits.reload")}</span>
        </button>
      </div>

      {/* 语义说明：回落顺序、0 的含义、整体替换——三条都容易理解反，常驻展示 */}
      <div className="rounded-xl border border-line-subtle bg-surfaceSubtle p-4 space-y-1.5">
        <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.ratelimits.fallbackHint")}</p>
        <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.ratelimits.inheritHint")}</p>
        <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.ratelimits.unlimitedHint")}</p>
        <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.ratelimits.wholeReplaceHint")}</p>
        {updatedAt ? (
          <p className="text-[10px] text-text-faint font-mono">
            {t("admin.ratelimits.updatedAt", { time: updatedAt })}
          </p>
        ) : null}
      </div>

      {policyEmpty ? (
        <div className="rounded-xl border border-dashed border-line bg-surfaceSubtle p-4 text-xs text-text-muted leading-relaxed">
          {t("admin.ratelimits.emptyHint")}
        </div>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-warn"
        >
          <span className="leading-relaxed">{t("admin.ratelimits.versionConflict")}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs font-mono transition-colors duration-fast ease-soft cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("admin.ratelimits.reload")}</span>
          </button>
        </div>
      ) : null}

      {error && !conflict ? (
        <div
          role="alert"
          className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-danger text-xs font-mono leading-relaxed"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-success">
          {notice}
        </div>
      ) : null}

      {/* 全局默认 */}
      <div className="rounded-xl border border-line-subtle bg-surfaceSubtle p-4 space-y-3">
        <h3 className="text-xs font-semibold text-text-strong">{t("admin.ratelimits.globalDefault")}</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="ratelimit-default-minute"
              className="block text-[11px] font-mono text-text-muted mb-1"
            >
              {t("admin.ratelimits.defaultPerMinute")}
            </label>
            <input
              id="ratelimit-default-minute"
              type="number"
              min={0}
              max={MAX_PER_MINUTE}
              value={defaultPerMinute}
              disabled={defaultUnlimited}
              onChange={(e) => setDefaultPerMinute(e.target.value)}
              placeholder={t("admin.ratelimits.inheritPlaceholder")}
              className="w-52 bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none disabled:opacity-50"
            />
          </div>
          <label className="inline-flex items-center gap-2 pb-1.5 text-xs text-text-body cursor-pointer">
            <input
              type="checkbox"
              checked={defaultUnlimited}
              onChange={(e) => setDefaultUnlimited(e.target.checked)}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span>{t("admin.ratelimits.defaultUnlimited")}</span>
          </label>
        </div>
        <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.ratelimits.defaultUnlimitedHint")}</p>
      </div>

      {/* 用户组覆盖 */}
      <div className="rounded-xl border border-line-subtle bg-surfaceSubtle p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-text-strong">{t("admin.ratelimits.groups")}</h3>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t("admin.ratelimits.groupsDesc")}</p>
            <p className="text-[10px] text-text-faint mt-0.5 leading-relaxed">{t("admin.ratelimits.groupKeyHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setGroups([...groups, { key: "", unlimited: false, perMinute: "" }])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold text-xs transition-colors duration-fast ease-soft cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("admin.ratelimits.addGroup")}</span>
          </button>
        </div>

        {groups.length === 0 ? (
          <p className="text-xs text-text-faint font-mono py-3 text-center">{t("admin.ratelimits.noGroups")}</p>
        ) : (
          <div className="space-y-2">
            {groups.map((row, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-line-subtle bg-surface p-2.5"
              >
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-[10px] font-mono text-text-muted mb-1">
                    {t("admin.ratelimits.groupCode")}
                  </label>
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => patchRow(groups, setGroups, index, { key: e.target.value })}
                    placeholder={t("admin.ratelimits.groupCodePlaceholder")}
                    className="w-full bg-surfaceSubtle border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
                  />
                </div>
                <label className="inline-flex items-center gap-2 pb-1.5 text-xs text-text-body cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.unlimited}
                    onChange={(e) => patchRow(groups, setGroups, index, { unlimited: e.target.checked })}
                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                  />
                  <span>{t("admin.ratelimits.unlimited")}</span>
                </label>
                {!row.unlimited ? (
                  <div className="w-44 pb-1.5">
                    <label className="block text-[10px] font-mono text-text-muted mb-1">
                      {t("admin.ratelimits.perMinute")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={MAX_PER_MINUTE}
                      value={row.perMinute}
                      onChange={(e) => patchRow(groups, setGroups, index, { perMinute: e.target.value })}
                      placeholder={t("admin.ratelimits.inheritPlaceholder")}
                      className="w-full bg-surfaceSubtle border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPendingDelete({ kind: "group", index, key: row.key })}
                  title={t("admin.ratelimits.remove")}
                  aria-label={t("admin.ratelimits.remove")}
                  className="p-2 rounded-md hover:bg-rose-500/10 text-text-muted hover:text-danger transition-colors duration-fast ease-soft cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 账号覆盖 */}
      <div className="rounded-xl border border-line-subtle bg-surfaceSubtle p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-text-strong">{t("admin.ratelimits.accounts")}</h3>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t("admin.ratelimits.accountsDesc")}</p>
            <p className="text-[10px] text-text-faint mt-0.5 leading-relaxed">{t("admin.ratelimits.accountKeyHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setAccounts([...accounts, { key: "", unlimited: false, perMinute: "" }])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold text-xs transition-colors duration-fast ease-soft cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("admin.ratelimits.addAccount")}</span>
          </button>
        </div>

        {accounts.length === 0 ? (
          <p className="text-xs text-text-faint font-mono py-3 text-center">{t("admin.ratelimits.noAccounts")}</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((row, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-line-subtle bg-surface p-2.5"
              >
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-[10px] font-mono text-text-muted mb-1">
                    {t("admin.ratelimits.accountKey")}
                  </label>
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => patchRow(accounts, setAccounts, index, { key: e.target.value })}
                    placeholder={t("admin.ratelimits.accountKeyPlaceholder")}
                    className="w-full bg-surfaceSubtle border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
                  />
                </div>
                <label className="inline-flex items-center gap-2 pb-1.5 text-xs text-text-body cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.unlimited}
                    onChange={(e) => patchRow(accounts, setAccounts, index, { unlimited: e.target.checked })}
                    className="w-4 h-4 rounded accent-primary cursor-pointer"
                  />
                  <span>{t("admin.ratelimits.unlimited")}</span>
                </label>
                {!row.unlimited ? (
                  <div className="w-44 pb-1.5">
                    <label className="block text-[10px] font-mono text-text-muted mb-1">
                      {t("admin.ratelimits.perMinute")}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={MAX_PER_MINUTE}
                      value={row.perMinute}
                      onChange={(e) => patchRow(accounts, setAccounts, index, { perMinute: e.target.value })}
                      placeholder={t("admin.ratelimits.inheritPlaceholder")}
                      className="w-full bg-surfaceSubtle border border-theme rounded px-2.5 py-1.5 text-xs text-foreground font-mono focus:border-sky-400 outline-none"
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPendingDelete({ kind: "account", index, key: row.key })}
                  title={t("admin.ratelimits.remove")}
                  aria-label={t("admin.ratelimits.remove")}
                  className="p-2 rounded-md hover:bg-rose-500/10 text-text-muted hover:text-danger transition-colors duration-fast ease-soft cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑说明与保存：说明是必填的证据，空则禁用保存并在就地讲清原因 */}
      <div className="rounded-xl border border-line-subtle bg-surfaceSubtle p-4 space-y-3">
        <div>
          <label htmlFor="ratelimit-edit-note" className="block text-[11px] font-mono text-text-muted mb-1">
            {t("admin.ratelimits.editNote")}
          </label>
          <input
            id="ratelimit-edit-note"
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder={t("admin.ratelimits.editNotePlaceholder")}
            className="w-full bg-surface border border-theme rounded px-2.5 py-1.5 text-xs text-foreground focus:border-sky-400 outline-none"
          />
          {!noteProvided ? (
            <p className="text-[10px] text-warn mt-1 leading-relaxed">{t("admin.ratelimits.editNoteRequired")}</p>
          ) : null}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 border-t border-line-subtle">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-primary text-white text-xs font-bold font-mono hover:bg-primary/90 transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
            <span>{t("admin.ratelimits.save")}</span>
          </button>
          {blockReason ? <p className="text-[10px] text-warn leading-relaxed">{blockReason}</p> : null}
        </div>
      </div>

      {/* 删除只改本地草稿，PUT 整体替换后生效，所以确认文案要说清这一点。 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("common.delete")}
        message={
          pendingDelete?.kind === "account"
            ? t("admin.ratelimits.deleteAccountConfirm", { key: pendingDelete?.key ?? "" })
            : t("admin.ratelimits.deleteGroupConfirm", { key: pendingDelete?.key ?? "" })
        }
        confirmLabel={t("common.delete")}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
