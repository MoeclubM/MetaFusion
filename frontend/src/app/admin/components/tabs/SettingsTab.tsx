"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchApi } from "@/lib/api";
import { KeyRound, RefreshCw, Save, UserPlus } from "lucide-react";

type SystemSettings = {
  registration_enabled: boolean;
  invite_required: boolean;
};

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-surface border border-surfaceBorder">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="text-[11px] text-gray-400 font-mono mt-0.5">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 ${
          checked ? "bg-emerald-500" : "bg-white/[0.12]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
            checked ? "left-[21px]" : "left-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsTab() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchApi<SystemSettings>("/admin/settings");
      setSettings({
        registration_enabled: r.registration_enabled !== false,
        invite_required: r.invite_required !== false,
      });
    } catch {
      setError(t("admin.settings.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetchApi<SystemSettings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings({
        registration_enabled: r.registration_enabled !== false,
        invite_required: r.invite_required !== false,
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      setError(t("admin.settings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 font-mono py-8 justify-center">
        <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
        {t("admin.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-400" />
          {t("admin.settings.title")}
        </h2>
        <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.settings.subtitle")}</p>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {settings && (
        <>
          <div className="space-y-3">
            <ToggleRow
              icon={<UserPlus className="w-4 h-4 text-emerald-400" />}
              title={t("admin.settings.registration")}
              desc={t("admin.settings.registrationDesc")}
              checked={settings.registration_enabled}
              disabled={saving}
              onChange={(v) =>
                setSettings((s) => (s ? { ...s, registration_enabled: v } : s))
              }
            />
            <ToggleRow
              icon={<KeyRound className="w-4 h-4 text-sky-400" />}
              title={t("admin.settings.inviteRequired")}
              desc={t("admin.settings.inviteRequiredDesc")}
              checked={settings.invite_required}
              disabled={saving}
              onChange={(v) =>
                setSettings((s) => (s ? { ...s, invite_required: v } : s))
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 h-9 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black text-xs font-semibold transition-colors"
            >
              {saving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {t("admin.settings.save")}
            </button>
            {savedAt && (
              <span className="text-[11px] text-emerald-400 font-mono">
                {t("admin.settings.savedAt", { time: savedAt })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
