"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "./api";
import { useCatalog } from "./CatalogProvider";
import { ErrorMessage } from "./Fields";

// 登录入口唯一：/login（app/login/page.tsx，含注册页签；实例未初始化时由 AuthGate 引导 /setup）。
// 本页未登录时由 components/AuthGate.tsx 跳 /login?redirect=/account，不要在下面再渲染
// 用户名/密码表单——两套登录界面并存时字段提示与文案还不一致，用户会以为是两个站。
// 本页也不展示"已授权应用"：账号服务已整条删除 GET /oauth/clients（登录即可枚举全量客户端），
// 自助入口是 /settings 的 OAuthGrantsPanel（GET /auth/oauth-grants 只回本人），不在这里重复一份。
// 用户治理（成员/角色/权限组/邀请/OAuth 客户端）归账号服务自带的独立控制台 /admin/account/：
// 本页不挂成员列表、改角色、重置密码与建号表单；Navbar 入口探活通过后才出现（见 Navbar.tsx）。
export function Account() {
  const { t } = useI18n();
  const { user, refresh } = useCatalog();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Change password state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 未登录不渲染任何表单：AuthGate 已把未登录访问重定向到 /login?redirect=/account。
  if (!user) return null;

  return (
    <div className="cv-narrow" style={{ maxWidth: 860 }}>
      <h1>{t("catalog.account")}</h1>

      {/* User Profile Card */}
      <section className="cv-group" style={{ margin: "16px 0 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 700 }}>{user.username}</span>
              <span
                className="cv-badge"
                style={{
                  background: user.role === "admin" ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
                  color: user.role === "admin" ? "#fb7185" : "#34d399",
                  borderColor: user.role === "admin" ? "rgba(244, 63, 94, 0.3)" : "rgba(16, 185, 129, 0.3)",
                  textTransform: "uppercase",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {user.role === "admin" ? t("account.roleAdmin") : t("account.roleEditor")}
              </span>
            </div>
            <small className="cv-muted" style={{ display: "block", marginTop: 4 }}>
              UUID: {user.id}
            </small>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={async () => {
                await api("/auth/logout", "POST");
                await refresh();
              }}
              style={{ fontSize: 13, padding: "6px 14px" }}
            >
              {t("catalog.logout")}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (confirm(t("account.logoutAllConfirm"))) {
                  await api("/auth/logout-all", "POST");
                  await refresh();
                }
              }}
              style={{
                fontSize: 13,
                padding: "6px 14px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#f87171",
                borderColor: "rgba(239, 68, 68, 0.25)",
              }}
            >
              {t("account.logoutAllDevices")}
            </button>
          </div>
        </div>
      </section>

      {success && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: 6, color: "#34d399", marginBottom: 16 }}>
          <Check className="w-4 h-4 inline-block" strokeWidth={2} /> {success}
        </div>
      )}

      {/* 改密码；授权自助在 /settings、用户治理在 /admin/account/，本页不重复实现 */}
      <section className="cv-group">
        <h2>{t("account.changePassword")}</h2>
        <p className="cv-muted" style={{ marginBottom: 16 }}>
          {t("account.passwordHint")}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setSuccess("");
            if (newPassword !== confirmPassword) {
              setError(t("account.pwMismatch"));
              return;
            }
            if (newPassword.length < 12) {
              setError(t("account.pwTooShort"));
              return;
            }
            try {
              await api("/auth/password", "PUT", { old_password: oldPassword, new_password: newPassword });
              setSuccess(t("account.pwUpdated"));
              setOldPassword("");
              setNewPassword("");
              setConfirmPassword("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            {t("account.currentPassword")}
            <input
              type="password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </label>
          <label>
            {t("account.newPassword")}
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label>
            {t("account.confirmNewPassword")}
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <button className="cv-primary" type="submit" style={{ marginTop: 12 }}>
            {t("account.saveNewPassword")}
          </button>
        </form>
      </section>

      <ErrorMessage error={error} />
    </div>
  );
}

export { Compare } from "./CompareView";
