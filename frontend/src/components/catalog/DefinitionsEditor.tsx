"use client";
import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  api,
  Definition,
  Definitions,
  Field,
  Names,
  Source,
  kinds,
  local,
} from "./api";
import { useCatalog } from "./CatalogProvider";
import { Evidence, ErrorMessage, NamesEditor } from "./Fields";

const newField = (): Field => ({ names: {}, type: "text", enabled: true });
function Checks({
  values,
  selected,
  onChange,
  label,
}: {
  values: Record<string, string>;
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="cv-checks">
        {Object.entries(values).map(([k, name]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={(selected || []).includes(k)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...(selected || []), k]
                    : (selected || []).filter((x) => x !== k),
                )
              }
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function TextList({
  value,
  onChange,
  label,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <label>
      {label}
      <input
        value={(value || []).join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}
function Dictionary<T extends { names: Names }>({
  value,
  onChange,
  create,
  render,
}: {
  value: Record<string, T>;
  onChange: (v: Record<string, T>) => void;
  create: () => T;
  render: (item: T, change: (v: T) => void) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const [code, setCode] = useState("");
  return (
    <>
      <div className="cv-row">
        <label>
          {t("catalog.code")}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            pattern="[a-z][a-z0-9_]*"
          />
        </label>
        <button
          type="button"
          disabled={!/^[a-z][a-z0-9_]*$/.test(code) || !!value[code]}
          onClick={() => {
            onChange({ ...value, [code]: create() });
            setCode("");
          }}
        >
          {t("catalog.add")}
        </button>
      </div>
      {Object.entries(value).map(([key, v]) => (
        <details className="cv-group" key={key}>
          <summary>
            {local(v.names, locale, "", key)} <small>({key})</small>
          </summary>
          {render(v, (x) => onChange({ ...value, [key]: x }))}
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            {t("catalog.removeDefinition")}
          </button>
        </details>
      ))}
    </>
  );
}
function FieldDefinition({
  value,
  onChange,
  d,
}: {
  value: Field;
  onChange: (v: Field) => void;
  d: Definitions;
}) {
  const { t, locale } = useI18n();
  const patch = (v: Partial<Field>) => onChange({ ...value, ...v });
  return (
    <>
      <NamesEditor value={value.names} onChange={(names) => patch({ names })} />
      <label>
        {t("catalog.fieldType")}
        <select
          value={value.type}
          onChange={(e) =>
            onChange({
              ...newField(),
              names: value.names,
              type: e.target.value,
              ...(e.target.value === "list"
                ? { items: newField() }
                : e.target.value === "group"
                  ? { fields: {} }
                  : {}),
            })
          }
        >
          {[
            "text",
            "multilingual",
            "number",
            "date",
            "boolean",
            "url",
            "enum",
            "entity",
            "list",
            "group",
          ].map((k) => (
            <option key={k} value={k}>
              {t(`catalog.fieldTypeNames.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="cv-checks">
        {(["enabled", "required", "searchable", "comparable"] as const).map(
          (k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={!!value[k]}
                onChange={(e) => patch({ [k]: e.target.checked })}
              />
              {t(`catalog.${k}`)}
            </label>
          ),
        )}
      </div>
      <label>{t("catalog.unit")}</label>
      <NamesEditor
        value={value.unit || {}}
        onChange={(unit) => patch({ unit })}
      />
      <div className="cv-grid">
        {(["min", "max"] as const).map((k) => (
          <label key={k}>
            {t(`catalog.${k}`)}
            <input
              type="number"
              step="any"
              value={value[k] ?? ""}
              onChange={(e) =>
                patch({
                  [k]:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      {value.type === "enum" && (
        <label>
          {t("catalog.vocabulary")}
          <select
            value={value.vocabulary || ""}
            onChange={(e) => patch({ vocabulary: e.target.value })}
          >
            <option value="">{t("catalog.select")}</option>
            {Object.entries(d.vocabularies).map(([k, v]) => (
              <option key={k} value={k}>
                {local(v.names, locale, "", k)}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.type === "entity" && (
        <Checks
          label={t("catalog.allowedKinds")}
          values={Object.fromEntries(
            kinds.map((k) => [k, t(`catalog.kind.${k}`)]),
          )}
          selected={value.kinds || []}
          onChange={(kinds) => patch({ kinds })}
        />
      )}{" "}
      {value.type === "list" && (
        <fieldset>
          <legend>{t("catalog.listItem")}</legend>
          <FieldDefinition
            value={value.items || newField()}
            onChange={(items) => patch({ items })}
            d={d}
          />
        </fieldset>
      )}
      {value.type === "group" && (
        <Dictionary
          value={value.fields || {}}
          onChange={(fields) => patch({ fields })}
          create={newField}
          render={(f, change) => (
            <FieldDefinition value={f} onChange={change} d={d} />
          )}
        />
      )}
    </>
  );
}
export function DefinitionsEditor() {
  const { t, locale } = useI18n();
  const { definition, user, refresh, modules } = useCatalog();
  const [d, setD] = useState<Definitions>();
  const [base, setBase] = useState(0);
  const [versions, setVersions] = useState<Definition[]>([]);
  const [draft, setDraft] = useState(0);
  const [issues, setIssues] = useState<string[]>();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sources, setSources] = useState<Source[]>([
    { kind: "self", citation: "" },
  ]);
  const [tab, setTab] = useState<keyof Definitions>("types");
  const [cascade, setCascade] = useState(false);
  // 冒烟验证：相对已发布版本的新增词表项，供发布前预演。
  const [smokeVocab, setSmokeVocab] = useState("");
  const [smokeTerm, setSmokeTerm] = useState("");
  const publishedVocabs = definition?.document.vocabularies || {};
  const newTerms = Object.entries(d?.vocabularies || {}).flatMap(([vk, v]) =>
    Object.keys(v.terms || {})
      .filter((tk) => !publishedVocabs[vk]?.terms?.[tk])
      .map((tk) => ({ vocab: vk, term: tk })),
  );
  useEffect(() => {
    if (definition && !d) {
      setD(structuredClone(definition.document));
      setBase(definition.id);
    }
  }, [definition, d]);
  useEffect(() => {
    if (user?.role === "admin")
      api("/admin/catalog-definitions")
        .then((r) => setVersions(r.items))
        .catch((e) => setError(e.message));
  }, [user, draft]);
  if (user?.role !== "admin") return <p>{t("catalog.adminRequired")}</p>;
  if (!d) return <p>{t("catalog.loading")}</p>;
  const change = (next: Definitions) => {
    setD(next);
    setDraft(0);
    setIssues(undefined);
  };
  const names = (items: Record<string, { names: Names }>) =>
    Object.fromEntries(
      Object.entries(items).map(([k, v]) => [k, local(v.names, locale, "", k)]),
    );
  const kindNames = Object.fromEntries(
    kinds.map((k) => [k, t(`catalog.kind.${k}`)]),
  );
  return (
    <>
      <h1>{t("catalog.configure")}</h1>
      <ErrorMessage error={error} />
      <p className="cv-muted">{t("catalog.definitionHelp")}</p>
      <section>
        <h2>{t("catalog.modules")}</h2>
        <label className="cv-check">
          <input
            type="checkbox"
            checked={cascade}
            onChange={(e) => setCascade(e.target.checked)}
          />
          {t("catalog.cascade")}
        </label>
        {modules.map((m) => (
          <label className="cv-check" key={m.id}>
            <input
              type="checkbox"
              checked={m.enabled}
              onChange={async (e) => {
                try {
                  await api(`/admin/modules/${m.id}`, "PUT", {
                    enabled: e.target.checked,
                    cascade,
                  });
                  await refresh();
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
            {t(`catalog.module.${m.id}`)}{" "}
            {!m.healthy && t("catalog.unavailable")}
          </label>
        ))}
      </section>
      <div className="cv-row">
        <label>
          {t("catalog.definitionVersion")}
          <select
            value=""
            onChange={(e) => {
              const v = versions.find((x) => x.id === Number(e.target.value));
              if (v) {
                change(structuredClone(v.document));
                setBase(v.state === "draft" ? v.base_version : definition!.id);
                if (v.state === "draft") setDraft(v.id);
              }
            }}
          >
            <option value="">{t("catalog.select")}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {t(`catalog.state.${v.state}`)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t("catalog.baseVersion")}: {base}
        </span>
      </div>
      <nav className="cv-tabs">
        {(
          ["types", "fields", "vocabularies", "relations", "templates"] as const
        ).map((k) => (
          <button
            key={k}
            className={tab === k ? "cv-primary" : ""}
            onClick={() => setTab(k)}
          >
            {t(`catalog.${k}`)}
          </button>
        ))}
      </nav>
      {tab === "types" && (
        <Dictionary
          value={d.types}
          onChange={(types) => change({ ...d, types })}
          create={() => ({
            names: {},
            kinds: ["work"],
            fields: [],
            template: "",
            enabled: true,
          })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <label className="cv-check">
                <input
                  type="checkbox"
                  checked={v.enabled}
                  onChange={(e) => set({ ...v, enabled: e.target.checked })}
                />
                {t("catalog.enabled")}
              </label>
              <Checks
                label={t("catalog.allowedKinds")}
                values={kindNames}
                selected={v.kinds}
                onChange={(kinds) => set({ ...v, kinds })}
              />
              <Checks
                label={t("catalog.fields")}
                values={names(d.fields)}
                selected={v.fields}
                onChange={(fields) => set({ ...v, fields })}
              />
              <label>
                {t("catalog.template")}
                <select
                  value={v.template}
                  onChange={(e) => set({ ...v, template: e.target.value })}
                >
                  <option value="">{t("catalog.none")}</option>
                  {Object.entries(names(d.templates)).map(([k, n]) => (
                    <option key={k} value={k}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        />
      )}
      {tab === "fields" && (
        <Dictionary
          value={d.fields}
          onChange={(fields) => change({ ...d, fields })}
          create={newField}
          render={(v, set) => (
            <FieldDefinition value={v} onChange={set} d={d} />
          )}
        />
      )}
      {tab === "vocabularies" && (
        <Dictionary
          value={d.vocabularies}
          onChange={(vocabularies) => change({ ...d, vocabularies })}
          create={() => ({ names: {}, terms: {} })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <Dictionary
                value={v.terms}
                onChange={(terms) => set({ ...v, terms })}
                create={() => ({ names: {}, enabled: true })}
                render={(term, change) => (
                  <>
                    <NamesEditor
                      value={term.names}
                      onChange={(names) => change({ ...term, names })}
                    />
                    <label className="cv-check">
                      <input
                        type="checkbox"
                        checked={term.enabled}
                        onChange={(e) =>
                          change({ ...term, enabled: e.target.checked })
                        }
                      />
                      {t("catalog.enabled")}
                    </label>
                  </>
                )}
              />
            </>
          )}
        />
      )}
      {tab === "relations" && (
        <Dictionary
          value={d.relations}
          onChange={(relations) => change({ ...d, relations })}
          create={() => ({
            names: {},
            reverse_names: {},
            source_kinds: ["agent"],
            target_kinds: ["work"],
            source_types: [],
            target_types: [],
            fields: [],
            symmetric: false,
            acyclic: false,
            max_outgoing: 0,
            max_incoming: 0,
            group: "",
            enabled: true,
          })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              <label>{t("catalog.reverseNames")}</label>
              <NamesEditor
                value={v.reverse_names}
                onChange={(reverse_names) => set({ ...v, reverse_names })}
              />
              {(
                [
                  "source_kinds",
                  "target_kinds",
                  "source_types",
                  "target_types",
                  "fields",
                ] as const
              ).map((k) => (
                <Checks
                  key={k}
                  label={t(`catalog.${k}`)}
                  values={
                    k.endsWith("kinds")
                      ? kindNames
                      : k === "fields"
                        ? names(d.fields)
                        : names(d.types)
                  }
                  selected={v[k]}
                  onChange={(values) => set({ ...v, [k]: values })}
                />
              ))}
              <div className="cv-checks">
                {(["enabled", "symmetric", "acyclic"] as const).map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={v[k]}
                      onChange={(e) => set({ ...v, [k]: e.target.checked })}
                    />
                    {t(`catalog.${k}`)}
                  </label>
                ))}
              </div>
              {(["max_outgoing", "max_incoming"] as const).map((k) => (
                <label key={k}>
                  {t(`catalog.${k}`)}
                  <input
                    type="number"
                    min="0"
                    value={v[k]}
                    onChange={(e) => set({ ...v, [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <label>
                {t("catalog.displayGroup")}
                <input
                  value={v.group}
                  onChange={(e) => set({ ...v, group: e.target.value })}
                />
              </label>
              <label>{t("catalog.groupNames")}</label>
              <NamesEditor
                value={v.group_names || {}}
                onChange={(group_names) => set({ ...v, group_names })}
              />
            </>
          )}
        />
      )}
      {tab === "templates" && (
        <Dictionary
          value={d.templates}
          onChange={(templates) => change({ ...d, templates })}
          create={() => ({
            names: {},
            sections: [],
            columns: [],
            relation_groups: [],
            directory: "tree",
            modules: [],
          })}
          render={(v, set) => (
            <>
              <NamesEditor
                value={v.names}
                onChange={(names) => set({ ...v, names })}
              />
              {v.sections.map((s, i) => (
                <fieldset key={i}>
                  <legend>
                    {t("catalog.section")} {i + 1}
                  </legend>
                  <NamesEditor
                    value={s.names}
                    onChange={(names) =>
                      set({
                        ...v,
                        sections: v.sections.map((x, j) =>
                          i === j ? { ...x, names } : x,
                        ),
                      })
                    }
                  />
                  <TextList
                    label={t("catalog.fieldOrder")}
                    value={s.fields}
                    onChange={(fields) =>
                      set({
                        ...v,
                        sections: v.sections.map((x, j) =>
                          i === j ? { ...x, fields } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set({
                        ...v,
                        sections: v.sections.filter((_, j) => i !== j),
                      })
                    }
                  >
                    {t("catalog.remove")}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() =>
                  set({
                    ...v,
                    sections: [...v.sections, { names: {}, fields: [] }],
                  })
                }
              >
                {t("catalog.addSection")}
              </button>
              <TextList
                label={t("catalog.columns")}
                value={v.columns}
                onChange={(columns) => set({ ...v, columns })}
              />
              <TextList
                label={t("catalog.relationGroups")}
                value={v.relation_groups}
                onChange={(relation_groups) => set({ ...v, relation_groups })}
              />
              <label>
                {t("catalog.directoryMode")}
                <select
                  value={v.directory}
                  onChange={(e) => set({ ...v, directory: e.target.value })}
                >
                  {["tree", "list", "discs"].map((k) => (
                    <option key={k} value={k}>
                      {t(`catalog.directoryModes.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <TextList
                label={t("catalog.badgeFields")}
                value={v.badge_fields || []}
                onChange={(badge_fields) => set({ ...v, badge_fields })}
              />
              <TextList
                label={t("catalog.facetFields")}
                value={v.facet_fields || []}
                onChange={(facet_fields) => set({ ...v, facet_fields })}
              />
              <label>
                {t("catalog.primaryDateField")}
                <input
                  value={v.primary_date_field || ""}
                  onChange={(e) =>
                    set({ ...v, primary_date_field: e.target.value })
                  }
                />
              </label>
              <Checks
                label={t("catalog.modules")}
                values={Object.fromEntries(
                  modules.map((m) => [m.id, t(`catalog.module.${m.id}`)]),
                )}
                selected={v.modules}
                onChange={(modules) => set({ ...v, modules })}
              />
            </>
          )}
        />
      )}
      <Evidence
        note={note}
        setNote={setNote}
        sources={sources}
        setSources={setSources}
      />
      <div className="cv-row">
        <button
          onClick={async () => {
            try {
              const r = await api("/admin/catalog-definitions", "POST", {
                document: d,
                base_version: base,
                edit_note: note,
                sources,
              });
              setDraft(r.id);
              setIssues(
                (await api(`/admin/catalog-definitions/${r.id}/impact`)).issues,
              );
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {t("catalog.saveDraft")}
        </button>
        {draft > 0 && (
          <button
            onClick={async () => {
              try {
                setIssues(
                  (await api(`/admin/catalog-definitions/${draft}/impact`))
                    .issues,
                );
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {t("catalog.impact")}
          </button>
        )}
        {draft > 0 && issues?.length === 0 && (
          <button
            className="cv-primary"
            onClick={async () => {
              try {
                await api(
                  `/admin/catalog-definitions/${draft}/publish`,
                  "POST",
                  { edit_note: note, sources },
                );
                await refresh();
                const current = await api<Definition>("/catalog/definitions");
                setD(structuredClone(current.document));
                setBase(current.id);
                setDraft(0);
                setIssues(undefined);
                setError("");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {t("catalog.publish")}
          </button>
        )}
      </div>
      {issues && (
        <section>
          <h2>{t("catalog.impact")}</h2>
          {issues.length ? (
            <ul>
              {issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>{t("catalog.noIssues")}</p>
          )}
        </section>
      )}
      <section>
        <h2>{t("catalog.smokeTitle")}</h2>
        <p className="cv-muted">{t("catalog.smokeDesc")}</p>
        {newTerms.length === 0 ? (
          <p className="cv-muted">{t("catalog.smokeNoNew")}</p>
        ) : (
          <div className="cv-row">
            <label>
              {t("catalog.smokePickVocab")}
              <select
                value={smokeVocab}
                onChange={(e) => {
                  setSmokeVocab(e.target.value);
                  setSmokeTerm("");
                }}
              >
                <option value="">{t("catalog.select")}</option>
                {Array.from(new Set(newTerms.map((x) => x.vocab))).map((vk) => (
                  <option key={vk} value={vk}>
                    {local(d?.vocabularies[vk]?.names, locale, "", vk)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("catalog.smokePickTerm")}
              <select
                value={smokeTerm}
                onChange={(e) => setSmokeTerm(e.target.value)}
              >
                <option value="">{t("catalog.select")}</option>
                {newTerms
                  .filter((x) => !smokeVocab || x.vocab === smokeVocab)
                  .map((x) => (
                    <option key={`${x.vocab}:${x.term}`} value={x.term}>
                      {local(
                        d?.vocabularies[x.vocab]?.terms[x.term]?.names,
                        locale,
                        "",
                        x.term,
                      )}{" "}
                      <small>({x.vocab}:{x.term})</small>
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={draft <= 0 || !smokeTerm}
              title={draft <= 0 ? t("catalog.smokeHint") : undefined}
              onClick={async () => {
                try {
                  setIssues(
                    (
                      await api(
                        `/admin/catalog-definitions/${draft}/impact`,
                      )
                    ).issues.filter((x: string) =>
                      smokeTerm ? x.includes(smokeTerm) : true,
                    ),
                  );
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {t("catalog.smokeRun")}
            </button>
          </div>
        )}
        {draft <= 0 && newTerms.length > 0 && (
          <p className="cv-muted">{t("catalog.smokeHint")}</p>
        )}
      </section>
    </>
  );
}
