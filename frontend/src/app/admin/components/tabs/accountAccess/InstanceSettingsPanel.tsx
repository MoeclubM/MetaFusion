"use client";

// 实例设置面板：GET/PUT /api/admin/settings。
//
// 渲染完全由接口返回驱动：拿到什么键就渲染什么键，控件按值的类型选（布尔/整数/文本/字符串列表，
// 其余按键值当 JSON 编辑）。因此后端新增设置项时这里不用改代码；
// admin.account.setting.<key> 只是可选的标签/说明覆盖层，缺了会回退成键名。

import React, { useMemo, useState } from "react";
import { Plus, Save, Sliders, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { describeAdminError, updateAdminSettings, type SettingsMap } from "./api";
import {
  ErrorNotice,
  LoadingBlock,
  RefreshButton,
  SectionHeader,
  StatusMessage,
  settingHint,
  settingLabel,
  type Resource,
} from "./shared";

const EMPTY_SETTINGS: SettingsMap = {};

type ValueKind = "boolean" | "number" | "string" | "stringArray" | "json";

/** 控件种类只看值的实际类型，不看键名。 */
function valueKind(value: unknown): ValueKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return "stringArray";
  return "json";
}

export function InstanceSettingsPanel({
  settings,
  groupCodes,
}: {
  settings: Resource<SettingsMap>;
  groupCodes: string[];
}) {
  const { t, tr } = useI18n();
  // 只保存改动过的键：PUT 是补丁语义，未改动的键不提交，避免覆盖并发修改。
  const [draft, setDraft] = useState<SettingsMap>({});
  const [listInput, setListInput] = useState<Record<string, string>>({});
  const [jsonText, setJsonText] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const data = useMemo(() => settings.data ?? EMPTY_SETTINGS, [settings.data]);
  const keys = useMemo(() => Object.keys(data), [data]);
  const changedCount = Object.keys(draft).length;

  const patch = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const discard = () => {
    setDraft({});
    setListInput({});
    setJsonText({});
    setJsonError({});
  };

  const handleReload = () => {
    discard();
    setMessage(null);
    settings.reload();
  };

  const handleSave = async () => {
    if (changedCount === 0) {
      setMessage({ kind: "err", text: t("admin.account.settingsNoChange") });
      return;
    }
    if (Object.keys(jsonError).length > 0) {
      setMessage({ kind: "err", text: t("admin.account.settingsJsonBlocked") });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateAdminSettings(draft);
      discard();
      setMessage({ kind: "ok", text: t("admin.account.settingsSaved") });
      // 保存后回读，界面显示的永远是服务端的真实值。
      settings.reload();
    } catch (err) {
      setMessage({ kind: "err", text: describeAdminError(err, t, "auth.settings.manage") });
    } finally {
      setSaving(false);
    }
  };

  const addListItem = (key: string) => {
    const raw = (listInput[key] ?? "").trim();
    if (!raw) return;
    const current = (key in draft ? draft[key] : data[key]) as string[];
    if ((current ?? []).includes(raw)) {
      setListInput((prev) => ({ ...prev, [key]: "" }));
      return;
    }
    patch(key, [...(current ?? []), raw]);
    setListInput((prev) => ({ ...prev, [key]: "" }));
  };

  const removeListItem = (key: string, value: string) => {
    const current = (key in draft ? draft[key] : data[key]) as string[];
    patch(key, (current ?? []).filter((item) => item !== value));
  };

  const handleJsonChange = (key: string, text: string) => {
    setJsonText((prev) => ({ ...prev, [key]: text }));
    try {
      const parsed = JSON.parse(text);
      patch(key, parsed);
      setJsonError((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      setJsonError((prev) => ({
        ...prev,
        [key]: t("admin.account.settingsJsonInvalid", {
          message: err instanceof Error ? err.message : String(err),
        }),
      }));
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Sliders className="w-4 h-4 text-emerald-400" />}
        title={t("admin.account.settingsTitle")}
        desc={t("admin.account.settingsDesc")}
        actions={
          <>
            <span className="text-[11px] font-mono text-gray-400">
              {t("admin.account.settingsChanged", { count: changedCount })}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-400 text-black text-xs font-semibold hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast ease-soft cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? t("common.saving") : t("admin.account.settingsSave")}</span>
            </button>
            <RefreshButton onClick={handleReload} loading={settings.loading} />
          </>
        }
      />

      {settings.error ? (
        <ErrorNotice
          message={settings.error}
          onRetry={handleReload}
          permissionHint={t("admin.account.settingsForbiddenHint")}
        />
      ) : null}

      {message ? <StatusMessage kind={message.kind} text={message.text} /> : null}

      {settings.loading && keys.length === 0 ? <LoadingBlock /> : null}

      {!settings.loading && !settings.error && keys.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-white/10 text-center text-xs text-gray-500 font-mono">
          {t("admin.account.settingsNone")}
        </div>
      ) : null}

      <div className="space-y-3">
        {keys.map((key) => {
          const kind = valueKind(data[key]);
          const value = key in draft ? draft[key] : data[key];
          const changed = key in draft;
          const hint = settingHint(key, tr);
          const list = kind === "stringArray" ? ((value as string[]) ?? []) : [];

          return (
            <div
              key={key}
              className={`p-3.5 rounded-xl border space-y-2.5 ${
                changed
                  ? "border-emerald-500/40 bg-emerald-500/[0.04]"
                  : "border-white/[0.06] bg-black/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white">
                    {settingLabel(key, tr)}
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 break-all">{key}</div>
                </div>
                {changed ? (
                  <span className="text-[10px] font-mono text-emerald-300 shrink-0">
                    {t("admin.account.settingChanged")}
                  </span>
                ) : null}
              </div>

              {kind === "boolean" ? (
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => patch(key, e.target.checked)}
                    className="w-4 h-4 rounded border-white/25 bg-white/5 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-gray-300">{String(Boolean(value))}</span>
                </label>
              ) : null}

              {kind === "number" ? (
                <input
                  type="number"
                  value={typeof value === "number" ? value : ""}
                  onChange={(e) => patch(key, Number(e.target.value))}
                  className="w-full sm:w-64 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white focus:border-primary outline-none"
                />
              ) : null}

              {kind === "string" ? (
                <input
                  type="text"
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => patch(key, e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-white focus:border-primary outline-none"
                />
              ) : null}

              {kind === "stringArray" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {list.length === 0 ? (
                      <span className="text-[10px] font-mono text-gray-500">
                        {t("admin.account.settingsArrayEmpty")}
                      </span>
                    ) : (
                      list.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px] font-mono"
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => removeListItem(key, item)}
                            className="hover:text-rose-300 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      list={`${key}-group-codes`}
                      value={listInput[key] ?? ""}
                      onChange={(e) => setListInput((prev) => ({ ...prev, [key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addListItem(key);
                        }
                      }}
                      placeholder={t("admin.account.settingsArrayPlaceholder")}
                      className="flex-1 sm:max-w-xs px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-mono text-white focus:border-primary outline-none"
                    />
                    {groupCodes.length > 0 ? (
                      <datalist id={`${key}-group-codes`}>
                        {groupCodes.map((code) => (
                          <option key={code} value={code} />
                        ))}
                      </datalist>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => addListItem(key)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[11px] text-gray-300 transition-colors duration-fast ease-soft cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{t("admin.account.settingsArrayAdd")}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    {t("admin.account.settingsArrayHint")}
                  </p>
                </div>
              ) : null}

              {kind === "json" ? (
                <div className="space-y-1.5">
                  <textarea
                    rows={3}
                    value={jsonText[key] ?? JSON.stringify(value, null, 2)}
                    onChange={(e) => handleJsonChange(key, e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-white focus:border-primary outline-none resize-y"
                  />
                  <p className="text-[10px] font-mono text-amber-400/80">
                    {jsonError[key] ?? t("admin.account.settingsUnknownType")}
                  </p>
                </div>
              ) : null}

              {hint ? (
                <p className="text-[11px] text-amber-400/80 leading-relaxed">{hint}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
