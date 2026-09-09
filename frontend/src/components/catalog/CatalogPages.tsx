"use client";
import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, Relation, Source, kinds, local, title } from "./api";
import { pickRecordEntry } from "@/lib/titles";
import { useTitleDisplayOrder } from "@/hooks/useTitleDisplayOrder";
import { useCatalog } from "./CatalogProvider";
import { EntityEditor } from "./EntityEditor";
import {
  EntityLink,
  EntityPicker,
  Evidence,
  FieldInput,
  FieldValue,
  ErrorMessage,
} from "./Fields";
import { OptionalPanels } from "./OptionalPanels";
async function allEntities(query: string) {
  const items: Entity[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await api<{ items: Entity[] }>(
      `/catalog/entities?${query}&offset=${offset}&limit=100`,
    );
    items.push(...r.items);
    if (r.items.length < 100) return items;
  }
}
export function Browse() {
  const { t, locale } = useI18n();
  const titleOrder = useTitleDisplayOrder();
  const { definition, user } = useCatalog();
  const [items, setItems] = useState<Entity[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<{ items: Entity[] }>(
        `/catalog/entities?${new URLSearchParams({ q, kind, type, status, field, value, offset: String(offset), limit: "30" })}`,
      )
        .then((r) => {
          if (active) {
            setItems(r.items);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, kind, type, status, field, value, offset]);
  return (
    <>
      <div className="cv-heading">
        <div>
          <span className="cv-eyebrow">{t("catalog.tagline")}</span>
          <h1>{t("catalog.catalog")}</h1>
          <p className="cv-muted">{t("catalog.intro")}</p>
        </div>
        <Link className="cv-primary" href="/new">
          {t("catalog.create")}
        </Link>
      </div>
      <div className="cv-filters">
        <input
          aria-label={t("catalog.search")}
          placeholder={t("catalog.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label={t("catalog.kindLabel")}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalog.allKinds")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`catalog.kind.${k}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("catalog.types")}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalog.allTypes")}</option>
          {Object.entries(definition?.document.types || {}).map(([k, v]) => (
            <option value={k} key={k}>
              {local(v.names, locale, "", k)}
            </option>
          ))}
        </select>
        {user && (
          <select
            aria-label={t("catalog.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t("catalog.allStates")}</option>
            {["draft", "pending_review", "published"].map((s) => (
              <option value={s} key={s}>
                {t(`catalog.state.${s}`)}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t("catalog.filterField")}
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalog.filterField")}</option>
          {Object.entries(definition?.document.fields || {})
            .filter(([, v]) => v.searchable)
            .map(([k, v]) => (
              <option key={k} value={k}>
                {local(v.names, locale, "", k)}
              </option>
            ))}
        </select>
        {field && (
          <input
            aria-label={t("catalog.filterValue")}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOffset(0);
            }}
          />
        )}
      </div>
      <ErrorMessage error={error} />
      {selected.length > 1 && (
        <Link
          className="cv-primary"
          href={`/compare?ids=${selected.join(",")}`}
        >
          {t("catalog.compare")}
        </Link>
      )}
      <div className="cv-cards">
        {items.map((e) => (
          <article key={e.id} className="cv-card">
            {e.pictures?.[0] && (
              <img src={e.pictures[0].url} alt={title(e, locale, titleOrder)} />
            )}
            <div className="cv-card-body">
              <span className="cv-eyebrow">
                {t(`catalog.kind.${e.kind}`)}
              </span>
              <h2>
                <Link href={`/catalog/${e.id}`}>{title(e, locale, titleOrder)}</Link>
              </h2>
              <div className="cv-tags">
                {(e.types || []).map((k) => (
                  <span key={k}>
                    {local(definition?.document.types[k]?.names, locale, "", k)}
                  </span>
                ))}
              </div>
              <small>{t(`catalog.state.${e.status}`)}</small>
              <dl>
                {Array.from(
                  new Set(
                    (e.types || []).flatMap(
                      (k) =>
                        definition?.document.templates[
                          definition.document.types[k]?.template
                        ]?.columns || [],
                    ),
                  ),
                )
                  .filter((k) => e.attributes?.[k] !== undefined)
                  .map((k) => (
                    <div key={k}>
                      <dt>
                        {local(
                          definition?.document.fields[k]?.names,
                          locale,
                          "",
                          k,
                        )}
                      </dt>
                      <dd>
                        <FieldValue
                          field={definition?.document.fields[k]}
                          value={e.attributes[k]}
                        />
                      </dd>
                    </div>
                  ))}
              </dl>
              {e.kind === "release" && (
                <label className="cv-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(e.id!)}
                    onChange={(ev) =>
                      setSelected(
                        ev.target.checked
                          ? [...selected, e.id!].slice(-6)
                          : selected.filter((id) => id !== e.id),
                      )
                    }
                  />
                  {t("catalog.compare")}
                </label>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && !error && (
        <p className="cv-empty">{t("catalog.empty")}</p>
      )}
      <div className="cv-row">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          {t("catalog.previous")}
        </button>
        <button
          disabled={items.length < 30}
          onClick={() => setOffset(offset + 30)}
        >
          {t("catalog.next")}
        </button>
      </div>
    </>
  );
}
export function Account() {
  const { t, locale } = useI18n();
  const { user, setup, refresh } = useCatalog();
  const router = useRouter();

  // Login / setup state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Active tab for logged-in user: "profile" | "oauth" | "admin"
  const [activeTab, setActiveTab] = useState<"security" | "oauth" | "users">("security");

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

  // OAuth clients list
  const [oauthClients, setOauthClients] = useState<Array<{ client_id: string; name: string; redirect_uris: string[]; trusted: boolean }>>([]);

  // Load admin users list
  const loadUsers = () => {
    if (user?.role === "admin") {
      api<{ items: Array<{ id: string; username: string; role: string }> }>("/admin/users")
        .then((r) => setUsersList(r.items || []))
        .catch(() => {});
    }
  };

  // Load oauth clients
  const loadOAuth = () => {
    api<{ clients: Array<{ client_id: string; name: string; redirect_uris: string[]; trusted: boolean }> }>("/oauth/clients")
      .then((r) => setOauthClients(r.clients || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (user) {
      loadOAuth();
      if (user.role === "admin") {
        loadUsers();
      }
    }
  }, [user]);

  return (
    <div className="cv-narrow" style={{ maxWidth: 860 }}>
      <h1>{t(setup ? "catalog.setup" : "catalog.account")}</h1>

      {user ? (
        <>
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
            <button
              type="button"
              onClick={() => { setActiveTab("oauth"); setError(""); setSuccess(""); }}
              style={{
                background: activeTab === "oauth" ? "#1e293b" : "transparent",
                borderBottom: activeTab === "oauth" ? "2px solid #38bdf8" : "none",
                borderRadius: "6px 6px 0 0",
                fontWeight: activeTab === "oauth" ? 600 : 400,
                padding: "8px 16px",
              }}
            >
              {t("account.oauthApps")}
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
              ✓ {success}
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

          {/* TAB 2: OAuth 2.0 Clients */}
          {activeTab === "oauth" && (
            <section className="cv-group">
              <h2>{t("account.authorizedClients")}</h2>
              <p className="cv-muted" style={{ marginBottom: 16 }}>
                {t("account.clientsDesc")}
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {oauthClients.map((c) => (
                  <div
                    key={c.client_id}
                    style={{
                      padding: 14,
                      background: "#131b26",
                      border: "1px solid #293749",
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 650, fontSize: 15, color: "#93c5fd" }}>{c.name}</span>
                      {c.trusted && (
                        <span className="cv-badge" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)" }}>
                          {t("account.trustedApp")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>
                      <code>client_id: {c.client_id}</code>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {t("account.redirectUris")}: {c.redirect_uris.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TAB 3: Admin Users Management */}
          {activeTab === "users" && user.role === "admin" && (
            <>
              {/* Reset Password Modal / Form */}
              {resetTargetUser && (
                <div style={{ padding: 14, background: "#221919", border: "1px solid #7f1d1d", borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, color: "#fca5a5" }}>
                      {t("account.resetPwFor", { username: resetTargetUser.username })}
                    </span>
                    <button type="button" onClick={() => { setResetTargetUser(null); setResetNewPassword(""); }} style={{ minHeight: "auto", padding: "2px 8px" }}>
                      ✕
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
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (setup) await api("/setup", "POST", { username, password });
              await api("/auth/login", "POST", { username, password });
              await refresh();
              router.push("/catalog");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Credentials
            username={username}
            password={password}
            setUsername={setUsername}
            setPassword={setPassword}
          />
          <button className="cv-primary" disabled={busy}>
            {t(setup ? "catalog.setup" : "catalog.login")}
          </button>
        </form>
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
export function Detail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const titleOrder = useTitleDisplayOrder();
  const { definition, user } = useCatalog();
  const [e, setE] = useState<Entity>();
  const [children, setChildren] = useState<Entity[]>([]);
  const [rels, setRels] = useState<Relation[]>([]);
  const [occurrences, setOccurrences] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [relation, setRelation] = useState<Relation>();
  const [note, setNote] = useState("");
  const [sources, setSources] = useState<Source[]>([
    { kind: "self", citation: "" },
  ]);
  const [mergeTarget, setMergeTarget] = useState("");
  const load = async () => {
    try {
      const entity = await api<Entity>(`/catalog/entities/${id}/resolve`);
      setE(entity);
      const eid = entity.id;
      const query =
        entity.kind === "work"
          ? `work_id=${eid}`
          : entity.kind === "content_unit"
            ? `content_unit_id=${eid}`
            : entity.kind === "release"
              ? `release_id=${eid}`
              : entity.kind === "medium"
                ? `medium_id=${eid}`
                : "";
      const values = await Promise.all([
        query ? allEntities(query) : Promise.resolve([]),
        api(`/catalog/entities/${eid}/relations`),
        api(`/catalog/entities/${eid}/occurrences`),
      ]);
      const children = values[0] as Entity[];
      if (entity.kind === "release") {
        const tracks = await Promise.all(
          children
            .filter((x) => x.kind === "medium")
            .map((m) => allEntities(`medium_id=${m.id}`)),
        );
        children.push(...tracks.flat());
      }
      setChildren(children);
      setRels(values[1].items);
      setOccurrences(values[2].items);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [id, user?.id]);
  if (error && !e) return <ErrorMessage error={error} />;
  if (!e || !definition) return <p>{t("catalog.loading")}</p>;
  const d = definition.document;
  if (editing)
    return (
      <EntityEditor
        initial={e}
        onSaved={(x) => {
          setE(x);
          setEditing(false);
          void load();
        }}
      />
    );
  const selectedTemplates = Array.from(
    new Set((e.types || []).map((k) => d.types[k]?.template).filter(Boolean)),
  )
    .map((k) => d.templates[k])
    .filter(Boolean);
  const ordered = Array.from(
    new Set(
      selectedTemplates
        .flatMap((x) => x.sections || [])
        .flatMap((s) => s.fields),
    ),
  );
  const attributeKeys = [
    ...ordered.filter((k) => e.attributes?.[k] !== undefined),
    ...Object.keys(e.attributes || {}).filter((k) => !ordered.includes(k)),
  ];
  const displayedFields = new Set<string>();
  const sections = selectedTemplates
    .flatMap((x) => x.sections || [])
    .map((section) => ({
      ...section,
      fields: section.fields.filter((k) => {
        if (displayedFields.has(k) || e.attributes?.[k] === undefined)
          return false;
        displayedFields.add(k);
        return true;
      }),
    }))
    .filter((s) => s.fields.length);
  const remaining = attributeKeys.filter((k) => !displayedFields.has(k));
  if (remaining.length)
    sections.push({
      names: { [locale]: t("catalog.attributes") },
      fields: remaining,
    });
  const flatDirectory = selectedTemplates.some((x) => x.directory === "list");
  const rt = relation && d.relations[relation.type];
  const tree = (parent: string, depth = 0): React.ReactNode =>
    children
      .filter(
        (x) =>
          (x.parent_id ||
            (e.kind === "release" ? x.medium_id : undefined) ||
            x.content_unit_id ||
            "") === parent,
      )
      .map((x) => (
        <React.Fragment key={x.id}>
          <div
            className="cv-directory-row"
            style={{ paddingLeft: 16 + (flatDirectory ? 0 : depth * 20) }}
          >
            <span>{x.number || x.position || "—"}</span>
            <Link href={`/catalog/${x.id}`}>{title(x, locale, titleOrder)}</Link>
            <small>{t(`catalog.kind.${x.kind}`)}</small>
            {x.contents?.map((c, i) => (
              <EntityLink key={i} id={c.expression_id} />
            ))}
          </div>
          {tree(x.id!, depth + 1)}
        </React.Fragment>
      ));
  return (
    <>
      <div className="cv-heading">
        <div>
          <span className="cv-eyebrow">{t(`catalog.kind.${e.kind}`)}</span>
          <h1>{title(e, locale, titleOrder)}</h1>
          <p className="cv-muted">
            {e.title !== title(e, locale, titleOrder) && e.title} ·{" "}
            {t(`catalog.state.${e.status}`)}
          </p>
        </div>
        {user &&
          (user.role === "admin" ||
            (e.created_by === user.id && e.status !== "published")) && (
            <button onClick={() => setEditing(true)}>
              {t("catalog.edit")}
            </button>
          )}
      </div>
      <ErrorMessage error={error} />
      <div className="cv-detail">
        <aside>
          {e.pictures?.map((p, i) => (
            <figure key={i}>
              <img
                src={p.url}
                alt={local(p.caption, locale, "", title(e, locale, titleOrder))}
              />
              <figcaption>
                {local(p.caption, locale)} {p.source?.citation}
              </figcaption>
            </figure>
          ))}
          <div className="cv-tags">
            {e.types?.map((k) => (
              <span key={k}>{local(d.types[k]?.names, locale, "", k)}</span>
            ))}
          </div>
          {sections.map((section, index) => (
            <div key={index}>
              <h3>{local(section.names, locale)}</h3>
              <dl>
                {section.fields.map((k) => (
                  <div key={k}>
                    <dt>{local(d.fields[k]?.names, locale, "", k)}</dt>
                    <dd>
                      <FieldValue field={d.fields[k]} value={e.attributes[k]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {Object.entries(e.external_ids || {}).map(([k, v]) => (
            <p key={k}>
              {k}: {v}
            </p>
          ))}
          {[
            e.work_id,
            e.content_unit_id,
            e.release_id,
            e.medium_id,
            e.parent_id,
          ]
            .filter(Boolean)
            .map((x) => (
              <p key={x}>
                <EntityLink id={x!} />
              </p>
            ))}
        </aside>
        <div>
          <section>
            <h2>{t("catalog.overview")}</h2>
            <p className="cv-summary">
              {pickRecordEntry(locale, e.translations, t("catalog.noSummary"), t("catalog.noSummary"), { order: titleOrder, originalLanguage: e.original_language }).body || t("catalog.noSummary")}
            </p>
            {Object.entries(e.translations || {}).map(([loc, tr]) => (
              <p className="cv-muted" key={loc}>
                {loc} · {tr.title} {(tr.aliases || []).join(" / ")}
              </p>
            ))}
          </section>
          {!!e.subjects?.length && (
            <section>
              <h2>{t("catalog.subjects")}</h2>
              {e.subjects.map((s, i) => (
                <p key={i}>
                  <EntityLink id={s.work_id} /> ·{" "}
                  {local(
                    d.vocabularies.release_role?.terms[s.role]?.names,
                    locale,
                    "",
                    s.role,
                  )}
                </p>
              ))}
            </section>
          )}
          {!!e.contents?.length && (
            <section>
              <h2>{t("catalog.contents")}</h2>
              {e.contents.map((c, i) => (
                <div className="cv-directory-row" key={i}>
                  <span>{c.position}</span>
                  <EntityLink id={c.expression_id} />
                  <span>
                    {Object.entries(c.locator || {})
                      .map(([k, v]) => `${t(`catalog.locator.${k}`)}: ${v}`)
                      .join(" · ")}
                  </span>
                </div>
              ))}
            </section>
          )}
          {!!children.length && (
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{t("catalog.directory")}</h2>
                {children.filter((x) => x.kind === "release").length >= 2 && (
                  <Link
                    href={`/compare?ids=${children.filter((x) => x.kind === "release").map((r) => r.id).slice(0, 6).join(",")}`}
                    className="cv-badge"
                    style={{ background: "rgba(145, 215, 204, 0.15)", color: "#91d7cc", borderColor: "rgba(145, 215, 204, 0.3)", padding: "4px 8px" }}
                  >
                    {t("account.compareReleases")}
                  </Link>
                )}
              </div>
              {tree("")}
              {children
                .filter(
                  (x) =>
                    x.parent_id && !children.some((p) => p.id === x.parent_id),
                )
                .map((x) => (
                  <p key={x.id}>
                    <Link href={`/catalog/${x.id}`}>{title(x, locale, titleOrder)}</Link>
                  </p>
                ))}
            </section>
          )}
          <section>
            <div className="cv-heading">
              <h2>{t("catalog.relations")}</h2>
              {user && (
                <button
                  onClick={() =>
                    setRelation({
                      source_id: e.id!,
                      target_id: "",
                      type: "",
                      position: 0,
                      version: 0,
                      attributes: {},
                    })
                  }
                >
                  {t("catalog.add")}
                </button>
              )}
            </div>
            {Array.from(
              new Set(rels.map((r) => d.relations[r.type]?.group || "")),
            ).map((group) => (
              <div key={group}>
                <h3>
                  {local(
                    d.relations[
                      rels.find(
                        (r) => (d.relations[r.type]?.group || "") === group,
                      )!.type
                    ]?.group_names,
                    locale,
                    "",
                    group,
                  )}
                </h3>
                {rels
                  .filter((r) => (d.relations[r.type]?.group || "") === group)
                  .sort((a, b) => a.position - b.position)
                  .map((r) => (
                    <div className="cv-relation" key={r.id}>
                      <strong>
                        {local(
                          r.source_id === e.id
                            ? d.relations[r.type]?.names
                            : d.relations[r.type]?.reverse_names,
                          locale,
                          "",
                          r.type,
                        )}
                      </strong>
                      <EntityLink
                        id={r.source_id === e.id ? r.target_id : r.source_id}
                      />
                      <dl>
                        {Object.entries(r.attributes || {}).map(([k, v]) => (
                          <div key={k}>
                            <dt>{local(d.fields[k]?.names, locale, "", k)}</dt>
                            <dd>
                              <FieldValue field={d.fields[k]} value={v} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {user && (
                        <button onClick={() => setRelation(r)}>
                          {t("catalog.edit")}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            ))}
            {relation && (
              <form
                className="cv-group"
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  try {
                    await api(
                      relation.id
                        ? `/catalog/relations/${relation.id}`
                        : "/catalog/relations",
                      relation.id ? "PUT" : "POST",
                      {
                        relation,
                        expected_version: relation.version,
                        edit_note: note,
                        sources,
                      },
                    );
                    setRelation(undefined);
                    await load();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <label>
                  {t("catalog.relationType")}
                  <select
                    required
                    value={relation.type}
                    disabled={!!relation.id}
                    onChange={(x) =>
                      setRelation({
                        ...relation,
                        type: x.target.value,
                        attributes: {},
                      })
                    }
                  >
                    <option value="">{t("catalog.select")}</option>
                    {Object.entries(d.relations)
                      .filter(
                        ([, v]) => v.enabled && v.source_kinds.includes(e.kind),
                      )
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {local(v.names, locale, "", k)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t("catalog.target")}
                  <EntityPicker
                    kinds={rt?.target_kinds}
                    value={relation.target_id}
                    onChange={(id) =>
                      setRelation({ ...relation, target_id: id })
                    }
                  />
                </label>
                <label>
                  {t("catalog.position")}
                  <input
                    type="number"
                    value={relation.position}
                    min="0"
                    onChange={(x) =>
                      setRelation({
                        ...relation,
                        position: Number(x.target.value),
                      })
                    }
                  />
                </label>
                {rt?.fields.map((k) => (
                  <label key={k}>
                    {local(d.fields[k]?.names, locale, "", k)}
                    <FieldInput
                      field={d.fields[k]}
                      value={relation.attributes[k]}
                      onChange={(v) =>
                        setRelation({
                          ...relation,
                          attributes: { ...relation.attributes, [k]: v },
                        })
                      }
                    />
                  </label>
                ))}
                <Evidence
                  note={note}
                  setNote={setNote}
                  sources={sources}
                  setSources={setSources}
                />
                <button>{t("catalog.save")}</button>
                <button type="button" onClick={() => setRelation(undefined)}>
                  {t("catalog.cancel")}
                </button>
                {relation.id && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api(
                          `/catalog/relations/${relation.id}`,
                          "DELETE",
                          {
                            expected_version: relation.version,
                            edit_note: note,
                            sources,
                          },
                        );
                        setRelation(undefined);
                        await load();
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    {t("catalog.remove")}
                  </button>
                )}
              </form>
            )}
          </section>
          {!!occurrences.length && (
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{t("catalog.occurrences")}</h2>
                {Array.from(new Set(occurrences.map((o) => o.release?.id).filter(Boolean))).length >= 2 && (
                  <Link
                    href={`/compare?ids=${Array.from(new Set(occurrences.map((o) => o.release?.id).filter(Boolean))).slice(0, 6).join(",")}`}
                    className="cv-badge"
                    style={{ background: "rgba(145, 215, 204, 0.15)", color: "#91d7cc", borderColor: "rgba(145, 215, 204, 0.3)", padding: "4px 8px" }}
                  >
                    {t("account.compareIncluded")}
                  </Link>
                )}
              </div>
              {occurrences.map((o, i) => (
                <div className="cv-directory-row" key={i}>
                  <Link href={`/catalog/${o.release.id}`}>
                    {title(o.release, locale, titleOrder)}
                  </Link>
                  <Link href={`/catalog/${o.medium.id}`}>
                    {title(o.medium, locale, titleOrder)}
                  </Link>
                  <Link href={`/catalog/${o.track.id}`}>
                    {o.track.number || o.track.position} ·{" "}
                    {title(o.track, locale, titleOrder)}
                  </Link>
                </div>
              ))}
            </section>
          )}
          <section>
            <button
              onClick={async () => {
                try {
                  setHistory(
                    (await api(`/catalog/entities/${e.id}/revisions`)).items,
                  );
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {t("catalog.history")}
            </button>
            {history.map((r, i) => (
              <details key={i}>
                <summary>
                  {r.version} · {r.edit_note} · {r.created_at}
                </summary>
                <p>{r.sources.map((s: Source) => s.citation).join(" / ")}</p>
                <dl>
                  {Object.entries(r.snapshot.attributes || {}).map(([k, v]) => (
                    <div key={k}>
                      <dt>{local(d.fields[k]?.names, locale, "", k)}</dt>
                      <dd>
                        <FieldValue field={d.fields[k]} value={v} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </section>
          {user?.role === "admin" && (
            <details>
              <summary>{t("catalog.lifecycle")}</summary>
              <Evidence
                note={note}
                setNote={setNote}
                sources={sources}
                setSources={setSources}
              />
              <label>
                {t("catalog.mergeTarget")}
                <EntityPicker
                  kinds={[e.kind]}
                  value={mergeTarget}
                  onChange={setMergeTarget}
                />
              </label>
              <button
                onClick={async () => {
                  try {
                    const result = await api<Entity>(
                      `/catalog/entities/${e.id}/lifecycle`,
                      "POST",
                      {
                        expected_version: e.version,
                        target_id: mergeTarget,
                        edit_note: note,
                        sources,
                      },
                    );
                    setE(result);
                    if (result.redirect_id)
                      location.assign(`/catalog/${result.redirect_id}`);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                {t(mergeTarget ? "catalog.merge" : "catalog.retire")}
              </button>
            </details>
          )}
          <OptionalPanels entity={e} />
        </div>
      </div>
    </>
  );
}
export { Compare } from "./CompareView";
