"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity } from "./api";
import { useCatalog } from "./CatalogProvider";
import { ErrorMessage } from "./Fields";
export function PersonalPanel({ entity }: { entity: Entity }) {
  const { t } = useI18n();
  const [v, setV] = useState({
    favorite: false,
    owned: false,
    rating: 0,
    progress: "",
  });
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/records/entities/${entity.id}`)
      .then((r) => setV((x) => ({ ...x, ...r })))
      .catch((e) => setError(e.message));
  }, [entity.id]);
  return (
    <section>
      <h2>{t("catalog.module.records")}</h2>
      <ErrorMessage error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/records/entities/${entity.id}`, "PUT", v);
            setError("");
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {(["favorite", "owned"] as const).map((k) => (
          <label className="cv-check" key={k}>
            <input
              type="checkbox"
              checked={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.checked })}
            />
            {t(`catalog.${k}`)}
          </label>
        ))}
        <label>
          {t("catalog.rating")}
          <input
            type="number"
            min="0"
            max="10"
            value={v.rating}
            onChange={(e) => setV({ ...v, rating: Number(e.target.value) })}
          />
        </label>
        <label>
          {t("catalog.progress")}
          <input
            maxLength={1000}
            value={v.progress}
            onChange={(e) => setV({ ...v, progress: e.target.value })}
          />
        </label>
        <button>{t("catalog.save")}</button>
      </form>
    </section>
  );
}
