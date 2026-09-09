"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { api, Entity } from "./api";
import { useCatalog } from "./CatalogProvider";
import { ErrorMessage } from "./Fields";
export default function ResourcePanel({
  entity,
  playback,
  media,
}: {
  entity: Entity;
  playback: boolean;
  media: boolean;
}) {
  const { t } = useI18n();
  const { user } = useCatalog();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [job, setJob] = useState<any>();
  useEffect(() => {
    if (!media || !job?.id || ["complete", "failed"].includes(job.status))
      return;
    const timer = setInterval(
      () =>
        api(`/media/jobs/${job.id}`)
          .then(setJob)
          .catch((e) => setError(e.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [job?.id, job?.status, media]);
  const load = () =>
    api(`/archive/entities/${entity.id}/resources`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [entity.id, user?.id]);
  return (
    <section>
      <h2>{t("catalog.module.archive")}</h2>
      <ErrorMessage error={error} />
      {items.map((r) => (
        <div key={r.id} className="cv-group">
          <p>
            {r.name} · {r.size} {t("catalog.bytes")}
          </p>
          <a href={`/api/archive/resources/${r.id}/content`}>
            {t("catalog.download")}
          </a>
          {playback &&
            /^(audio\/|video\/|image\/(jpeg|png|webp|gif)$)/.test(r.mime) && (
              <button onClick={() => setActive(active === r.id ? "" : r.id)}>
                {t(active === r.id ? "catalog.close" : "catalog.preview")}
              </button>
            )}
          {user && media && (
            <button
              onClick={async () => {
                try {
                  setJob(
                    await api(`/media/resources/${r.id}/jobs`, "POST", {
                      operation: "analyze",
                    }),
                  );
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {t("catalog.analyze")}
            </button>
          )}
          {active === r.id &&
            playback &&
            (r.mime.startsWith("audio/") ? (
              <audio
                controls
                src={`/api/playback/resources/${r.id}/content`}
              />
            ) : r.mime.startsWith("video/") ? (
              <video
                controls
                src={`/api/playback/resources/${r.id}/content`}
              />
            ) : (
              <img
                alt={r.name}
                src={`/api/playback/resources/${r.id}/content`}
              />
            ))}
        </div>
      ))}
      {media && job && (
        <div className="cv-group">
          <p>{t(`catalog.job.${job.status}`)}</p>
          {job.status === "complete" && (
            <dl>
              {Object.entries(job.result?.format || {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {user && (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            const form = ev.currentTarget;
            try {
              const data = new FormData(form);
              data.set("public", data.has("public") ? "true" : "false");
              await api(
                `/archive/entities/${entity.id}/resources`,
                "POST",
                data,
              );
              form.reset();
              await load();
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            {t("catalog.upload")}
            <input name="file" type="file" required />
          </label>
          <label className="cv-check">
            <input name="public" type="checkbox" />
            {t("catalog.publicFile")}
          </label>
          <button>{t("catalog.upload")}</button>
        </form>
      )}
    </section>
  );
}
