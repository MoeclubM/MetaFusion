"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, emptyEntity, kinds, local, Source } from "./api";
import { useCatalog } from "./CatalogProvider";
import { EntityPicker, Evidence, FieldInput, ErrorMessage } from "./Fields";
import { RelationEditorField } from "@/components/editor/RelationEditorField";
import { getFieldName, getTermName } from "@/lib/definitions";
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
  // definitions：定位字段等由它声明，避免编辑器写死字段码。
  const defs = definition?.document;
  // 定位子字段顺序即 definitions 中的声明顺序（relative_to 是锚点，放最前）。
  const locatorFieldKeys = React.useMemo(() => {
    const f: any = defs?.fields?.["locator"];
    const keys = Object.keys(f?.fields || {});
    const anchor = f?.anchor_key;
    return anchor && keys.includes(anchor) ? [anchor, ...keys.filter((k) => k !== anchor)] : keys;
  }, [defs]);
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
  if (!definition) return <p>{t("catalog.loading")}</p>;
  if (!user) return <p>{t("catalog.loginToEdit")}</p>;
  const d = definition.document;
  const patch = (v: Partial<Entity>) => setE({ ...e, ...v });
  const fields = Array.from(
    new Set([
      ...e.types.flatMap((k) => d.types[k]?.fields || []),
      ...Object.keys(e.attributes),
    ]),
  );
  // 动态结构：合并实体全部类型引用模板的 sections（保序去重）；
  // hidden 字段（存档/检索用）不在编辑面板出现；剩余字段归入"其它信息"。
  // 注意：此处位于条件 return 之后，必须用普通计算，不得改成 useMemo。
  const sections: { names: Record<string, string>; fields: string[] }[] = [];
  let restFields: string[] = [];
  {
    const declared = new Set(fields);
    const seen = new Set<string>();
    for (const tc of e.types) {
      const tpl = d.templates?.[d.types[tc]?.template || ""];
      for (const sec of tpl?.sections || []) {
        const fs = (sec.fields || []).filter(
          (f: string) =>
            declared.has(f) &&
            !seen.has(f) &&
            !d.fields[f]?.hidden &&
            d.fields[f],
        );
        if (!fs.length) continue;
        fs.forEach((f: string) => seen.add(f));
        sections.push({ names: sec.names || {}, fields: fs });
      }
    }
    restFields = fields.filter((f) => !seen.has(f) && !d.fields[f]?.hidden);
  }
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    // 应用层证据校验：HTML required 的原生气泡在部分环境不可见，
    // 曾表现为"点保存没反应"；noValidate 后统一在此给出明确提示。
    const missingEvidence =
      !note.trim() ||
      sources.length === 0 ||
      sources.some(
        (s) =>
          !s.citation.trim() ||
          (s.kind === "url" && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(s.url || "")),
      );
    if (missingEvidence || !e.title.trim()) {
      setError(t("catalog.evidenceRequired"));
      return;
    }
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
    <form onSubmit={save} noValidate className="cv-form">
      <div className="cv-heading">
        <h1>{t(initial ? "catalog.edit" : "catalog.create")}</h1>
        <button className="cv-primary" disabled={busy}>
          {t(busy ? "catalog.saving" : "catalog.save")}
        </button>
      </div>
      <ErrorMessage error={error} />
      <fieldset>
        <legend>{t("catalog.identity")}</legend>
        <div className="cv-grid">
          <label>
            {t("catalog.kindLabel")}
            <select
              value={e.kind}
              disabled={!!e.id}
              onChange={(x) =>
                setE({ ...emptyEntity(x.target.value), title: e.title })
              }
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`catalog.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("catalog.title")}
            <input
              required
              value={e.title}
              onChange={(x) => patch({ title: x.target.value })}
            />
          </label>
          <label>
            {t("catalog.originalLanguage")}
            <input
              value={e.original_language}
              onChange={(x) => patch({ original_language: x.target.value })}
            />
          </label>
          <label>
            {t("catalog.status")}
            <select
              value={e.status}
              onChange={(x) => patch({ status: x.target.value })}
            >
              {(
                initial?.status === "published"
                  ? ["published"]
                  : [
                      "draft",
                      "pending_review",
                      // user 走审核制（草稿/待审）；editor/admin 可直接发布
                      // 自己的条目（新建无 created_by 即视为自己）。
                      ...((user.role === "admin" ||
                        (user.role === "editor" &&
                          (!initial?.created_by ||
                            initial.created_by === user.id)))
                        ? ["published"]
                        : []),
                    ]
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`catalog.state.${k}`)}
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
        <legend>{t("catalog.translations")}</legend>
        {/* 主语言（原始语言）行：标题即基础题名（在"实体身份"区维护），
            但别名必须能按语种维护——没有该语种翻译行时提供合成行，
            输入别名时才真正创建 translations 行落库。 */}
        {e.original_language && e.title && !e.translations[e.original_language] && (
          <div className="cv-group">
            <strong>{e.original_language}</strong>{" "}
            <span className="text-xs opacity-60">{t("revisions.fieldOriginalLanguage")}</span>
            <label>
              {t("catalog.title")}
              <input value={e.title} disabled />
            </label>
            <label>
              {t("catalog.aliases")}
              <textarea
                value=""
                onChange={(x) =>
                  patch({
                    translations: {
                      ...e.translations,
                      [e.original_language]: {
                        title: e.title,
                        summary: "",
                        aliases: x.target.value.split("\n").filter(Boolean),
                      },
                    },
                  })
                }
              />
            </label>
          </div>
        )}
        {Object.entries(e.translations).map(([loc, tr]) => (
          <div key={loc} className="cv-group">
            <strong>{loc}</strong>
            <label>
              {t("catalog.title")}
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
              {t("catalog.summary")}
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
              {t("catalog.aliases")}
              <textarea
                aria-label={`${loc} · ${t("catalog.aliases")}`}
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
              {t("catalog.remove")}
            </button>
          </div>
        ))}
        <div className="cv-row">
          <input
            aria-label={t("catalog.localeCode")}
            placeholder={t("catalog.localeCode")}
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
            {t("catalog.add")}
          </button>
        </div>
      </fieldset>
      {["content_unit", "expression", "release", "medium", "track"].includes(e.kind) && (
      <fieldset>
        <legend>{t("catalog.structure")}</legend>
        <div className="cv-grid">
          {(e.kind === "content_unit" || e.kind === "expression") && (
            <label>
              {t("catalog.kind.work")}
              <EntityPicker
                kinds={["work"]}
                value={e.work_id || ""}
                onChange={(id) => patch({ work_id: id })}
              />
            </label>
          )}
          {e.kind === "expression" && (
            <label>
              {t("catalog.kind.content_unit")}
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
              {t("catalog.kind.release")}
              <EntityPicker
                kinds={["release"]}
                value={e.release_id || ""}
                onChange={(id) => patch({ release_id: id })}
              />
            </label>
          )}
          {e.kind === "track" && (
            <label>
              {t("catalog.kind.medium")}
              <EntityPicker
                kinds={["medium"]}
                value={e.medium_id || ""}
                onChange={(id) => patch({ medium_id: id })}
              />
            </label>
          )}
          {["content_unit", "medium", "track"].includes(e.kind) && (
            <label>
              {t("catalog.parent")}
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
          {["content_unit", "expression", "release", "medium", "track"].includes(e.kind) && (
            <>
              <label>
                {t("catalog.position")}
                <input
                  type="number"
                  min="0"
                  value={e.position}
                  onChange={(x) => patch({ position: Number(x.target.value) })}
                />
              </label>
              <label>
                {t("catalog.number")}
                <input
                  value={e.number}
                  onChange={(x) => patch({ number: x.target.value })}
                />
              </label>
            </>
          )}
        </div>
        {e.kind === "release" && (
          <>
            <h3>{t("catalog.subjects")}</h3>
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
                  {t("catalog.remove")}
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
              {t("catalog.addSubject")}
            </button>
          </>
        )}
        {e.kind === "track" && (
          <>
            <h3>{t("catalog.contents")}</h3>
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
                    {t("catalog.position")}
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
                  {/* 定位方案与参照选项由 definitions 的 locator 组字段声明，后台可扩展 */}
                  {locatorFieldKeys.map((k) => {
                    const def: any = defs?.fields?.locator?.fields?.[k];
                    if (!def) return null;
                    const isEnum = def.type === "enum";
                    return (
                      <label key={k}>
                        {getFieldName(defs as any, k, locale) || k}
                        {isEnum ? (
                          <select
                            value={c.locator[k] || ""}
                            onChange={(x) => {
                              const locator = { ...c.locator };
                              if (x.target.value === "") delete locator[k];
                              else locator[k] = x.target.value;
                              patch({
                                contents: e.contents.map((v, j) =>
                                  i === j ? { ...v, locator } : v,
                                ),
                              });
                            }}
                          >
                            <option value="">{t("catalog.none")}</option>
                            {Object.keys(defs?.vocabularies?.[def.vocabulary]?.terms || {}).map((term) => (
                              <option key={term} value={term}>
                                {getTermName(defs as any, def.vocabulary, term, locale)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={c.locator[k] ?? ""}
                            type={def.type === "number" ? "number" : "text"}
                            onChange={(x) => {
                              const locator = { ...c.locator };
                              if (x.target.value === "") delete locator[k];
                              else
                                locator[k] =
                                  def.type === "number"
                                    ? Number(x.target.value)
                                    : x.target.value;
                              patch({
                                contents: e.contents.map((v, j) =>
                                  i === j ? { ...v, locator } : v,
                                ),
                              });
                            }}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patch({ contents: e.contents.filter((_, j) => i !== j) })
                  }
                >
                  {t("catalog.remove")}
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
              {t("catalog.addContent")}
            </button>
          </>
        )}
      </fieldset>
      )}
      {/* 关系维护：独立资源逐条提交，不复用实体 PUT；词表来自服务端 definitions。 */}
      <RelationEditorField entityId={e.id} entityKind={e.kind} note={note} sources={sources} />
      {!!fields.length && (
        <fieldset>
          <legend>{t("catalog.attributes")}</legend>
          {/* 动态结构：字段按实体类型引用模板的 sections 分组（分区名/字段/次序
              全部来自服务端 definitions）；模板未覆盖的字段落入末尾"其它信息"，
              保证任何声明过的数据都可编辑。 */}
          {sections.map((sec, i) => (
            <div key={`sec${i}`} className="cv-section">
              <h4 className="cv-section-title">
                {local(sec.names, locale, "")}
              </h4>
              <div className="cv-grid">
                {sec.fields.map((k) => (
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
                        {t("catalog.remove")}
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {restFields.length > 0 && (
            <div className="cv-section">
              <h4 className="cv-section-title">{t("catalog.otherInfo")}</h4>
              <div className="cv-grid">
                {restFields.map((k) => (
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
                        {t("catalog.remove")}
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}
      <fieldset>
        <legend>{t("catalog.externalIds")}</legend>
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
              {t("catalog.remove")}
            </button>
          </div>
        ))}
        <div className="cv-row">
          <input
            value={externalKey}
            aria-label={t("catalog.code")}
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
            {t("catalog.add")}
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("catalog.pictures")}</legend>
        {e.pictures.map((p, i) => (
          <div className="cv-group" key={i}>
            <label>
              {t("catalog.imageUrl")}
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
              {t("catalog.citation")}
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
              {t("catalog.remove")}
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
          {t("catalog.add")}
        </button>
      </fieldset>
      <Evidence
        note={note}
        setNote={setNote}
        sources={sources}
        setSources={setSources}
      />
      <button className="cv-primary" disabled={busy}>
        {t("catalog.save")}
      </button>
    </form>
  );
}
