"use client";
import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, Relation, Source, kinds, local, title } from "./api";
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
          <span className="cv-eyebrow">{t("catalogV2.tagline")}</span>
          <h1>{t("catalogV2.catalog")}</h1>
          <p className="cv-muted">{t("catalogV2.intro")}</p>
        </div>
        <Link className="cv-primary" href="/catalog/new">
          {t("catalogV2.create")}
        </Link>
      </div>
      <div className="cv-filters">
        <input
          aria-label={t("catalogV2.search")}
          placeholder={t("catalogV2.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label={t("catalogV2.kindLabel")}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalogV2.allKinds")}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`catalogV2.kind.${k}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("catalogV2.types")}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalogV2.allTypes")}</option>
          {Object.entries(definition?.document.types || {}).map(([k, v]) => (
            <option value={k} key={k}>
              {local(v.names, locale, "", k)}
            </option>
          ))}
        </select>
        {user && (
          <select
            aria-label={t("catalogV2.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t("catalogV2.allStates")}</option>
            {["draft", "pending_review", "published"].map((s) => (
              <option value={s} key={s}>
                {t(`catalogV2.state.${s}`)}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t("catalogV2.filterField")}
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t("catalogV2.filterField")}</option>
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
            aria-label={t("catalogV2.filterValue")}
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
          href={`/catalog/compare?ids=${selected.join(",")}`}
        >
          {t("catalogV2.compare")}
        </Link>
      )}
      <div className="cv-cards">
        {items.map((e) => (
          <article key={e.id} className="cv-card">
            {e.pictures?.[0] && (
              <img src={e.pictures[0].url} alt={title(e, locale)} />
            )}
            <div className="cv-card-body">
              <span className="cv-eyebrow">
                {t(`catalogV2.kind.${e.kind}`)}
              </span>
              <h2>
                <Link href={`/catalog/${e.id}`}>{title(e, locale)}</Link>
              </h2>
              <div className="cv-tags">
                {(e.types || []).map((k) => (
                  <span key={k}>
                    {local(definition?.document.types[k]?.names, locale, "", k)}
                  </span>
                ))}
              </div>
              <small>{t(`catalogV2.state.${e.status}`)}</small>
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
                  {t("catalogV2.compare")}
                </label>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && !error && (
        <p className="cv-empty">{t("catalogV2.empty")}</p>
      )}
      <div className="cv-row">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          {t("catalogV2.previous")}
        </button>
        <button
          disabled={items.length < 30}
          onClick={() => setOffset(offset + 30)}
        >
          {t("catalogV2.next")}
        </button>
      </div>
    </>
  );
}
export function Account() {
  const { t } = useI18n();
  const { user, setup, refresh } = useCatalog();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="cv-narrow">
      <h1>{t(setup ? "catalogV2.setup" : "catalogV2.account")}</h1>
      {user ? (
        <>
          <p>{user.username}</p>
          <button
            onClick={async () => {
              await api("/auth/logout", "POST");
              await refresh();
            }}
          >
            {t("catalogV2.logout")}
          </button>
          {user.role === "admin" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/admin/users", "POST", { username, password });
                  setUsername("");
                  setPassword("");
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <h2>{t("catalogV2.createEditor")}</h2>
              <Credentials
                username={username}
                password={password}
                setUsername={setUsername}
                setPassword={setPassword}
              />
              <button>{t("catalogV2.create")}</button>
            </form>
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
            {t(setup ? "catalogV2.setup" : "catalogV2.login")}
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
        {t("catalogV2.username")}
        <input
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        {t("catalogV2.password")}
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="cv-muted">{t("catalogV2.passwordHint")}</p>
    </>
  );
}
export function Detail({ id }: { id: string }) {
  const { t, locale } = useI18n();
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
  if (!e || !definition) return <p>{t("catalogV2.loading")}</p>;
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
      names: { [locale]: t("catalogV2.attributes") },
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
            <Link href={`/catalog/${x.id}`}>{title(x, locale)}</Link>
            <small>{t(`catalogV2.kind.${x.kind}`)}</small>
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
          <span className="cv-eyebrow">{t(`catalogV2.kind.${e.kind}`)}</span>
          <h1>{title(e, locale)}</h1>
          <p className="cv-muted">
            {e.title !== title(e, locale) && e.title} ·{" "}
            {t(`catalogV2.state.${e.status}`)}
          </p>
        </div>
        {user &&
          (user.role === "admin" ||
            (e.created_by === user.id && e.status !== "published")) && (
            <button onClick={() => setEditing(true)}>
              {t("catalogV2.edit")}
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
                alt={local(p.caption, locale, "", title(e, locale))}
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
            <h2>{t("catalogV2.overview")}</h2>
            <p className="cv-summary">
              {e.translations?.[locale]?.summary ||
                e.translations?.["en-US"]?.summary ||
                e.translations?.[e.original_language]?.summary ||
                t("catalogV2.noSummary")}
            </p>
            {Object.entries(e.translations || {}).map(([loc, tr]) => (
              <p className="cv-muted" key={loc}>
                {loc} · {tr.title} {(tr.aliases || []).join(" / ")}
              </p>
            ))}
          </section>
          {!!e.subjects?.length && (
            <section>
              <h2>{t("catalogV2.subjects")}</h2>
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
              <h2>{t("catalogV2.contents")}</h2>
              {e.contents.map((c, i) => (
                <div className="cv-directory-row" key={i}>
                  <span>{c.position}</span>
                  <EntityLink id={c.expression_id} />
                  <span>
                    {Object.entries(c.locator || {})
                      .map(([k, v]) => `${t(`catalogV2.locator.${k}`)}: ${v}`)
                      .join(" · ")}
                  </span>
                </div>
              ))}
            </section>
          )}
          {!!children.length && (
            <section>
              <h2>{t("catalogV2.directory")}</h2>
              {tree("")}
              {children
                .filter(
                  (x) =>
                    x.parent_id && !children.some((p) => p.id === x.parent_id),
                )
                .map((x) => (
                  <p key={x.id}>
                    <Link href={`/catalog/${x.id}`}>{title(x, locale)}</Link>
                  </p>
                ))}
            </section>
          )}
          <section>
            <div className="cv-heading">
              <h2>{t("catalogV2.relations")}</h2>
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
                  {t("catalogV2.add")}
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
                          {t("catalogV2.edit")}
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
                  {t("catalogV2.relationType")}
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
                    <option value="">{t("catalogV2.select")}</option>
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
                  {t("catalogV2.target")}
                  <EntityPicker
                    kinds={rt?.target_kinds}
                    value={relation.target_id}
                    onChange={(id) =>
                      setRelation({ ...relation, target_id: id })
                    }
                  />
                </label>
                <label>
                  {t("catalogV2.position")}
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
                <button>{t("catalogV2.save")}</button>
                <button type="button" onClick={() => setRelation(undefined)}>
                  {t("catalogV2.cancel")}
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
                    {t("catalogV2.remove")}
                  </button>
                )}
              </form>
            )}
          </section>
          {!!occurrences.length && (
            <section>
              <h2>{t("catalogV2.occurrences")}</h2>
              {occurrences.map((o, i) => (
                <div className="cv-directory-row" key={i}>
                  <Link href={`/catalog/${o.release.id}`}>
                    {title(o.release, locale)}
                  </Link>
                  <Link href={`/catalog/${o.medium.id}`}>
                    {title(o.medium, locale)}
                  </Link>
                  <Link href={`/catalog/${o.track.id}`}>
                    {o.track.number || o.track.position} ·{" "}
                    {title(o.track, locale)}
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
              {t("catalogV2.history")}
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
              <summary>{t("catalogV2.lifecycle")}</summary>
              <Evidence
                note={note}
                setNote={setNote}
                sources={sources}
                setSources={setSources}
              />
              <label>
                {t("catalogV2.mergeTarget")}
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
                {t(mergeTarget ? "catalogV2.merge" : "catalogV2.retire")}
              </button>
            </details>
          )}
          <OptionalPanels entity={e} />
        </div>
      </div>
    </>
  );
}
export function Compare({ ids }: { ids: string }) {
  const { t, locale } = useI18n();
  const { definition } = useCatalog();
  const initialList = useMemo(() => {
    return (ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [ids]);

  const [selectedIds, setSelectedIds] = useState<string[]>(initialList);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recentReleases, setRecentReleases] = useState<Entity[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entity[]>([]);
  const [searching, setSearching] = useState(false);
  const [customIdInput, setCustomIdInput] = useState("");

  const updateSelected = (next: string[]) => {
    setSelectedIds(next);
    if (typeof window !== "undefined") {
      const url = next.length
        ? `/catalog/compare?ids=${encodeURIComponent(next.join(","))}`
        : "/catalog/compare";
      window.history.replaceState(null, "", url);
    }
  };

  const addId = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    if (selectedIds.includes(trimmed)) return;
    if (selectedIds.length >= 6) {
      setError(locale === "zh-CN" ? "最多支持同时对比 6 个发行版本" : "Maximum 6 releases can be compared");
      return;
    }
    setError("");
    updateSelected([...selectedIds, trimmed]);
  };

  const removeId = (id: string) => {
    updateSelected(selectedIds.filter((x) => x !== id));
  };

  const clearAll = () => {
    updateSelected([]);
    setItems([]);
    setError("");
  };

  // Load recent releases for quick addition
  useEffect(() => {
    api<{ items: Entity[] }>("/catalog/entities?kind=release&limit=12")
      .then((r) => setRecentReleases(r.items || []))
      .catch(() => {});
  }, []);

  // Search releases by keyword or title
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<{ items: Entity[] }>(`/catalog/entities?kind=release&q=${encodeURIComponent(q)}&limit=8`)
        .then((r) => setSearchResults(r.items || []))
        .catch((e) => setError(e.message))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Query comparison if 2 to 6 releases are selected
  useEffect(() => {
    if (selectedIds.length < 2) {
      setItems([]);
      setError("");
      return;
    }
    if (selectedIds.length > 6) {
      setError(locale === "zh-CN" ? "对比数量需在 2 到 6 个之间" : "Compare requires 2 to 6 releases");
      return;
    }
    setLoading(true);
    setError("");
    api<{ items: any[] }>(`/catalog/compare?ids=${selectedIds.join(",")}`)
      .then((r) => {
        setItems(r.items || []);
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [selectedIds, locale]);

  const fields = Array.from(
    new Set(items.flatMap((x) => Object.keys(x.release.attributes || {}))),
  );
  const sets = items.map(
    (x) =>
      new Set<string>(
        x.media.flatMap((m: any) =>
          m.tracks.flatMap((tr: any) =>
            (tr.contents || []).map((c: any) => c.expression_id),
          ),
        ),
      ),
  );

  return (
    <>
      <div className="cv-heading">
        <div>
          <h1>{t("catalogV2.compare")}</h1>
          <p className="cv-muted">{t("catalogV2.compareDesc")}</p>
        </div>
        {selectedIds.length > 0 && (
          <button type="button" onClick={clearAll}>
            {t("catalogV2.compareClear")}
          </button>
        )}
      </div>

      {/* Selected Releases Bar */}
      <section className="cv-group" style={{ margin: "16px 0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>
            {locale === "zh-CN" ? `已选对比槽位 (${selectedIds.length} / 6)` : `Selected Releases (${selectedIds.length} / 6)`}
          </span>
          {selectedIds.length < 2 && (
            <span className="cv-badge" style={{ background: "rgba(234, 179, 8, 0.15)", color: "#facc15", borderColor: "rgba(234, 179, 8, 0.3)" }}>
              {locale === "zh-CN" ? `还需选择至少 ${2 - selectedIds.length} 个版本开始对比` : `Select at least ${2 - selectedIds.length} more to compare`}
            </span>
          )}
        </div>

        {selectedIds.length === 0 ? (
          <p className="cv-empty" style={{ margin: "10px 0" }}>
            {locale === "zh-CN" ? "暂未选择对比版本，请从下方快速选择或搜索输入发行版。" : "No releases selected. Search or choose from below."}
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {selectedIds.map((id) => {
              const matched = items.find((x) => x.release?.id === id) || recentReleases.find((x) => x.id === id);
              const labelText = matched ? title(matched.release || matched, locale) : id.slice(0, 8) + "...";
              return (
                <span
                  key={id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 12px",
                    background: "#1c2635",
                    border: "1px solid #3c4b60",
                    borderRadius: 20,
                    fontSize: 13,
                  }}
                >
                  <Link href={`/catalog/${id}`}>{labelText}</Link>
                  <button
                    type="button"
                    onClick={() => removeId(id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: 0,
                      minHeight: "auto",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                    title={locale === "zh-CN" ? "移除" : "Remove"}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </section>

      {/* Release Search and Quick-Add Selector */}
      {selectedIds.length < 6 && (
        <section style={{ margin: "20px 0" }}>
          <h2>{t("catalogV2.compareSelectRelease")}</h2>
          <div className="cv-row" style={{ alignItems: "flex-start" }}>
            <input
              type="text"
              placeholder={t("catalogV2.compareSearchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder={locale === "zh-CN" ? "直接输入 Release UUID..." : "Paste Release UUID..."}
                value={customIdInput}
                onChange={(e) => setCustomIdInput(e.target.value)}
                style={{ width: 280 }}
              />
              <button
                type="button"
                disabled={!customIdInput.trim()}
                onClick={() => {
                  addId(customIdInput.trim());
                  setCustomIdInput("");
                }}
              >
                {t("catalogV2.compareAdd")}
              </button>
            </div>
          </div>

          {searching && <p className="cv-muted">{t("catalogV2.loading")}</p>}

          {searchResults.length > 0 && (
            <div style={{ margin: "16px 0", border: "1px solid #334052", borderRadius: 8, padding: 12, background: "#121a25" }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: "#91d7cc", margin: "0 0 8px" }}>
                {locale === "zh-CN" ? "搜索结果" : "Search Results"}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {searchResults.map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "#18202c",
                        border: "1px solid #2e3a4b",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title(r, locale)}
                        </div>
                        <small className="cv-muted">
                          {r.attributes?.catalog_number ? `${r.attributes.catalog_number} · ` : ""}
                          {r.attributes?.format ? `${r.attributes.format} · ` : ""}
                          {r.id?.slice(0, 8)}
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={isSelected}
                        onClick={() => addId(r.id!)}
                        style={{ padding: "4px 10px", minHeight: 30, fontSize: 12 }}
                      >
                        {isSelected ? (locale === "zh-CN" ? "已在对比" : "Added") : t("catalogV2.compareAdd")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent releases quick pick */}
          {selectedIds.length < 2 && searchResults.length === 0 && recentReleases.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>
                {t("catalogV2.compareDemoHint")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                {recentReleases.slice(0, 8).map((r) => {
                  const isSelected = selectedIds.includes(r.id!);
                  return (
                    <div
                      key={r.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "#141c26",
                        border: "1px solid #283444",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title(r, locale)}
                        </div>
                        <small className="cv-muted">
                          {r.attributes?.catalog_number ? `${r.attributes.catalog_number} · ` : ""}
                          {r.attributes?.format || "Release"}
                        </small>
                      </div>
                      <button
                        type="button"
                        disabled={isSelected}
                        onClick={() => addId(r.id!)}
                        style={{ padding: "3px 8px", minHeight: 28, fontSize: 12 }}
                      >
                        {isSelected ? "✓" : "+"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      <ErrorMessage error={error} />
      {loading && <p className="cv-muted">{t("catalogV2.loading")}</p>}

      {/* Comparison Matrix Table */}
      {items.length >= 2 && !loading && (
        <div className="cv-table-scroll" style={{ marginTop: 24 }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>{t("catalogV2.attributes")}</th>
                {items.map((x) => (
                  <th key={x.release.id} style={{ minWidth: 240, verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {x.release.pictures?.[0] && (
                        <img
                          src={x.release.pictures[0].url}
                          alt={title(x.release, locale)}
                          style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, border: "1px solid #334052" }}
                        />
                      )}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                        <Link href={`/catalog/${x.release.id}`} style={{ fontWeight: 650, fontSize: 15 }}>
                          {title(x.release, locale)}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeId(x.release.id)}
                          style={{
                            minHeight: "auto",
                            padding: "2px 6px",
                            fontSize: 12,
                            background: "#2a1515",
                            color: "#f87171",
                            borderColor: "#7f1d1d",
                          }}
                          title={locale === "zh-CN" ? "从对比中移除" : "Remove"}
                        >
                          ×
                        </button>
                      </div>
                      {x.release.attributes?.catalog_number && (
                        <small className="cv-muted">
                          {x.release.attributes.catalog_number}
                        </small>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((k) => (
                <tr key={k}>
                  <th>
                    {local(definition?.document.fields[k]?.names, locale, "", k)}
                  </th>
                  {items.map((x) => (
                    <td key={x.release.id}>
                      <FieldValue
                        field={definition?.document.fields[k]}
                        value={x.release.attributes[k]}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th>{t("catalogV2.directory")}</th>
                {items.map((x, index) => (
                  <td key={x.release.id} style={{ verticalAlign: "top" }}>
                    {x.media.map((m: any) => (
                      <section key={m.medium.id} style={{ padding: 12, margin: "8px 0" }}>
                        <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{title(m.medium, locale)}</h3>
                        <FieldValue
                          field={definition?.document.fields.format}
                          value={m.medium.attributes?.format}
                        />
                        <div style={{ marginTop: 8 }}>
                          {m.tracks.map((tr: Entity) => (
                            <div key={tr.id} style={{ margin: "6px 0", fontSize: 13, borderBottom: "1px dashed #233041", paddingBottom: 4 }}>
                              <span style={{ fontWeight: 500 }}>
                                {tr.number || tr.position} · {title(tr, locale)}
                              </span>
                              {tr.contents?.map((c, i) => {
                                const isVariant = sets.some(
                                  (s, j) => j !== index && !s.has(c.expression_id),
                                );
                                return (
                                  <p key={i} style={{ margin: "3px 0 0 12px", fontSize: 12 }}>
                                    <EntityLink id={c.expression_id} />
                                    {isVariant && (
                                      <span
                                        className="cv-badge"
                                        style={{ marginLeft: 6, background: "rgba(145, 215, 204, 0.15)", color: "#91d7cc", borderColor: "rgba(145, 215, 204, 0.3)" }}
                                      >
                                        {t("catalogV2.variantContent")}
                                      </span>
                                    )}
                                  </p>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
