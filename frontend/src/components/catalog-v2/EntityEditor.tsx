"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, emptyEntity, kinds, local, Source } from "./api";
import { useCatalog } from "./CatalogProvider";
import { EntityPicker, Evidence, FieldInput, ErrorMessage } from "./Fields";
export function EntityEditor({
  initial,
  onSaved,
}: {
  initial?: Entity;
  onSaved?: (e: Entity) => void;
}) {
  const { t, locale } = useI18n();
  const { definition, user } = useCatalog();
  const router = useRouter();
  const [e, setE] = useState<Entity>(() => ({
    ...emptyEntity(initial?.kind),
    ...initial,
    types: initial?.types || [],
    attributes: initial?.attributes || {},
    translations: initial?.translations || {},
    pictures: initial?.pictures || [],
    external_ids: initial?.external_ids || {},
    contents: initial?.contents || [],
    subjects: initial?.subjects || [],
  }));
  const [note, setNote] = useState("");
  const [sources, setSources] = useState<Source[]>([
    { kind: "self", citation: "" },
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newLocale, setNewLocale] = useState("");
  const [externalKey, setExternalKey] = useState("");
  if (!definition) return <p>{t("catalogV2.loading")}</p>;
  if (!user) return <p>{t("catalogV2.loginToEdit")}</p>;
  const d = definition.document;
  const patch = (v: Partial<Entity>) => setE({ ...e, ...v });
  const fields = Array.from(
    new Set([
      ...e.types.flatMap((k) => d.types[k]?.fields || []),
      ...Object.keys(e.attributes),
    ]),
  );
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await api<Entity>(
        e.id ? `/catalog/entities/${e.id}` : "/catalog/entities",
        e.id ? "PUT" : "POST",
        { entity: e, expected_version: e.version, edit_note: note, sources },
      );
      if (onSaved) onSaved(out);
      else router.push(`/catalog/${out.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="cv-form">
      <div className="cv-heading">
        <h1>{t(initial ? "catalogV2.edit" : "catalogV2.create")}</h1>
        <button className="cv-primary" disabled={busy}>
          {t(busy ? "catalogV2.saving" : "catalogV2.save")}
        </button>
      </div>
      <ErrorMessage error={error} />
      <fieldset>
        <legend>{t("catalogV2.identity")}</legend>
        <div className="cv-grid">
          <label>
            {t("catalogV2.kindLabel")}
            <select
              value={e.kind}
              disabled={!!e.id}
              onChange={(x) =>
                setE({ ...emptyEntity(x.target.value), title: e.title })
              }
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`catalogV2.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("catalogV2.title")}
            <input
              required
              value={e.title}
              onChange={(x) => patch({ title: x.target.value })}
            />
          </label>
          <label>
            {t("catalogV2.originalLanguage")}
            <input
              value={e.original_language}
              onChange={(x) => patch({ original_language: x.target.value })}
            />
          </label>
          <label>
            {t("catalogV2.status")}
            <select
              value={e.status}
              onChange={(x) => patch({ status: x.target.value })}
            >
              {(initial?.status === "published"
                ? ["published"]
                : [
                    "draft",
                    "pending_review",
                    ...(user.role === "admin" ? ["published"] : []),
                  ]
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`catalogV2.state.${k}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cv-checks">
          {Object.entries(d.types)
            .filter(
              ([k, v]) =>
                v.kinds.includes(e.kind) && (v.enabled || e.types.includes(k)),
            )
            .map(([k, v]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={e.types.includes(k)}
                  onChange={(x) => {
                    const types = x.target.checked
                      ? [...e.types, k]
                      : e.types.filter((a) => a !== k);
                    patch({ types });
                  }}
                />
                {local(v.names, locale, "", k)}
              </label>
            ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalogV2.translations")}</legend>
        {Object.entries(e.translations).map(([loc, tr]) => (
          <div key={loc} className="cv-group">
            <strong>{loc}</strong>
            <label>
              {t("catalogV2.title")}
              <input
                required
                value={tr.title}
                onChange={(x) =>
                  patch({
                    translations: {
                      ...e.translations,
                      [loc]: { ...tr, title: x.target.value },
                    },
                  })
                }
              />
            </label>
            <label>
              {t("catalogV2.summary")}
              <textarea
                value={tr.summary || ""}
                onChange={(x) =>
                  patch({
                    translations: {
                      ...e.translations,
                      [loc]: { ...tr, summary: x.target.value },
                    },
                  })
                }
              />
            </label>
            <label>
              {t("catalogV2.aliases")}
              <textarea
                value={(tr.aliases || []).join("\n")}
                onChange={(x) =>
                  patch({
                    translations: {
                      ...e.translations,
                      [loc]: {
                        ...tr,
                        aliases: x.target.value.split("\n").filter(Boolean),
                      },
                    },
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({
                  translations: Object.fromEntries(
                    Object.entries(e.translations).filter(([k]) => k !== loc),
                  ),
                })
              }
            >
              {t("catalogV2.remove")}
            </button>
          </div>
        ))}
        <div className="cv-row">
          <input
            aria-label={t("catalogV2.localeCode")}
            placeholder={t("catalogV2.localeCode")}
            value={newLocale}
            onChange={(x) => setNewLocale(x.target.value)}
          />
          <button
            type="button"
            disabled={!newLocale || !!e.translations[newLocale]}
            onClick={() => {
              patch({
                translations: {
                  ...e.translations,
                  [newLocale]: { title: e.title, summary: "", aliases: [] },
                },
              });
              setNewLocale("");
            }}
          >
            {t("catalogV2.add")}
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalogV2.structure")}</legend>
        <div className="cv-grid">
          {(e.kind === "content_unit" || e.kind === "expression") && (
            <label>
              {t("catalogV2.kind.work")}
              <EntityPicker
                kinds={["work"]}
                value={e.work_id || ""}
                onChange={(id) => patch({ work_id: id })}
              />
            </label>
          )}
          {e.kind === "expression" && (
            <label>
              {t("catalogV2.kind.content_unit")}
              <EntityPicker
                kinds={["content_unit"]}
                query={e.work_id ? `&work_id=${e.work_id}` : ""}
                value={e.content_unit_id || ""}
                onChange={(id) => patch({ content_unit_id: id })}
              />
            </label>
          )}
          {e.kind === "medium" && (
            <label>
              {t("catalogV2.kind.release")}
              <EntityPicker
                kinds={["release"]}
                value={e.release_id || ""}
                onChange={(id) => patch({ release_id: id })}
              />
            </label>
          )}
          {e.kind === "track" && (
            <label>
              {t("catalogV2.kind.medium")}
              <EntityPicker
                kinds={["medium"]}
                value={e.medium_id || ""}
                onChange={(id) => patch({ medium_id: id })}
              />
            </label>
          )}
          {["content_unit", "medium", "track"].includes(e.kind) && (
            <label>
              {t("catalogV2.parent")}
              <EntityPicker
                kinds={[e.kind]}
                query={
                  e.work_id
                    ? `&work_id=${e.work_id}`
                    : e.release_id
                      ? `&release_id=${e.release_id}`
                      : e.medium_id
                        ? `&medium_id=${e.medium_id}`
                        : ""
                }
                value={e.parent_id || ""}
                onChange={(id) => patch({ parent_id: id })}
              />
            </label>
          )}
          <label>
            {t("catalogV2.position")}
            <input
              type="number"
              min="0"
              value={e.position}
              onChange={(x) => patch({ position: Number(x.target.value) })}
            />
          </label>
          <label>
            {t("catalogV2.number")}
            <input
              value={e.number}
              onChange={(x) => patch({ number: x.target.value })}
            />
          </label>
        </div>
        {e.kind === "release" && (
          <>
            <h3>{t("catalogV2.subjects")}</h3>
            {e.subjects.map((s, i) => (
              <div className="cv-row" key={i}>
                <EntityPicker
                  kinds={["work"]}
                  value={s.work_id}
                  onChange={(id) =>
                    patch({
                      subjects: e.subjects.map((v, j) =>
                        i === j ? { ...v, work_id: id } : v,
                      ),
                    })
                  }
                />
                <select
                  value={s.role}
                  onChange={(x) =>
                    patch({
                      subjects: e.subjects.map((v, j) =>
                        i === j ? { ...v, role: x.target.value } : v,
                      ),
                    })
                  }
                >
                  {Object.entries(d.vocabularies.release_role.terms)
                    .filter(([k, v]) => v.enabled || k === s.role)
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {local(v.names, locale, "", k)}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    patch({ subjects: e.subjects.filter((_, j) => i !== j) })
                  }
                >
                  {t("catalogV2.remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  subjects: [
                    ...e.subjects,
                    {
                      work_id: "",
                      role: "primary",
                      position: e.subjects.length,
                    },
                  ],
                })
              }
            >
              {t("catalogV2.addSubject")}
            </button>
          </>
        )}
        {e.kind === "track" && (
          <>
            <h3>{t("catalogV2.contents")}</h3>
            {e.contents.map((c, i) => (
              <div className="cv-group" key={i}>
                <EntityPicker
                  kinds={["expression"]}
                  value={c.expression_id}
                  onChange={(id) =>
                    patch({
                      contents: e.contents.map((v, j) =>
                        i === j ? { ...v, expression_id: id } : v,
                      ),
                    })
                  }
                />
                <div className="cv-grid">
                  <label>
                    {t("catalogV2.position")}
                    <input
                      type="number"
                      min="0"
                      value={c.position}
                      onChange={(x) =>
                        patch({
                          contents: e.contents.map((v, j) =>
                            i === j
                              ? { ...v, position: Number(x.target.value) }
                              : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("catalogV2.relativeTo")}
                    <select
                      value={c.locator.relative_to || ""}
                      onChange={(x) =>
                        patch({
                          contents: e.contents.map((v, j) =>
                            i === j
                              ? {
                                  ...v,
                                  locator: {
                                    ...v.locator,
                                    relative_to: x.target.value,
                                  },
                                }
                              : v,
                          ),
                        })
                      }
                    >
                      <option value="">{t("catalogV2.none")}</option>
                      {["track", "medium"].map((k) => (
                        <option key={k} value={k}>
                          {t(`catalogV2.kind.${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {[
                    "page_start",
                    "page_end",
                    "time_start_ms",
                    "time_end_ms",
                    "path",
                    "chapter",
                  ].map((k) => (
                    <label key={k}>
                      {t(`catalogV2.locator.${k}`)}
                      <input
                        value={c.locator[k] ?? ""}
                        type={
                          k.includes("page") || k.includes("time")
                            ? "number"
                            : "text"
                        }
                        onChange={(x) => {
                          const locator = { ...c.locator };
                          if (x.target.value === "") delete locator[k];
                          else
                            locator[k] =
                              x.target.type === "number"
                                ? Number(x.target.value)
                                : x.target.value;
                          patch({
                            contents: e.contents.map((v, j) =>
                              i === j ? { ...v, locator } : v,
                            ),
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patch({ contents: e.contents.filter((_, j) => i !== j) })
                  }
                >
                  {t("catalogV2.remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  contents: [
                    ...e.contents,
                    {
                      expression_id: "",
                      position: e.contents.length,
                      locator: {},
                    },
                  ],
                })
              }
            >
              {t("catalogV2.addContent")}
            </button>
          </>
        )}
      </fieldset>
      {!!fields.length && (
        <fieldset>
          <legend>{t("catalogV2.attributes")}</legend>
          <div className="cv-grid">
            {fields.map((k) => (
              <label key={k}>
                {local(d.fields[k]?.names, locale, "", k)}
                {d.fields[k]?.required && " *"}
                <FieldInput
                  field={d.fields[k]}
                  value={e.attributes[k]}
                  onChange={(v) =>
                    patch({ attributes: { ...e.attributes, [k]: v } })
                  }
                />
                {e.attributes[k] !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      const attributes = { ...e.attributes };
                      delete attributes[k];
                      patch({ attributes });
                    }}
                  >
                    {t("catalogV2.remove")}
                  </button>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>{t("catalogV2.externalIds")}</legend>
        {Object.entries(e.external_ids).map(([k, v]) => (
          <div key={k} className="cv-row">
            <label>
              {k}
              <input
                value={v}
                onChange={(x) =>
                  patch({
                    external_ids: { ...e.external_ids, [k]: x.target.value },
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({
                  external_ids: Object.fromEntries(
                    Object.entries(e.external_ids).filter(([key]) => key !== k),
                  ),
                })
              }
            >
              {t("catalogV2.remove")}
            </button>
          </div>
        ))}
        <div className="cv-row">
          <input
            value={externalKey}
            aria-label={t("catalogV2.code")}
            onChange={(x) => setExternalKey(x.target.value)}
          />
          <button
            type="button"
            disabled={!externalKey}
            onClick={() => {
              patch({ external_ids: { ...e.external_ids, [externalKey]: "" } });
              setExternalKey("");
            }}
          >
            {t("catalogV2.add")}
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalogV2.pictures")}</legend>
        {e.pictures.map((p, i) => (
          <div className="cv-group" key={i}>
            <label>
              {t("catalogV2.imageUrl")}
              <input
                type="url"
                required
                value={p.url}
                onChange={(x) =>
                  patch({
                    pictures: e.pictures.map((v, j) =>
                      i === j ? { ...v, url: x.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              {t("catalogV2.citation")}
              <input
                required
                value={p.source.citation}
                onChange={(x) =>
                  patch({
                    pictures: e.pictures.map((v, j) =>
                      i === j
                        ? {
                            ...v,
                            source: { ...v.source, citation: x.target.value },
                          }
                        : v,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({ pictures: e.pictures.filter((_, j) => i !== j) })
              }
            >
              {t("catalogV2.remove")}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            patch({
              pictures: [
                ...e.pictures,
                {
                  url: "",
                  caption: {},
                  source: { kind: "self", citation: "" },
                },
              ],
            })
          }
        >
          {t("catalogV2.add")}
        </button>
      </fieldset>
      <Evidence
        note={note}
        setNote={setNote}
        sources={sources}
        setSources={setSources}
      />
      <button className="cv-primary" disabled={busy}>
        {t("catalogV2.save")}
      </button>
    </form>
  );
}
