"use client";

// 社区分区管理面板：列表 + 搜索 + 编辑（四语名称/描述、颜色、图标、排序、两个开关）。
//
// 契约来源（只读核对，未改论坛服务代码）：
//   metafusion-community/internal/handler/board.go:97-188 —— PUT 只改传入字段、四语校验、code 不可改
//   metafusion-community/internal/handler/forum.go:114-149 —— 列表是裸数组、10 个字段、ORDER BY sort_order,code
//
// 三个刻意的取舍：
//   1) 不走 lib/api/community.ts 的 fetchBoards()：那里的 normalizeBoard 会把 color 收敛成
//      tailwind class、还注入一个虚拟 "all" 分区，编辑需要的是能原样回写的原始值。
//   2) 服务端只有 UPDATE（板块由种子播种），所以界面不提供新建与删除入口——做出来只会 404。
//   3) 列表匿名可读：没有 community.board.manage 时照常出清单，只是不给编辑入口。

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LayoutGrid, Pencil, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/lib/authContext";
import { COMMUNITY_BOARD_MANAGE, can } from "@/lib/permissions";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import {
  BOARD_COLORS,
  BOARD_ICON_SUGGESTIONS,
  boardText,
  checkLocaleMap,
  describeBoardError,
  diffBoardPatch,
  fetchBoardRows,
  formatLocaleList,
  updateBoard,
  type BoardFormValues,
  type BoardPatch,
  type BoardRow,
} from "@/lib/api/boards";
import {
  ErrorNotice,
  MultilingualTextEditor,
  RefreshButton,
  SectionHeader,
  StatusMessage,
} from "./accountAccess/shared";

// 模块级常量：列表资源与空表的初值必须是稳定引用，否则每次渲染都会重跑取数。
const EMPTY_BOARDS: BoardRow[] = [];
const OK_BADGE = "px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300";
const MUTED_BADGE = "px-1.5 py-0.5 rounded text-[10px] font-mono bg-surfaceSubtle text-text-faint";
const FIELD_CLASS =
  "w-full p-2 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none";

/** 编辑器用表单态：排序在输入框里是文本，提交前才解析成 int（服务端该字段是 int）。 */
type EditorState = {
  names: Record<string, string>;
  descriptions: Record<string, string>;
  color: string;
  icon: string;
  sortOrder: string;
  isEnabled: boolean;
  showInFeed: boolean;
};

/**
 * 列表取数。形态与 accountAccess/shared.tsx 的 useAdminResource 一致，
 * 但错误文案必须点名论坛服务：shared 的 describeAdminError 固定说"账号服务"，用在这里是错的。
 */
function useBoards() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BoardRow[]>(EMPTY_BOARDS);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchBoardRows()
      .then((rows) => {
        if (!alive) return;
        setData(Array.isArray(rows) ? rows : []);
        setError(null);
      })
      .catch((err) => {
        // 取数失败保留上一次成功的数据，但错误如实显示；只有这一块降级，不影响页面其它部分。
        if (alive) setError(describeBoardError(err, t, locale, COMMUNITY_BOARD_MANAGE));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce, t, locale]);

  return { loading, error, data, reload };
}

function StateBadge({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return <span className={on ? OK_BADGE : MUTED_BADGE}>{on ? onLabel : offLabel}</span>;
}

export function BoardsTab() {
  const { t, locale } = useI18n();
  const { user: me } = useAuth();
  const mayManage = can(me, COMMUNITY_BOARD_MANAGE);
  const rows = useBoards();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [form, setForm] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // 待确认的破坏性补丁：确认框自己不再重算补丁，避免确认期间表单被改动导致提交内容漂移。
  const [pending, setPending] = useState<{ patch: BoardPatch; reasons: string[] } | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!normalizedQuery) return rows.data;
    // 搜索是纯前端过滤：列表接口没有搜索参数，按 code 或任一语种名称匹配。
    return rows.data.filter((row) => {
      if ((row.code ?? "").toLowerCase().includes(normalizedQuery)) return true;
      return Object.values(row.names ?? {}).some((value) =>
        (value ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [rows.data, normalizedQuery]);

  const openEditor = (row: BoardRow) => {
    setEditing(row);
    setForm({
      names: { ...(row.names ?? {}) },
      descriptions: { ...(row.descriptions ?? {}) },
      color: row.color ?? "",
      icon: row.icon ?? "",
      sortOrder: String(row.sort_order ?? 0),
      isEnabled: row.is_enabled !== false,
      showInFeed: row.show_in_feed !== false,
    });
    setMessage(null);
    setPending(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
    setMessage(null);
    setPending(null);
  };

  const patchForm = (next: Partial<EditorState>) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  };

  /**
   * 本地校验 + 差分：只提交改动过的字段（服务端是补丁语义，空载荷会被 400 拒）。
   * 只校验**将要提交的字段**——库里已有的不完整翻译不该拦住"只想改排序"的操作。
   */
  const buildPatch = (): { patch: BoardPatch } | { error: string } => {
    if (!editing || !form) return { error: t("admin.boards.noChanges") };
    const rawSort = form.sortOrder.trim();
    if (!/^-?\d+$/.test(rawSort)) return { error: t("admin.boards.errSortInvalid") };
    const values: BoardFormValues = {
      names: form.names,
      descriptions: form.descriptions,
      color: form.color,
      icon: form.icon,
      sort_order: Number(rawSort),
      is_enabled: form.isEnabled,
      show_in_feed: form.showInFeed,
    };
    const patch = diffBoardPatch(editing, values);
    if (Object.keys(patch).length === 0) return { error: t("admin.boards.noChanges") };
    if (patch.names !== undefined) {
      const state = checkLocaleMap(patch.names);
      if (!state.ok) {
        return {
          error: t("admin.boards.errNamesMissing", {
            locales: formatLocaleList(state.missing, locale),
          }),
        };
      }
      // 名称是板块身份：全空会被服务端判成 invalid_payload，这里提前拦下并说清原因。
      if (state.cleared) return { error: t("admin.boards.errNamesClear") };
    }
    if (patch.descriptions !== undefined) {
      const state = checkLocaleMap(patch.descriptions);
      if (!state.ok) {
        return {
          error: t("admin.boards.errDescsMissing", {
            locales: formatLocaleList(state.missing, locale),
          }),
        };
      }
    }
    if (patch.color !== undefined && patch.color.trim() === "") {
      return { error: t("admin.boards.errFieldRequired", { field: t("admin.boards.colColor") }) };
    }
    if (patch.icon !== undefined && patch.icon.trim() === "") {
      return { error: t("admin.boards.errFieldRequired", { field: t("admin.boards.colIcon") }) };
    }
    return { patch };
  };

  /** 停用分区与清空全部描述都是"改完就看不见"的动作，提交前要二次确认。 */
  const destructiveReasons = (patch: BoardPatch): string[] => {
    const reasons: string[] = [];
    if (patch.is_enabled === false) reasons.push(t("admin.boards.confirmDisable"));
    if (patch.descriptions !== undefined) {
      const state = checkLocaleMap(patch.descriptions);
      if (state.ok && state.cleared) reasons.push(t("admin.boards.confirmClearDesc"));
    }
    return reasons;
  };

  const submit = async (patch: BoardPatch) => {
    if (!editing) return;
    const code = editing.code;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateBoard(code, patch);
      closeEditor();
      setMessage({
        kind: "ok",
        text: t("admin.boards.saveSuccess", { code: (updated && updated.code) || code }),
      });
      // 重拉列表而不是就地改本地状态：服务端会 TrimSpace 并把 map 派生成单值列，本地推算会飘。
      rows.reload();
    } catch (err) {
      setPending(null);
      // 失败时保持弹窗打开且不回写任何本地状态，管理员可以改完再试。
      setMessage({ kind: "err", text: describeBoardError(err, t, locale, COMMUNITY_BOARD_MANAGE) });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (busy) return;
    const result = buildPatch();
    if ("error" in result) {
      setMessage({ kind: "err", text: result.error });
      return;
    }
    const reasons = destructiveReasons(result.patch);
    if (reasons.length > 0) {
      setMessage(null);
      setPending({ patch: result.patch, reasons });
      return;
    }
    void submit(result.patch);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<LayoutGrid className="w-4 h-4 text-primary" />}
        title={t("admin.boards.title")}
        desc={t("admin.boards.subtitle")}
        actions={<RefreshButton onClick={rows.reload} loading={rows.loading} />}
      />

      <p className="text-[11px] text-text-faint leading-relaxed">{t("admin.boards.manageHint")}</p>

      {mayManage ? null : (
        <p className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 leading-relaxed">
          {t("admin.boards.readOnlyNotice", { code: COMMUNITY_BOARD_MANAGE })}
        </p>
      )}

      {rows.error ? <ErrorNotice message={rows.error} onRetry={rows.reload} /> : null}

      {message && !editing ? <StatusMessage kind={message.kind} text={message.text} /> : null}

      <div className="relative flex items-center max-w-md">
        <Search className="absolute left-3 w-3.5 h-3.5 text-text-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.boards.searchPlaceholder")}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none"
        />
      </div>

      {!rows.loading && !rows.error ? (
        <p className="text-[11px] text-text-faint font-mono">
          {t("admin.boards.total", { count: visible.length })}
        </p>
      ) : null}

      {rows.loading && rows.data.length === 0 ? (
        <div className="py-10 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>{t("admin.boards.loading")}</span>
        </div>
      ) : null}

      {!rows.loading && !rows.error && visible.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
          {query.trim() ? t("admin.boards.filterEmpty") : t("admin.boards.noData")}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="rounded-xl border border-line-subtle bg-surface/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line-subtle bg-surfaceSubtle text-text-muted font-mono">
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colCode")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colNames")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colDesc")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colIcon")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colColor")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colOrder")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colEnabled")}</th>
                  <th className="py-2.5 px-3 font-medium">{t("admin.boards.colInFeed")}</th>
                  {mayManage ? (
                    <th className="py-2.5 px-3 font-medium text-right">{t("admin.boards.colAction")}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {visible.map((row) => {
                  const name = boardText(row.names, locale, row.name || row.code);
                  const desc = boardText(row.descriptions, locale, row.description);
                  return (
                    <tr
                      key={row.code}
                      className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft"
                    >
                      <td className="py-2.5 px-3 font-mono text-text-strong whitespace-nowrap">
                        {row.code}
                      </td>
                      <td className="py-2.5 px-3 text-text-strong">{name}</td>
                      <td className="py-2.5 px-3 text-text-muted max-w-[260px]">
                        <span className="block truncate" title={desc}>
                          {desc || "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-text-muted">{row.icon || "—"}</td>
                      <td className="py-2.5 px-3 font-mono text-text-muted">{row.color || "—"}</td>
                      <td className="py-2.5 px-3 font-mono text-text-muted">{row.sort_order}</td>
                      <td className="py-2.5 px-3">
                        <StateBadge
                          on={row.is_enabled !== false}
                          onLabel={t("admin.boards.enableBadge")}
                          offLabel={t("admin.boards.disableBadge")}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <StateBadge
                          on={row.show_in_feed !== false}
                          onLabel={t("admin.boards.feedBadge")}
                          offLabel={t("admin.boards.noFeedBadge")}
                        />
                      </td>
                      {mayManage ? (
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditor(row)}
                            className="px-2 py-1 rounded bg-surfaceSubtle hover:bg-surfaceHover text-text-body hover:text-text-strong text-[11px] transition-colors duration-fast ease-soft cursor-pointer inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>{t("admin.boards.edit")}</span>
                          </button>
                        </td>
                      ) : null}
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
        title={t("admin.boards.editTitle")}
        icon={<LayoutGrid className="w-4 h-4 text-primary" />}
        maxWidth="max-w-2xl"
      >
        {editing && form ? (
          <div className="space-y-4 text-xs">
            <div className="p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle font-mono text-[11px] text-text-muted">
              {editing.code} · {t("admin.boards.codeImmutableHint")}
            </div>

            {message ? <StatusMessage kind={message.kind} text={message.text} /> : null}

            <MultilingualTextEditor
              label={t("admin.boards.namesLabel")}
              helperText={t("admin.boards.namesHint")}
              required
              value={form.names}
              onChange={(next) => patchForm({ names: next })}
            />

            <MultilingualTextEditor
              label={t("admin.boards.descsLabel")}
              helperText={t("admin.boards.descsHint")}
              value={form.descriptions}
              onChange={(next) => patchForm({ descriptions: next })}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
                  {t("admin.boards.colorLabel")}
                </label>
                <select
                  value={form.color}
                  onChange={(e) => patchForm({ color: e.target.value })}
                  className={FIELD_CLASS + " cursor-pointer"}
                >
                  {/* 清单外的值（老数据或后台直改）原样保留成一个选项，不被悄悄纠正成别的调色板名。 */}
                  {BOARD_COLORS.includes(form.color) ? null : (
                    <option value={form.color}>
                      {t("admin.boards.paletteUnknown", { color: form.color || "—" })}
                    </option>
                  )}
                  {BOARD_COLORS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
                  {t("admin.boards.iconLabel")}
                </label>
                {/* 可自由输入 + 常见候选取值：清单外的 lucide 图标名必须能保留。 */}
                <input
                  type="text"
                  list="mf-board-icon-suggestions"
                  value={form.icon}
                  onChange={(e) => patchForm({ icon: e.target.value })}
                  className={FIELD_CLASS + " font-mono"}
                />
                <datalist id="mf-board-icon-suggestions">
                  {BOARD_ICON_SUGGESTIONS.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-text-body font-medium mb-1">
                  {t("admin.boards.sortLabel")}
                </label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => patchForm({ sortOrder: e.target.value })}
                  className={FIELD_CLASS + " font-mono"}
                />
              </div>
            </div>

            <div className="flex items-center gap-6 flex-wrap">
              <label className="flex items-center gap-2 text-text-body cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={form.isEnabled}
                  onChange={(e) => patchForm({ isEnabled: e.target.checked })}
                />
                <span>{t("admin.boards.enabled")}</span>
              </label>
              <label className="flex items-center gap-2 text-text-body cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={form.showInFeed}
                  onChange={(e) => patchForm({ showInFeed: e.target.checked })}
                />
                <span>{t("admin.boards.feed")}</span>
              </label>
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
                disabled={busy}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
              >
                {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{t("admin.boards.save")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pending != null}
        title={t("admin.boards.confirmTitle")}
        message={
          <ul className="space-y-1.5">
            {(pending?.reasons ?? []).map((reason) => (
              <li key={reason} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        }
        confirmLabel={t("admin.boards.save")}
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending) void submit(pending.patch);
        }}
      />
    </div>
  );
}
