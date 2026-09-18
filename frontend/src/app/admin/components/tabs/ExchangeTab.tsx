"use client";

// 「实例交换」管理台页签：导出实体快照 + 提交外部编辑提案。
//
// 两块能力彼此独立（导出是匿名可达的 GET，提案是只要求登录的 POST），
// 所以各自持有自己的请求状态：导出失败不阻塞粘贴提案，反之亦然。
//
// 文案一律走 t()/tr()；状态码与错误码交给 exchange.ts 的映射翻成人话，
// 未登记的码带上状态码原样显示，不把失败说成成功。

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileJson,
  Info,
  Loader2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import {
  EXCHANGE_SOURCE_KINDS,
  describeExchangeError,
  fetchExchangeEntity,
  isValidSourceUrl,
  submitExchangeProposal,
  type ExchangeEntity,
  type ExchangeSource,
  type ExchangeSourceKind,
} from "@/lib/api/exchange";
import { ErrorNotice, SectionHeader, StatusMessage } from "@/components/common/Blocks";

/** 新建（entity.id 为空）时 expected_version 必须是 0，非 0 会被判成版本冲突。 */
const NEW_ENTITY_VERSION = 0;

const FIELD_CLASS =
  "w-full px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong placeholder:text-text-faint focus:border-primary outline-none";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-xs transition-colors duration-fast ease-soft cursor-pointer disabled:opacity-50";

export function ExchangeTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-3">
        <h2 className="text-base font-semibold text-text-strong flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-primary" />
          <span>{t("admin.exchange.title")}</span>
        </h2>
        <p className="text-xs text-text-muted leading-relaxed">{t("admin.exchange.subtitle")}</p>

        <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/25 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-warn-soft">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>{t("admin.exchange.noticeTitle")}</span>
          </div>
          <p className="text-[11px] text-amber-800/80 dark:text-amber-100/70 leading-relaxed">
            {t("admin.exchange.noticeDesc")}
          </p>
        </div>
      </div>

      <ExportPanel />
      <ProposalPanel />
    </div>
  );
}

function ExportPanel() {
  const { t } = useI18n();
  const [entityId, setEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ExchangeEntity | null>(null);
  const [snapshotJson, setSnapshotJson] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const handleExport = async () => {
    const id = entityId.trim();
    setNotice(null);
    if (id === "") {
      setError(t("admin.exchange.exportIdRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchExchangeEntity(id);
      setSnapshot(data);
      setSnapshotJson(JSON.stringify(data, null, 2));
      setExpanded(true);
    } catch (err) {
      // 失败时丢掉上一份快照：留着旧 JSON 会被当成这次导出的结果。
      setSnapshot(null);
      setSnapshotJson("");
      setError(describeExchangeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      // 非安全上下文（http 非 localhost）下 navigator.clipboard 不存在，必须走降级提示。
      if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(snapshotJson);
      setNotice({ kind: "ok", text: t("common.copied") });
    } catch {
      // 剪贴板被拒时展开全文，给用户一条手动复制的出口。
      setExpanded(true);
      setNotice({ kind: "err", text: t("admin.exchange.copyFailed") });
    }
  };

  const handleDownload = () => {
    const id = (snapshot?.id ?? entityId).trim();
    try {
      const blob = new Blob([snapshotJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `entity-${id || "snapshot"}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // 立刻回收：objectURL 会一直占着内存直到页面卸载。
      URL.revokeObjectURL(url);
      setNotice(null);
    } catch {
      setNotice({ kind: "err", text: t("admin.exchange.downloadFailed") });
    }
  };

  const keyFields = snapshot
    ? [
        { label: t("admin.exchange.fieldId"), value: snapshot.id || "—" },
        { label: t("admin.entities.colKind"), value: snapshot.kind || "—" },
        { label: t("admin.entities.colVersion"), value: snapshot.version != null ? String(snapshot.version) : "—" },
        { label: t("admin.entities.colStatus"), value: snapshot.status || "—" },
        { label: t("admin.entities.colTitle"), value: snapshot.title || "—" },
      ]
    : [];

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Download className="w-4 h-4 text-info" />}
        title={t("admin.exchange.exportTitle")}
        desc={t("admin.exchange.exportDesc")}
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1 min-w-0 space-y-1">
          <span className="block text-[11px] font-mono text-text-muted">{t("admin.exchange.exportIdLabel")}</span>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder={t("admin.exchange.exportIdPlaceholder")}
            className={`${FIELD_CLASS} font-mono`}
          />
        </label>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading}
          className="sm:self-end inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-semibold text-xs transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>{loading ? t("admin.exchange.exportLoading") : t("admin.exchange.exportAction")}</span>
        </button>
      </div>
      <p className="text-[11px] text-text-faint leading-relaxed">{t("admin.exchange.exportVisibilityHint")}</p>

      {error ? <ErrorNotice message={error} onRetry={handleExport} /> : null}

      {snapshot ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {keyFields.map((field) => (
              <div key={field.label} className="p-2.5 rounded-lg bg-surfaceSubtle border border-line-subtle min-w-0">
                <div className="text-[10px] font-mono text-text-faint">{field.label}</div>
                <div className="text-xs text-text-strong break-all">{field.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleCopy} className={BUTTON_CLASS}>
              <ClipboardCopy className="w-3.5 h-3.5" />
              <span>{t("admin.exchange.copyJson")}</span>
            </button>
            <button type="button" onClick={handleDownload} className={BUTTON_CLASS}>
              <Download className="w-3.5 h-3.5" />
              <span>{t("admin.exchange.downloadJson")}</span>
            </button>
            <button type="button" onClick={() => setExpanded((prev) => !prev)} className={BUTTON_CLASS}>
              <span>{expanded ? t("common.collapse") : t("common.expand")}</span>
            </button>
          </div>

          {notice ? <StatusMessage kind={notice.kind} text={notice.text} /> : null}

          {expanded ? (
            <pre className="p-3 rounded-xl bg-surfaceSubtle border border-line-subtle overflow-auto text-[11px] font-mono text-text-body max-h-[420px]">
              {snapshotJson}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProposalPanel() {
  const { t, tr } = useI18n();
  const [entityJson, setEntityJson] = useState("");
  const [editNote, setEditNote] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(String(NEW_ENTITY_VERSION));
  const [sources, setSources] = useState<ExchangeSource[]>([{ kind: "url", citation: "", url: "" }]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExchangeEntity | null>(null);
  const [pending, setPending] = useState<{ entity: ExchangeEntity; expectedVersion: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const updateSource = (index: number, patch: Partial<ExchangeSource>) => {
    setSources((prev) => prev.map((source, i) => (i === index ? { ...source, ...patch } : source)));
  };

  /**
   * 本地预检与后端同一口径（validation.go:176）。
   * 解析不了、缺说明、缺来源、来源不合法都在这里拦住，省一次注定 400 的往返；
   * 服务端返回的 evidence_required / invalid_source 仍会照实显示，不做本地替代。
   */
  const prepare = (): { entity: ExchangeEntity; expectedVersion: number } | null => {
    setLocalError(null);
    setError(null);
    const raw = entityJson.trim();
    if (raw === "") {
      setLocalError(t("admin.exchange.errEntityRequired"));
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      setLocalError(
        t("admin.exchange.errJsonInvalid", { message: err instanceof Error ? err.message : String(err) })
      );
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setLocalError(t("admin.exchange.errEntityNotObject"));
      return null;
    }
    if (editNote.trim() === "") {
      setLocalError(t("admin.exchange.errEditNoteRequired"));
      return null;
    }
    const version = Number(expectedVersion.trim() === "" ? String(NEW_ENTITY_VERSION) : expectedVersion.trim());
    if (!Number.isInteger(version) || version < 0) {
      setLocalError(t("admin.exchange.errExpectedVersion"));
      return null;
    }
    if (sources.length === 0) {
      setLocalError(t("admin.exchange.errSourcesRequired"));
      return null;
    }
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const url = (source.url ?? "").trim();
      if (source.citation.trim() === "") {
        setLocalError(t("admin.exchange.errSourceCitation", { index: index + 1 }));
        return null;
      }
      if (source.kind === "url" && url === "") {
        setLocalError(t("admin.exchange.errSourceUrlRequired", { index: index + 1 }));
        return null;
      }
      if (url !== "" && !isValidSourceUrl(url)) {
        setLocalError(t("admin.exchange.errSourceUrl", { index: index + 1 }));
        return null;
      }
    }
    return { entity: parsed as ExchangeEntity, expectedVersion: version };
  };

  const handleSubmitClick = () => {
    const prepared = prepare();
    if (!prepared) return;
    // 提交会落库并进待审队列，属于破坏性动作：先弹二次确认再发请求。
    setPending(prepared);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const saved = await submitExchangeProposal({
        entity: pending.entity,
        expectedVersion: pending.expectedVersion,
        editNote: editNote.trim(),
        sources: sources.map((source) => ({
          kind: source.kind,
          citation: source.citation.trim(),
          url: (source.url ?? "").trim(),
        })),
      });
      setResult(saved);
      setError(null);
    } catch (err) {
      setResult(null);
      setError(describeExchangeError(err, t));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  // 粘贴进来的 JSON 由用户提供，id 可能是任意类型：先确认为字符串再放进确认框，避免渲染时抛错。
  const pendingId = pending && typeof pending.entity.id === "string" ? pending.entity.id.trim() : "";

  const resultFields = result
    ? [
        { label: t("admin.exchange.fieldId"), value: result.id || "—" },
        { label: t("admin.entities.colVersion"), value: result.version != null ? String(result.version) : "—" },
        { label: t("admin.entities.colStatus"), value: result.status || "—" },
      ]
    : [];

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<FileJson className="w-4 h-4 text-alt" />}
        title={t("admin.exchange.proposalTitle")}
        desc={t("admin.exchange.proposalDesc")}
      />

      <div className="space-y-1">
        <label className="block text-[11px] font-mono text-text-muted">{t("admin.exchange.entityJsonLabel")}</label>
        <textarea
          rows={8}
          value={entityJson}
          onChange={(e) => setEntityJson(e.target.value)}
          placeholder={t("admin.exchange.entityJsonPlaceholder")}
          className={`${FIELD_CLASS} font-mono resize-y`}
        />
        <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.exchange.entityJsonHint")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-[11px] font-mono text-text-muted">{t("admin.exchange.editNoteLabel")}</label>
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder={t("admin.exchange.editNotePlaceholder")}
            className={FIELD_CLASS}
          />
          <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.exchange.editNoteHint")}</p>
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-mono text-text-muted">
            {t("admin.exchange.expectedVersionLabel")}
          </label>
          <input
            type="number"
            min={0}
            value={expectedVersion}
            onChange={(e) => setExpectedVersion(e.target.value)}
            className={`${FIELD_CLASS} font-mono`}
          />
          <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.exchange.expectedVersionHint")}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-[11px] font-mono text-text-muted">{t("admin.exchange.sourcesLabel")}</label>
          <button type="button" onClick={() => setSources((prev) => [...prev, { kind: "url", citation: "", url: "" }])} className={BUTTON_CLASS}>
            <Plus className="w-3.5 h-3.5" />
            <span>{t("admin.exchange.sourceAdd")}</span>
          </button>
        </div>
        <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.exchange.sourcesHint")}</p>

        {sources.map((source, index) => (
          <div key={index} className="grid grid-cols-1 sm:grid-cols-[132px_1fr_1fr_auto] gap-2 items-start">
            <select
              value={source.kind}
              onChange={(e) => updateSource(index, { kind: e.target.value as ExchangeSourceKind })}
              className={FIELD_CLASS}
            >
              {EXCHANGE_SOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {tr(`admin.exchange.sourceKind.${kind}`, kind)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={source.citation}
              onChange={(e) => updateSource(index, { citation: e.target.value })}
              placeholder={t("admin.exchange.sourceCitationPlaceholder")}
              className={FIELD_CLASS}
            />
            <input
              type="text"
              value={source.url ?? ""}
              onChange={(e) => updateSource(index, { url: e.target.value })}
              placeholder={t("admin.exchange.sourceUrlPlaceholder")}
              className={`${FIELD_CLASS} font-mono`}
            />
            <button
              type="button"
              onClick={() => setSources((prev) => prev.filter((_, i) => i !== index))}
              title={t("common.delete")}
              className={`${BUTTON_CLASS} justify-center`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {sources.length === 0 ? (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-500 leading-relaxed">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{t("admin.exchange.sourcesEmpty")}</span>
          </p>
        ) : null}
      </div>

      {localError ? <ErrorNotice message={localError} /> : null}
      {error ? <ErrorNotice message={error} permissionHint={t("admin.exchange.proposalForbiddenHint")} /> : null}

      {result ? (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-success-soft">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{t("admin.exchange.successTitle")}</span>
          </div>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-100/70 leading-relaxed">
            {t("admin.exchange.successDesc")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {resultFields.map((field) => (
              <div key={field.label} className="p-2 rounded-lg bg-surfaceSubtle border border-line-subtle min-w-0">
                <div className="text-[10px] font-mono text-text-faint">{field.label}</div>
                <div className="text-xs text-text-strong break-all">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-black font-semibold text-xs transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          <span>{busy ? t("admin.exchange.submitting") : t("admin.exchange.submit")}</span>
        </button>
        <span className="text-[11px] text-text-faint leading-relaxed">{t("admin.exchange.proposalApiHint")}</span>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={t("admin.exchange.confirmTitle")}
        message={
          <div className="space-y-2">
            <p>{t("admin.exchange.confirmMessage")}</p>
            <ul className="space-y-1 font-mono text-[11px]">
              <li>
                {t("admin.exchange.confirmEntityId", {
                  id: pendingId !== "" ? pendingId : t("admin.exchange.confirmNewEntity"),
                })}
              </li>
              <li>
                {t("admin.exchange.confirmExpectedVersion", {
                  version: String(pending?.expectedVersion ?? NEW_ENTITY_VERSION),
                })}
              </li>
            </ul>
          </div>
        }
        confirmLabel={t("admin.exchange.confirmAction")}
        busy={busy}
        // 提交中不允许关掉确认框：关掉并不能取消已发出的请求，只会让用户以为取消了。
        onClose={() => { if (!busy) setPending(null); }}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
