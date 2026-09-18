"use client";

// 定义版本历史：版本列表 + "对比""回滚"两个动作。
//
// 契约（只读核对 backend/internal/catalog/http.go、definitions_diff.go、types.go）：
// - 列表：GET /admin/catalog-definitions?include_document=true → { items, include_document }；
//   服务端 SQL 是 ORDER BY id DESC LIMIT 100，最多 100 条且无分页。
// - 对比：GET /admin/catalog-definitions/:id/diff?against=<基线>。:id 是目标一侧、against 是基线
//   一侧，响应不含任何一侧的 document；against 缺省由服务端取该版本的 base_version。
// - 回滚：POST /admin/catalog-definitions/:id/rollback，目标版本就是路径 id，**不接受请求体**；
//   服务端以当前已发布版本为 base 新建并发布一个版本（不原地改历史行），目标文档与当前一致时
//   返回 200 + no_op 且不写库——那种情况必须如实说明"没有产生新版本"。
//
// 降级：列表失败、对比失败、回滚失败各自有独立状态，互不牵连，也不影响编辑器其它部分。

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  GitCompare,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import { ErrorNotice } from "@/components/common/Blocks";
import { isNotFoundError, localizeCatalogError } from "@/lib/catalogErrors";
import { ApiError } from "@/lib/api";
import {
  DefinitionDiff,
  DefinitionRollback,
  DefinitionVersionItem,
  definitionDiff,
  rollbackDefinition,
} from "./api";

/** 差异汇总的固定键顺序：服务端七个分区与四种变更类型恒给出（为 0 也给）。 */
const SECTIONS = [
  "types",
  "fields",
  "vocabularies",
  "relations",
  "templates",
  "schemes",
  "structure",
] as const;
const CHANGES = ["added", "removed", "changed", "toggled"] as const;

/** 版本状态色板：沿用管理台表格的既有色号（published 绿 / draft 琥珀 / 其余灰）。 */
const STATE_CLASS: Record<string, string> = {
  published: "bg-emerald-500/15 text-success",
  draft: "bg-amber-500/15 text-warn",
  superseded: "bg-surfaceSubtle text-text-muted",
};
const CHANGE_CLASS: Record<string, string> = {
  added: "bg-emerald-500/15 text-success",
  removed: "bg-rose-500/15 text-danger",
  changed: "bg-amber-500/15 text-warn",
  toggled: "bg-sky-500/15 text-info",
};

/** 值预览上限：服务端只保证单个值不超过 512 字节，表格里再收一次，免得一行撑爆版式。 */
const PREVIEW_MAX = 160;

/** 单行值预览：对象/数组也压成一行 JSON；缺键（另一侧没有值）显示破折号。 */
function preview(value: unknown): string {
  if (value === undefined) return "—";
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
}

/** 时间戳按当前语言格式化；解析不了就原样显示，不吞掉服务端给的值。 */
function timestamp(value: string, locale: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(locale);
}

/**
 * 回滚的 400 是 "definition_impact: [...]"：码后面直接跟一个 JSON 字符串数组，
 * 元素本身就是人话（与 /impact 同一批校验结论）。这里拆成条目列表；
 * 格式不符（上游改了形状）时返回 null，由调用方回退整串展示。
 */
function parseImpactIssues(message: string): string[] | null {
  const prefix = "definition_impact:";
  const trimmed = message.trim();
  if (!trimmed.startsWith(prefix)) return null;
  try {
    const issues = JSON.parse(trimmed.slice(prefix.length).trim());
    if (Array.isArray(issues)) return issues.map((x) => String(x));
  } catch {
    /* 非 JSON：交给调用方显示原文 */
  }
  return null;
}

type Failure = { text: string; issues?: string[] };

/** 读类错误（对比）：401/403 走既有码表翻成人话，404 说明版本已不在，其余保留后端原文。 */
function describeReadError(err: unknown, t: (key: string) => string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (isNotFoundError(message) || (err instanceof ApiError && err.status === 404)) {
    return t("catalog.history.versionGone");
  }
  return localizeCatalogError(message, t);
}

/** 写类错误（回滚）：把 impact 预检、并发冲突、版本缺失分别说清，其余保留后端原文。 */
function describeRollbackError(err: unknown, t: (key: string) => string): Failure {
  const message = err instanceof Error ? err.message : String(err);
  const issues = parseImpactIssues(message);
  if (issues) return { text: t("catalog.history.rollbackBlocked"), issues };
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 409 || message.trim().startsWith("version_conflict")) {
    return { text: t("catalog.history.rollbackConflict") };
  }
  if (status === 404 || isNotFoundError(message)) {
    return { text: t("catalog.history.versionGone") };
  }
  return { text: localizeCatalogError(message, t) };
}

/** 版本差异弹窗：数据在打开时按需取，失败只降级在弹窗内，带重试。 */
function DiffModal({
  target,
  referenceId,
  onClose,
}: {
  target: DefinitionVersionItem;
  /** 当前已发布版本 id：作为对比基线（路径 :id 是被比较的那一行版本）。 */
  referenceId?: number;
  onClose: () => void;
}) {
  const { t, tr } = useI18n();
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<DefinitionDiff>();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setDiff(undefined);
    const request =
      referenceId === undefined
        ? definitionDiff(target.id)
        : definitionDiff(target.id, referenceId);
    request
      .then((data) => {
        if (alive) setDiff(data);
      })
      .catch((err) => {
        if (alive) setError(describeReadError(err, t));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [target.id, referenceId, nonce, t]);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-3xl"
      title={`${t("catalog.history.diffTitle")} · #${target.id}`}
      icon={<GitCompare className="w-4 h-4 text-primary" />}
    >
      {loading ? (
        <p className="py-8 text-center text-xs text-text-muted font-mono">
          {t("catalog.history.diffLoading")}
        </p>
      ) : error ? (
        <ErrorNotice message={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : diff ? (
        <div className="space-y-4">
          {/* 方向必须写在界面上：差异是"以 against 为基线、朝 :id 方向"的，让人自己猜会反着读。 */}
          <p className="text-xs text-text-body leading-relaxed">
            {t("catalog.history.diffDirection", {
              from: diff.against,
              to: diff.id,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
            <span className="px-2 py-0.5 rounded bg-primary/15 text-primary font-semibold">
              {t("catalog.history.diffTotal", { count: diff.summary.total })}
            </span>
            {SECTIONS.filter((s) => (diff.summary.by_section[s] ?? 0) > 0).map((s) => (
              <span key={s} className="px-2 py-0.5 rounded bg-surfaceSubtle text-text-muted">
                {t(`catalog.${s}`)} {diff.summary.by_section[s]}
              </span>
            ))}
            {CHANGES.filter((c) => (diff.summary.by_change[c] ?? 0) > 0).map((c) => (
              <span key={c} className={`px-2 py-0.5 rounded ${CHANGE_CLASS[c]}`}>
                {tr(`catalog.history.change.${c}`, c)} {diff.summary.by_change[c]}
              </span>
            ))}
          </div>
          {diff.changes.length === 0 ? (
            <p className="p-4 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
              {t("catalog.history.diffNone")}
            </p>
          ) : (
            <div className="rounded-xl border border-line-subtle overflow-hidden">
              <table className="w-full text-left text-[11px] border-collapse font-mono">
                <thead>
                  <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted">
                    <th className="py-2 px-3 font-medium">{t("catalog.history.colPath")}</th>
                    <th className="py-2 px-3 font-medium">{t("catalog.history.colChange")}</th>
                    <th className="py-2 px-3 font-medium">{t("catalog.history.colValues")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {diff.changes.map((c, i) => (
                    <tr key={`${c.path}-${i}`}>
                      <td className="py-2 px-3 align-top break-all text-text-strong">
                        {c.path}
                      </td>
                      <td className="py-2 px-3 align-top whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded ${CHANGE_CLASS[c.change] ?? "bg-surfaceSubtle text-text-muted"}`}>
                          {tr(`catalog.history.change.${c.change}`, c.change)}
                        </span>
                        {c.truncated ? (
                          <span className="ml-1.5 text-[10px] text-warn">
                            {t("catalog.history.truncated")}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 px-3 align-top break-all">
                        <span className="text-danger/90">{preview(c.from)}</span>
                        <ArrowRight className="inline w-3 h-3 mx-1 text-text-faint" />
                        <span className="text-success/90">{preview(c.to)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export function DefinitionHistory({
  versions,
  currentId,
  loading = false,
  error,
  onReload,
  onChanged,
}: {
  versions: DefinitionVersionItem[];
  /** 当前已发布版本 id：对比基线与回滚影响说明都用它。 */
  currentId?: number;
  /** 列表还在取：此时 items 为空，不能当成"没有历史版本"。 */
  loading?: boolean;
  /** 版本列表加载失败的消息（列表失败只降级本块，编辑器其它部分照常可用）。 */
  error?: string;
  onReload: () => void;
  /** 回滚成功后由编辑器重取版本列表与当前定义。 */
  onChanged: () => void | Promise<void>;
}) {
  const { t, tr, locale } = useI18n();
  const [diffTarget, setDiffTarget] = useState<DefinitionVersionItem>();
  const [rollbackTarget, setRollbackTarget] = useState<DefinitionVersionItem>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [result, setResult] = useState<DefinitionRollback>();

  const confirmRollback = async () => {
    if (!rollbackTarget) return;
    setBusy(true);
    setFailure(undefined);
    let done: DefinitionRollback | undefined;
    try {
      // 目标版本走路径 id，body 一律不传：服务端从不解析回滚请求体。
      done = await rollbackDefinition(rollbackTarget.id);
      setRollbackTarget(undefined);
      setResult(done);
    } catch (err) {
      // 失败时保留确认框，把原因显在原地，用户可以直接重试或取消。
      setFailure(describeRollbackError(err, t));
    } finally {
      setBusy(false);
    }
    if (!done) return;
    // 回滚已经落库，重取失败只影响本地视图：由编辑器自己提示原因，
    // 不能在确认框里显示成"回滚失败"。
    try {
      await onChanged();
    } catch {
      /* 刷新失败的提示归编辑器（它的顶层 error 状态） */
    }
  };

  return (
    <section className="space-y-3">
      <h2>{t("catalog.history.title")}</h2>
      {error ? (
        <ErrorNotice
          message={localizeCatalogError(error, t)}
          onRetry={onReload}
          permissionHint={t("catalog.history.permissionHint")}
        />
      ) : null}
      {result ? (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-success-soft space-y-1">
          <p className="leading-relaxed">
            {result.no_op
              ? t("catalog.history.rollbackNoOp", {
                  target: result.target_id,
                  id: result.id,
                })
              : t("catalog.history.rollbackResult", {
                  target: result.target_id,
                  id: result.id,
                  base: result.base_version,
                })}
          </p>
          {result.edit_note ? (
            <p className="text-success-soft/80 font-mono leading-relaxed">
              {t("catalog.history.rollbackNote", { note: result.edit_note })}
            </p>
          ) : null}
        </div>
      ) : null}
      {loading && versions.length === 0 ? (
        <p className="py-8 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{t("catalog.history.loading")}</span>
        </p>
      ) : versions.length === 0 ? (
        // 列表加载失败时上面已经有 ErrorNotice，不再叠一句"暂无历史版本"。
        error ? null : (
          <p className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
            {t("catalog.history.empty")}
          </p>
        )
      ) : (
        <>
          <div className="rounded-xl border border-line-subtle overflow-hidden bg-surface/40">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono">
                  <th className="py-2.5 px-3 font-medium">
                    {t("catalog.history.colVersion")}
                  </th>
                  <th className="py-2.5 px-3 font-medium">{t("catalog.status")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("catalog.baseVersion")}</th>
                  <th className="py-2.5 px-3 font-medium">
                    {t("catalog.history.createdAt")}
                  </th>
                  <th className="py-2.5 px-3 font-medium">
                    {t("catalog.history.summary")}
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    {t("catalog.history.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {versions.map((v) => (
                  <tr
                    key={v.id}
                    className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft"
                  >
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="font-mono text-text-strong">#{v.id}</span>
                      {v.id === currentId ? (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-mono">
                          {t("catalog.history.current")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${STATE_CLASS[v.state] ?? "bg-surfaceSubtle text-text-muted"}`}
                      >
                        {tr(`catalog.state.${v.state}`, v.state)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-text-muted">
                      #{v.base_version}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-text-muted">
                      {timestamp(v.created_at, locale)}
                      {v.created_by ? (
                        <div className="text-[10px] text-text-faint">@{v.created_by}</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-text-muted">{v.summary || "—"}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDiffTarget(v)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surfaceSubtle hover:bg-surfaceHover text-text-body hover:text-text-strong text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                        >
                          <GitCompare className="w-3 h-3" />
                          {t("catalog.history.compare")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFailure(undefined);
                            setRollbackTarget(v);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-warn text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {t("catalog.history.rollback")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 服务端固定 LIMIT 100 且无分页：真到上限时说明一句，免得以为更早的版本不存在。 */}
          {versions.length >= 100 ? (
            <p className="text-[11px] text-text-faint leading-relaxed">
              {t("catalog.history.limitHint")}
            </p>
          ) : null}
        </>
      )}
      {diffTarget ? (
        <DiffModal
          target={diffTarget}
          referenceId={currentId}
          onClose={() => setDiffTarget(undefined)}
        />
      ) : null}
      <ConfirmDialog
        open={!!rollbackTarget}
        title={`${t("catalog.history.rollbackTitle")} · #${rollbackTarget?.id ?? ""}`}
        message={
          <>
            <p className="leading-relaxed">
              {t("catalog.history.rollbackImpact", {
                target: rollbackTarget?.id ?? "—",
                current: currentId ?? "—",
              })}
            </p>
            {failure ? (
              <div className="mt-2 pt-2 border-t border-rose-500/30 space-y-1">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{failure.text}</span>
                </p>
                {failure.issues?.length ? (
                  <ul className="list-disc pl-4 space-y-0.5 font-mono">
                    {failure.issues.map((issue, i) => (
                      <li key={`${i}-${issue}`}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        }
        confirmLabel={t("catalog.history.rollbackConfirm")}
        busy={busy}
        onClose={() => {
          if (busy) return;
          setRollbackTarget(undefined);
          setFailure(undefined);
        }}
        onConfirm={confirmRollback}
      />
    </section>
  );
}
