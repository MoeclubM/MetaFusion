"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity, Field, local, Names, Source, title } from "./api";
import { useCatalog } from "./CatalogProvider";
export function NamesEditor({
  value,
  onChange,
}: {
  value: Names;
  onChange: (v: Names) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="cv-grid">
      {["zh-CN", "en-US"].map((loc) => (
        <label key={loc}>
          {t(`catalog.${loc}`)}
          <input
            value={value?.[loc] || ""}
            onChange={(e) => onChange({ ...value, [loc]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
export function EntityPicker({
  value,
  onChange,
  kinds,
  query = "",
}: {
  value: string;
  onChange: (id: string) => void;
  kinds?: string[];
  query?: string;
}) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (!value) {
      setSelected(undefined);
      return;
    }
    api<Entity>(`/catalog/entities/${value}`)
      .then((x) => {
        if (active) setSelected(x);
      })
      .catch(() => {
        if (active) setSelected(undefined);
      });
    return () => {
      active = false;
    };
  }, [value]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ q: search, limit: "30" });
      if (kinds?.length === 1) qs.set("kind", kinds[0]);
      api<{ items: Entity[] }>(`/catalog/entities?${qs}${query}`)
        .then((r) => {
          if (active) {
            setItems(
              r.items.filter((x) => !kinds?.length || kinds.includes(x.kind)),
            );
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, JSON.stringify(kinds), query]);
  return (
    <div className="cv-picker">
      <input
        aria-label={t("catalog.searchEntity")}
        value={search}
        placeholder={
          selected ? title(selected, locale) : t("catalog.searchEntity")
        }
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={t("catalog.selectEntity")}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("catalog.none")}</option>
        {selected && !items.some((x) => x.id === selected.id) && (
          <option value={selected.id}>{title(selected, locale)}</option>
        )}
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {title(x, locale)} · {t(`catalog.kind.${x.kind}`)}
          </option>
        ))}
      </select>
      {error && (
        <small className="cv-error">{t("catalog.connectionError")}</small>
      )}
    </div>
  );
}
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: any;
  onChange: (v: any) => void;
}) {
  const { definition } = useCatalog();
  const { t, locale } = useI18n();
  if (!definition) return null;
  if (field.type === "entity")
    return (
      <EntityPicker
        kinds={field.kinds}
        value={value || ""}
        onChange={onChange}
      />
    );
  if (field.type === "boolean")
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (field.type === "multilingual")
    return <NamesEditor value={value || {}} onChange={onChange} />;
  if (field.type === "enum")
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("catalog.none")}</option>
        {Object.entries(
          definition.document.vocabularies[field.vocabulary || ""]?.terms || {},
        )
          .filter(([k, v]) => v.enabled || k === value)
          .map(([k, v]) => (
            <option value={k} key={k}>
              {local(v.names, locale, "", k)}
            </option>
          ))}
      </select>
    );
  if (field.type === "group")
    return (
      <div className="cv-group">
        {Object.entries(field.fields || {}).map(([k, f]) => (
          <label key={k}>
            {local(f.names, locale, "", k)}
            <FieldInput
              field={f}
              value={value?.[k]}
              onChange={(v) => onChange({ ...value, [k]: v })}
            />
          </label>
        ))}
      </div>
    );
  if (field.type === "list" && field.items)
    return (
      <div className="cv-group">
        {(value || []).map((v: any, i: number) => (
          <div key={i} className="cv-row">
            <FieldInput
              field={field.items!}
              value={v}
              onChange={(x) =>
                onChange(value.map((a: any, j: number) => (i === j ? x : a)))
              }
            />
            <button
              type="button"
              onClick={() =>
                onChange(value.filter((_: any, j: number) => i !== j))
              }
            >
              {t("catalog.remove")}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange([
              ...(value || []),
              field.items?.type === "group" ||
              field.items?.type === "multilingual"
                ? {}
                : "",
            ])
          }
        >
          {t("catalog.add")}
        </button>
      </div>
    );
  return (
    <input
      type={
        field.type === "number"
          ? "number"
          : field.type === "url"
            ? "url"
            : "text"
      }
      min={field.min}
      max={field.max}
      step="any"
      value={value ?? ""}
      onChange={(e) =>
        onChange(
          field.type === "number"
            ? e.target.value === ""
              ? null
              : Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}
export function FieldValue({ field, value }: { field?: Field; value: any }) {
  const { definition } = useCatalog();
  const { locale, t } = useI18n();
  if (value === null || value === undefined || value === "")
    return <span>—</span>;
  if (field?.type === "entity") return <EntityLink id={value} />;
  if (field?.type === "multilingual")
    return <span>{local(value, locale)}</span>;
  if (field?.type === "enum")
    return (
      <span>
        {local(
          definition?.document.vocabularies[field.vocabulary || ""]?.terms[
            value
          ]?.names,
          locale,
          "",
          String(value),
        )}
      </span>
    );
  if (typeof value === "boolean")
    return <span>{t(value ? "catalog.yes" : "catalog.no")}</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <FieldValue field={field?.items} value={v} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{local(field?.fields?.[k]?.names, locale, "", k)}</dt>
            <dd>
              <FieldValue field={field?.fields?.[k]} value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  if (field?.type === "url" && /^https?:\/\//.test(value))
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  return (
    <span>
      {String(value)} {local(field?.unit, locale)}
    </span>
  );
}
export function EntityLink({ id }: { id: string }) {
  const [e, setE] = useState<Entity>();
  const { locale, t } = useI18n();
  useEffect(() => {
    let active = true;
    api<Entity>(`/catalog/entities/${id}/resolve`)
      .then((x) => {
        if (active) setE(x);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <Link href={`/catalog/${e?.id || id}`}>
      {e ? title(e, locale) : t("catalog.entityReference")}
    </Link>
  );
}
export function Evidence({
  note,
  setNote,
  sources,
  setSources,
}: {
  note: string;
  setNote: (s: string) => void;
  sources: Source[];
  setSources: (s: Source[]) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset>
      <legend>{t("catalog.evidence")}</legend>
      <label>
        {t("catalog.editNote")}
        <textarea
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {sources.map((s, i) => (
        <div className="cv-group" key={i}>
          <select
            aria-label={t("catalog.sourceKind")}
            value={s.kind}
            onChange={(e) =>
              setSources(
                sources.map((x, j) =>
                  i === j ? { ...x, kind: e.target.value } : x,
                ),
              )
            }
          >
            {["self", "url", "publication"].map((k) => (
              <option key={k} value={k}>
                {t(`catalog.source.${k}`)}
              </option>
            ))}
          </select>
          <input
            required
            aria-label={t("catalog.citation")}
            placeholder={t("catalog.citation")}
            value={s.citation}
            onChange={(e) =>
              setSources(
                sources.map((x, j) =>
                  i === j ? { ...x, citation: e.target.value } : x,
                ),
              )
            }
          />
          <input
            type="url"
            aria-label={t("catalog.sourceUrl")}
            placeholder={t("catalog.sourceUrl")}
            required={s.kind === "url"}
            value={s.url || ""}
            onChange={(e) =>
              setSources(
                sources.map((x, j) =>
                  i === j ? { ...x, url: e.target.value } : x,
                ),
              )
            }
          />
          {sources.length > 1 && (
            <button
              type="button"
              onClick={() => setSources(sources.filter((_, j) => i !== j))}
            >
              {t("catalog.remove")}
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setSources([...sources, { kind: "url", citation: "" }])}
      >
        {t("catalog.addSource")}
      </button>
    </fieldset>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  const { t } = useI18n();
  return error ? (
    <p role="alert" className="cv-error">
      {t("catalog.requestError")} <code>{error}</code>
    </p>
  ) : null;
}
