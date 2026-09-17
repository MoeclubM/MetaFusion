"use client";

// 管理台「资源存储」页签：全局用量 + 按资产 ID 查详情/绑定/内容预览 + 解绑。
//
// 契约（只读核对 metafusion-storage/internal/handler/handler.go:47-64、files.go、store/store.go）：
// 错误响应统一 {"error":"<code>"}；/stats 只有 assets 与 bytes 两个字段，**没有配额**；
// 服务端没有"列出全部/我的资产或绑定"的端点，所以按 id 查是唯一入口，这里不伪造分页总表。
// 不可读 / 不存在 / 非法 uuid 一律 404 not_found（服务端刻意不区分），界面照实说"不存在或你没有查看权限"。
//
// 降级粒度照 accountAccess 的做法：用量与查询各自取数——缺 storage.asset.moderate 只让用量卡降级，
// 查询与解绑照常可用；查询失败也不会把用量卡拖黑。

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  HardDrive,
  Link2,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiError } from "@/lib/api";
import {
  StorageRequestError,
  deleteStorageBinding,
  fetchStorageAsset,
  fetchStorageAssetBlob,
  fetchStorageStats,
  storageAssetContentUrl,
  type AssetBindingsResponse,
  type StorageAsset,
  type StorageBinding,
  type StorageStats,
} from "@/lib/storage";
import { ConfirmDialog } from "@/components/oauth/ConfirmDialog";
import { TabPanel } from "@/components/ui/TabPanel";
import { ErrorNotice, RefreshButton, SectionHeader, StatusMessage } from "./accountAccess/shared";
import type { TranslateFn } from "./accountAccess/api";

/** 文案键 + 变量：语言随时可切，这一层只存键，渲染时才翻。 */
type Message = { key: string; vars?: Record<string, string | number> };

/** 用量是运营数据、跨所有上传者：与"处置他人资产"共用 storage.asset.moderate。 */
const MODERATE = "storage.asset.moderate";

const EMPTY_STATS: StorageStats = { assets: 0, bytes: 0 };

/** 404 在不同块里含义不同（资产不可读 / 绑定已被别人删掉），所以逐块给文案。 */
const ASSET_NOT_FOUND: Message = { key: "admin.storage.assetNotFound" };
const MISSING_MODERATE: Message = { key: "admin.storage.errForbidden", vars: { code: MODERATE } };

/** 字节数展示：单位与语言无关，不进字典（口径同 storage/EntityResourceFiles 的 formatSize）。 */
function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value = value / 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

/** 时间按当前语言本地化；解析不了的输入给占位符，而不是 Invalid Date。 */
function formatTime(raw: string | null | undefined, locale: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale);
}

/** 输入可以是裸 uuid，也可以是别处复制来的内容地址：统一抽出 uuid 再查。 */
function extractAssetId(raw: string): string {
  const m = raw.trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : "";
}

function text(t: TranslateFn, msg: Message): string {
  return msg.vars ? t(msg.key, msg.vars) : t(msg.key);
}

/**
 * 存储服务的错误码逐条翻译（码是稳定的，见 handler.fail）。
 * 404 与 403 的含义随块不同，所以由调用方给这两条的文案：403 既可能是"缺权限码"，
 * 也可能是"不是这个绑定的所有者"，合成一句话只会丢掉唯一有用的信息。
 */
function describeStorageError(err: unknown, ctx: { notFound?: Message; forbidden?: Message } = {}): Message {
  const status = err instanceof ApiError ? err.status : err instanceof StorageRequestError ? err.status : 0;
  const code = err instanceof ApiError ? err.message : err instanceof StorageRequestError ? err.code : "";
  if (code === "not_found" || status === 404) {
    return ctx.notFound ?? { key: "admin.storage.errGeneric", vars: { status: 404, message: "not_found" } };
  }
  if (code === "forbidden" || status === 403) return ctx.forbidden ?? MISSING_MODERATE;
  if (code === "authentication_required" || status === 401) return { key: "admin.storage.errAuth" };
  if (code === "module_error" || status === 500) return { key: "admin.storage.errModule" };
  if (code === "storage_unavailable" || (status >= 502 && status <= 504)) return { key: "admin.storage.errUnavailable" };
  if (status === 0) {
    return { key: "admin.storage.errNetwork", vars: { message: err instanceof Error ? err.message : String(err) } };
  }
  return {
    key: "admin.storage.errGeneric",
    vars: { status, message: code || (err instanceof Error ? err.message : "") },
  };
}

export function StorageTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle space-y-2">
        <h2 className="text-base font-semibold text-text-strong flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span>{t("admin.assets.title")}</span>
        </h2>
        <p className="text-xs text-text-muted leading-relaxed">{t("admin.assets.subtitle")}</p>
        <p className="flex items-start gap-1.5 text-[11px] text-text-muted leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400/80" />
          <span>{t("admin.storage.noListHint")}</span>
        </p>
      </div>

      <UsageCard />
      <AssetLookup />
    </div>
  );
}

/** 用量卡：独立取数，403 只降级这一块。 */
function UsageCard() {
  const { t } = useI18n();
  const [stats, setStats] = useState<StorageStats>(EMPTY_STATS);
  const [error, setError] = useState<Message | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchStorageStats()
      .then((next) => {
        if (!alive) return;
        setStats(next);
        setError(null);
        setLoaded(true);
      })
      .catch((err) => {
        if (alive) setError(describeStorageError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const reload = () => setNonce((n) => n + 1);
  const forbidden = error?.key === "admin.storage.errForbidden";

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<HardDrive className="w-4 h-4 text-primary" />}
        title={t("admin.storage.usageTitle")}
        desc={t("admin.storage.usageDesc")}
        actions={<RefreshButton onClick={reload} loading={loading} />}
      />

      {error ? (
        // 缺 storage.asset.moderate 是预期内的降级：讲清需要哪个权限码，其余块不受影响。
        <ErrorNotice
          message={text(t, error)}
          permissionHint={forbidden ? t("admin.storage.usageForbiddenHint") : undefined}
          onRetry={reload}
        />
      ) : !loaded ? (
        <div className="py-8 text-center text-xs text-text-faint font-mono flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>{t("admin.storage.loading")}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
              <div className="text-[11px] text-text-muted font-mono">{t("admin.storage.usageAssetsLabel")}</div>
              <div className="text-2xl font-semibold text-text-strong mt-1 font-mono">{stats.assets}</div>
            </div>
            <div className="p-4 rounded-xl bg-surfaceSubtle border border-line-subtle">
              <div className="text-[11px] text-text-muted font-mono">{t("admin.storage.usageBytesLabel")}</div>
              <div className="text-2xl font-semibold text-text-strong mt-1 font-mono">{formatSize(stats.bytes)}</div>
              <div className="text-[10px] text-text-faint font-mono mt-0.5">
                {t("admin.storage.usageBytesRaw", { bytes: stats.bytes })}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.storage.usageNoQuota")}</p>
        </>
      )}
    </div>
  );
}

/** 查询块：按资产 uuid 取详情 + 绑定，并在解绑后重新取数。 */
function AssetLookup() {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [data, setData] = useState<AssetBindingsResponse | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: Message } | null>(null);
  const [pending, setPending] = useState<StorageBinding | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 解绑后要按同一个 id 重新取数：不能用输入框的当前值（用户可能已经改了它）。
  const lastId = useRef("");

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      setData(await fetchStorageAsset(id));
      setError(null);
    } catch (err) {
      setData(null);
      setError(describeStorageError(err, { notFound: ASSET_NOT_FOUND }));
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const id = extractAssetId(value);
    if (!id) {
      // 非法 uuid 服务端也回 not_found，本地先挡一道，省一次注定失败的请求。
      lastId.current = "";
      setData(null);
      setError({ key: "admin.storage.invalidId" });
      return;
    }
    lastId.current = id;
    setValue(id);
    void load(id);
  };

  const refresh = useCallback(async () => {
    if (!lastId.current) return;
    try {
      setData(await fetchStorageAsset(lastId.current));
      setError(null);
    } catch (err) {
      setData(null);
      setError(describeStorageError(err, { notFound: ASSET_NOT_FOUND }));
    }
  }, []);

  const unbind = async (binding: StorageBinding) => {
    setBusyId(binding.id);
    setNotice(null);
    try {
      await deleteStorageBinding(binding.id);
      setNotice({ kind: "ok", msg: { key: "admin.storage.unbindDone" } });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : err instanceof StorageRequestError ? err.status : 0;
      const code = err instanceof ApiError ? err.message : err instanceof StorageRequestError ? err.code : "";
      if (code === "not_found" || status === 404) {
        // 解绑不幂等：第二次删同一个 id 就是 404，必须讲清"该绑定已不存在"。
        setNotice({ kind: "err", msg: { key: "admin.storage.unbindNotFound" } });
      } else if (code === "forbidden" || status === 403) {
        setNotice({ kind: "err", msg: { key: "admin.storage.unbindForbidden" } });
      } else {
        setNotice({ kind: "err", msg: describeStorageError(err) });
      }
    } finally {
      setBusyId(null);
      setPending(null);
      // 无论成败都重新取数：成功要拿掉那一行，404 说明手上这份列表已经过期。
      await refresh();
    }
  };

  const notFoundHint = error?.key === "admin.storage.assetNotFound";

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={<Search className="w-4 h-4 text-primary" />}
        title={t("admin.storage.lookupTitle")}
        desc={t("admin.storage.lookupDesc")}
      />

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          placeholder={t("admin.storage.assetIdPlaceholder")}
          aria-label={t("admin.storage.assetIdLabel")}
          className="flex-1 px-3 py-2 rounded-lg bg-surfaceSubtle border border-line text-xs text-text-strong font-mono focus:border-primary outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary/90 hover:bg-primary text-white text-xs font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span>{loading ? t("admin.storage.querying") : t("admin.storage.query")}</span>
        </button>
      </form>

      {notice ? <StatusMessage kind={notice.kind} text={text(t, notice.msg)} /> : null}

      {error ? <ErrorNotice message={text(t, error)} permissionHint={notFoundHint ? t("admin.storage.lookupPermHint") : undefined} /> : null}

      {!data && !error && !loading ? (
        <p className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
          {t("admin.storage.emptyPrompt")}
        </p>
      ) : null}

      {data ? (
        // activeKey 用资产 id：换一份资产就重挂面板、重放进入动画（TabPanel 的契约）。
        <TabPanel activeKey={data.asset.id} spacing="sections">
          <AssetDetail data={data} notice={notice} busyId={busyId} onRequestUnbind={setPending} />
        </TabPanel>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={t("admin.storage.unbindTitle")}
        message={
          pending
            ? t("admin.storage.unbindConfirm", {
                file: data?.asset.file_name ?? "",
                entity: pending.target_entity_id,
                role: pending.binding_role,
              })
            : ""
        }
        confirmLabel={t("admin.storage.unbind")}
        busy={busyId !== null}
        onClose={() => {
          if (busyId === null) setPending(null);
        }}
        onConfirm={() => {
          if (pending) void unbind(pending);
        }}
      />
    </div>
  );
}

/** 详情行：标签定宽，值允许换行（uuid / sha256 / object_key 都很长）。 */
function Field({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 py-1.5 border-b border-line-subtle last:border-0">
      <dt className="text-[11px] text-text-muted font-mono shrink-0 sm:w-44">{label}</dt>
      <dd className={`text-xs text-text-body min-w-0 break-all ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function AssetDetail({
  data,
  notice,
  busyId,
  onRequestUnbind,
}: {
  data: AssetBindingsResponse;
  notice: { kind: "ok" | "err"; msg: Message } | null;
  busyId: string | null;
  onRequestUnbind: (binding: StorageBinding) => void;
}) {
  const { t, tr, locale } = useI18n();
  const asset = data.asset;
  // 状态码是契约值（pending / complete），词典只做补充说明；出现新状态时原样显示码，不臆造含义。
  const statusGloss = tr(`admin.storage.status.${asset.status}`, "");
  const declaredOnly = asset.size_bytes === 0 && asset.declared_size > 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title={t("admin.storage.detailTitle")}
        desc={t("admin.storage.detailDesc")}
      />

      <dl className="p-4 rounded-xl border border-line bg-surface">
        <Field label={t("admin.storage.fieldAssetId")} mono>
          {asset.id}
        </Field>
        <Field label={t("admin.assets.colFile")} mono>
          {asset.file_name}
        </Field>
        <Field label={t("admin.storage.fieldMime")} mono>
          {asset.mime_type}
        </Field>
        <Field label={t("admin.assets.colSize")} mono>
          {declaredOnly ? (
            <span>
              {formatSize(asset.declared_size)} · {t("admin.storage.sizeDeclaredOnly")}
            </span>
          ) : (
            <span>
              {formatSize(asset.size_bytes)} · {t("admin.storage.bytesRaw", { bytes: asset.size_bytes })}
            </span>
          )}
        </Field>
        <Field label={t("admin.assets.colSha")} mono>
          {asset.sha256}
        </Field>
        <Field label={t("admin.storage.fieldStatus")}>
          <span className="px-1.5 py-0.5 rounded border border-line font-mono text-[11px]">{asset.status}</span>
          {statusGloss ? <span className="ml-2 text-[11px] text-text-muted">{statusGloss}</span> : null}
        </Field>
        <Field label={t("admin.storage.fieldHashVerified")}>
          {asset.hash_verified ? (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("admin.storage.hashVerified")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("admin.storage.hashNotVerified")}
            </span>
          )}
        </Field>
        <Field label={t("admin.storage.fieldUploader")} mono>
          {asset.uploader_id}
        </Field>
        <Field label={t("admin.storage.fieldCreatedAt")}>{formatTime(asset.created_at, locale)}</Field>
        <Field label={t("admin.storage.fieldCompletedAt")}>{formatTime(asset.completed_at, locale)}</Field>
        <Field label={t("admin.storage.fieldObjectKey")} mono>
          {asset.object_key}
        </Field>
        {asset.fail_reason ? (
          <Field label={t("admin.storage.fieldFailReason")} mono>
            <span className="text-rose-300">{asset.fail_reason}</span>
          </Field>
        ) : null}
      </dl>

      <AssetPreview asset={asset} />

      <div className="space-y-3">
        <SectionHeader
          icon={<Link2 className="w-4 h-4 text-primary" />}
          title={t("admin.storage.bindingsTitle")}
          desc={t("admin.storage.bindingsDesc")}
        />

        {notice ? <StatusMessage kind={notice.kind} text={text(t, notice.msg)} /> : null}

        {data.bindings.length === 0 ? (
          <p className="p-6 rounded-xl border border-dashed border-line text-center text-xs text-text-faint font-mono">
            {t("admin.storage.bindingsEmpty")}
          </p>
        ) : (
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surfaceSubtle font-mono text-[11px] text-text-muted uppercase tracking-wider">
                  <th className="py-2.5 px-3">{t("admin.storage.colEntity")}</th>
                  <th className="py-2.5 px-3">{t("admin.storage.colKind")}</th>
                  <th className="py-2.5 px-3">{t("admin.assets.colRole")}</th>
                  <th className="py-2.5 px-3">{t("admin.storage.colCreatedBy")}</th>
                  <th className="py-2.5 px-3">{t("admin.storage.colCreatedAt")}</th>
                  <th className="py-2.5 px-3 text-right">{t("admin.assets.colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {data.bindings.map((binding) => (
                  <tr key={binding.id} className="hover:bg-surfaceSubtle transition-colors duration-fast ease-soft">
                    <td className="py-2.5 px-3 font-mono text-[11px] break-all">{binding.target_entity_id}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{binding.target_kind}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{binding.binding_role}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px] break-all">{binding.created_by}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                      {formatTime(binding.created_at, locale)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onRequestUnbind(binding)}
                        disabled={busyId !== null}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-medium transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
                      >
                        {busyId === binding.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        <span>{t("admin.storage.unbind")}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 内容预览与地址。
 *
 * 内容接口按请求鉴权后原样转发本体，所以 localStorage 里的令牌不会随 `<img src>` 带上：
 * 预览必须先 fetch（带 storageAuthHeaders）再 `URL.createObjectURL`。
 * 那条相对地址始终展示，供复制/新标签打开（Cookie 登录态下可直接打开）。
 */
function AssetPreview({ asset }: { asset: StorageAsset }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const objectUrl = useRef<string | null>(null);

  const release = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    setUrl(null);
    setState("idle");
  }, []);

  // 换资产时清空上一份预览；卸载时只释放 URL——未释放的 Blob URL 会把整份文件留在内存里。
  useEffect(() => {
    setUrl(null);
    setError(null);
    setState("idle");
    return () => {
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
  }, [asset.id]);

  const load = async () => {
    setState("loading");
    setError(null);
    try {
      const blob = await fetchStorageAssetBlob(asset.id);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const next = URL.createObjectURL(blob);
      objectUrl.current = next;
      setUrl(next);
      setState("ready");
    } catch (err) {
      setError(describeStorageError(err, { notFound: { key: "admin.storage.contentNotFound" } }));
      setState("error");
    }
  };

  const contentUrl = storageAssetContentUrl(asset.id);
  const complete = asset.status === "complete";
  const kind = asset.mime_type.startsWith("image/")
    ? "image"
    : asset.mime_type.startsWith("video/")
      ? "video"
      : asset.mime_type.startsWith("audio/")
        ? "audio"
        : "other";

  const copyUrl = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(contentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非安全上下文没有 clipboard API：如实提示手动复制，不假装已复制。
      setCopyFailed(true);
    }
  };

  const save = () => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = asset.file_name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="p-4 rounded-xl border border-line bg-surface space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-text-strong flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />
          <span>{t("admin.storage.previewTitle")}</span>
        </h4>
        <p className="text-[11px] text-text-muted leading-relaxed mt-1">{t("admin.storage.previewDesc")}</p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <code className="flex-1 px-2.5 py-1.5 rounded-lg bg-surfaceSubtle border border-line text-[11px] font-mono text-text-body break-all">
          {contentUrl}
        </code>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={copyUrl}
            className="px-2.5 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
          >
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <button
            type="button"
            onClick={() => window.open(contentUrl, "_blank", "noopener,noreferrer")}
            className="px-2.5 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
          >
            {t("admin.storage.openContentUrl")}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-text-faint leading-relaxed">{t("admin.storage.contentUrlHint")}</p>
      {copyFailed ? <p className="text-[11px] text-amber-400 leading-relaxed">{t("admin.storage.copyFailed")}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={load}
          disabled={!complete || state === "loading"}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/90 hover:bg-primary text-white text-[11px] font-semibold transition-colors duration-fast ease-soft disabled:opacity-50 cursor-pointer"
        >
          {state === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{state === "loading" ? t("admin.storage.previewLoading") : t("admin.storage.previewLoad")}</span>
        </button>
        {url ? (
          <>
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("admin.storage.previewDownload")}</span>
            </button>
            <button
              type="button"
              onClick={release}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceSubtle hover:bg-surfaceHover border border-line text-text-body text-[11px] transition-colors duration-fast ease-soft cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t("admin.storage.previewClose")}</span>
            </button>
          </>
        ) : null}
      </div>

      {!complete ? <p className="text-[11px] text-amber-400 leading-relaxed">{t("admin.storage.previewPending")}</p> : null}
      {state === "error" && error ? <ErrorNotice message={text(t, error)} /> : null}

      {url ? (
        kind === "image" ? (
          <img
            src={url}
            alt={asset.file_name}
            className="max-h-[420px] w-auto max-w-full rounded-lg border border-line bg-black/20 object-contain"
          />
        ) : kind === "video" ? (
          <video src={url} controls className="w-full max-h-[420px] rounded-lg border border-line bg-black/40" />
        ) : kind === "audio" ? (
          <audio src={url} controls className="w-full" />
        ) : (
          <p className="text-[11px] text-text-muted leading-relaxed">{t("admin.storage.previewUnsupported")}</p>
        )
      ) : null}
    </div>
  );
}
