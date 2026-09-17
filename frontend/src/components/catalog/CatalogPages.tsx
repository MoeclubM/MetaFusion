"use client";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "./api";
import { useCatalog } from "./CatalogProvider";
import { ErrorMessage } from "./Fields";

// 登录入口唯一：/login（app/login/page.tsx，含注册页签；实例未初始化时由 AuthGate 引导 /setup）。
// 本页未登录时由 components/AuthGate.tsx 跳 /login?redirect=/account，不要在下面再渲染
// 用户名/密码表单——两套登录界面并存时字段提示与文案还不一致，用户会以为是两个站。
// 本页也不展示"已授权应用"：账号服务已整条删除 GET /oauth/clients（登录即可枚举全量客户端），
// 自助入口是 /settings 的 OAuthGrantsPanel（GET /auth/oauth-grants 只回本人），不在这里重复一份。
export function Account() {
  const { t } = useI18n();
  const { user, refresh } = useCatalog();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 页签：安全与密码（本人）、用户与权限管理（仅管理员）。
  const [activeTab, setActiveTab] = useState<"security" | "users">("security");

  // Change password state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Admin users list state
  const [usersList, setUsersList] = useState<Array<{ id: string; username: string; role: string }>>([]);
  const [newEditorUsername, setNewEditorUsername] = useState("");
  const [newEditorPassword, setNewEditorPassword] = useState("");
  const [resetTargetUser, setResetTargetUser] = useState<{ id: string; username: string } | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState("");

  // Load admin users list
  const loadUsers = () => {
    if (user?.role === "admin") {
      api<{ items: Array<{ id: string; username: string; role: string }> }>("/admin/users")
        .then((r) => setUsersList(r.items || []))
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      loadUsers();
    }
  }, [user]);

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

      {/* Navigation Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #283444", marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => { setActiveTab("security"); setError(""); setSuccess(""); }}
          style={{
            background: activeTab === "security" ? "#1e293b" : "transparent",
            borderBottom: activeTab === "security" ? "2px solid #38bdf8" : "none",
            borderRadius: "6px 6px 0 0",
            fontWeight: activeTab === "security" ? 600 : 400,
            padding: "8px 16px",
          }}
        >
          {t("account.securityPassword")}
        </button>
        {user.role === "admin" && (
          <button
            type="button"
            onClick={() => { setActiveTab("users"); setError(""); setSuccess(""); loadUsers(); }}
            style={{
              background: activeTab === "users" ? "#1e293b" : "transparent",
              borderBottom: activeTab === "users" ? "2px solid #38bdf8" : "none",
              borderRadius: "6px 6px 0 0",
              fontWeight: activeTab === "users" ? 600 : 400,
              padding: "8px 16px",
            }}
          >
            {t("account.usersTab")}
          </button>
        )}
      </div>

      {success && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: 6, color: "#34d399", marginBottom: 16 }}>
          <Check className="w-4 h-4 inline-block" strokeWidth={2} /> {success}
        </div>
      )}

      {/* TAB 1: Security & Password */}
      {activeTab === "security" && (
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
      )}

      {/* TAB 2: Admin Users Management */}
      {activeTab === "users" && user.role === "admin" && (
        <>
          {/* Reset Password Modal / Form */}
          {resetTargetUser && (
            <div style={{ padding: 14, background: "#221919", border: "1px solid #7f1d1d", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: "#fca5a5" }}>
                  {t("account.resetPwFor", { username: resetTargetUser.username })}
                </span>
                <button type="button" onClick={() => { setResetTargetUser(null); setResetNewPassword(""); }} style={{ minHeight: "auto", padding: "2px 8px" }} aria-label="Close">
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="password"
                  placeholder={t("account.newPwPlaceholder")}
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="cv-primary"
                  disabled={resetNewPassword.length < 12}
                  onClick={async () => {
                    try {
                      await api(`/admin/users/${resetTargetUser.id}/password`, "PUT", { password: resetNewPassword });
                      setSuccess(t("account.pwResetDone", { username: resetTargetUser.username }));
                      setResetTargetUser(null);
                      setResetNewPassword("");
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  {t("account.confirmReset")}
                </button>
              </div>
            </div>
          )}

          {/* Users Table */}
          <section className="cv-group" style={{ marginBottom: 20 }}>
            <h2>{t("account.usersRoles")}</h2>
            <div className="cv-table-scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("account.colUsername")}</th>
                    <th>{t("account.colRole")}</th>
                    <th>{t("account.colUserId")}</th>
                    <th style={{ textAlign: "right" }}>{t("account.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.username}</td>
                      <td>
                        <span
                          className="cv-badge"
                          style={{
                            background: u.role === "admin" ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
                            color: u.role === "admin" ? "#fb7185" : "#34d399",
                            borderColor: u.role === "admin" ? "rgba(244, 63, 94, 0.3)" : "rgba(16, 185, 129, 0.3)",
                          }}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <small className="cv-muted">{u.id}</small>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          {u.role === "editor" ? (
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(t("account.promoteConfirm", { username: u.username }))) {
                                  try {
                                    await api(`/admin/users/${u.id}/role`, "PUT", { role: "admin" });
                                    loadUsers();
                                  } catch (err) {
                                    setError((err as Error).message);
                                  }
                                }
                              }}
                              style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                            >
                              {t("account.makeAdmin")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(t("account.demoteConfirm", { username: u.username }))) {
                                  try {
                                    await api(`/admin/users/${u.id}/role`, "PUT", { role: "editor" });
                                    loadUsers();
                                  } catch (err) {
                                    setError((err as Error).message);
                                  }
                                }
                              }}
                              style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                            >
                              {t("account.setEditor")}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetUser(u);
                              setResetNewPassword("");
                            }}
                            style={{ padding: "4px 8px", minHeight: 28, fontSize: 12 }}
                          >
                            {t("account.resetPassword")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Create Editor Form */}
          <section className="cv-group">
            <h2>{t("catalog.createEditor")}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setSuccess("");
                try {
                  await api("/admin/users", "POST", { username: newEditorUsername, password: newEditorPassword });
                  setSuccess(t("account.editorCreated", { username: newEditorUsername }));
                  setNewEditorUsername("");
                  setNewEditorPassword("");
                  loadUsers();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <Credentials
                username={newEditorUsername}
                password={newEditorPassword}
                setUsername={setNewEditorUsername}
                setPassword={setNewEditorPassword}
              />
              <button className="cv-primary" type="submit" style={{ marginTop: 10 }}>
                {t("catalog.create")}
              </button>
            </form>
          </section>
        </>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
function Credentials({
  username,
  password,
  setUsername,
  setPassword,
}: {
  username: string;
  password: string;
  setUsername: (v: string) => void;
  setPassword: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <label>
        {t("catalog.username")}
        <input
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        {t("catalog.password")}
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="cv-muted">{t("catalog.passwordHint")}</p>
    </>
  );
}
export { Compare } from "./CompareView";
