"use client";
import { useI18n } from "@/i18n/I18nProvider";
import { getAuthPasswordUrl } from "@/lib/services";
import { api } from "./api";
import { useAuth } from "@/lib/authContext";

// 登录入口唯一：/login（app/login/page.tsx，含注册页签；实例未初始化时由 AuthGate 引导 /setup）。
// 本页未登录时由 components/AuthGate.tsx 跳 /login?redirect=/account，不要在这里再渲染
// 用户名/密码表单——两套登录界面并存时字段提示与文案还不一致，用户会以为是两个站。
// 本页也不展示"已授权应用"：账号服务已整条删除 GET /oauth/clients（登录即可枚举全量客户端），
// 自助入口是 /settings 的 OAuthGrantsPanel（GET /auth/oauth-grants 只回本人），不在这里重复一份。
// 改密码同理：唯一实现在 /settings?tab=password（错误码四语映射、minLength、改密后重新登录引导都在那边），
// 本页只留一个入口链接；账号治理（成员/角色/权限组/邀请/OAuth 客户端）归独立控制台 /admin/account/。
export function Account() {
  const { t } = useI18n();
  // 会话只有 useAuth 一份：退出登录后由它的 refreshProfile 读回 /auth/me（401 即清会话）。
  const { user, refreshProfile } = useAuth();

  // 未登录不渲染任何内容：AuthGate 已把未登录访问重定向到 /login?redirect=/account。
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
                await refreshProfile();
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
                  await refreshProfile();
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

      {/* 账户与安全设置：改密码、授权自助、资料与外观都在 /settings，本页不再自带表单 */}
      <section className="cv-group">
        <h2>{t("account.settingsTitle")}</h2>
        <p className="cv-muted" style={{ marginBottom: 12 }}>
          {t("account.settingsDesc")}
        </p>
        <a
          className="cv-primary"
          href={getAuthPasswordUrl()}
          style={{ display: "inline-block", padding: "8px 16px", textDecoration: "none" }}
        >
          {t("account.changePassword")}
        </a>
      </section>
    </div>
  );
}

export { Compare } from "./CompareView";
