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
      <h2>{t("catalogV2.module.archive")}</h2>
      <ErrorMessage error={error} />
      {items.map((r) => (
        <div key={r.id} className="cv-group">
          <p>
            {r.name} · {r.size} {t("catalogV2.bytes")}
          </p>
          <a href={`/api/v2/archive/resources/${r.id}/content`}>
            {t("catalogV2.download")}
          </a>
          {playback &&
            /^(audio\/|video\/|image\/(jpeg|png|webp|gif)$)/.test(r.mime) && (
              <button onClick={() => setActive(active === r.id ? "" : r.id)}>
                {t(active === r.id ? "catalogV2.close" : "catalogV2.preview")}
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
              {t("catalogV2.analyze")}
            </button>
          )}
          {active === r.id &&
            playback &&
            (r.mime.startsWith("audio/") ? (
              <audio
                controls
                src={`/api/v2/playback/resources/${r.id}/content`}
              />
            ) : r.mime.startsWith("video/") ? (
              <video
                controls
                src={`/api/v2/playback/resources/${r.id}/content`}
              />
            ) : (
              <img
                alt={r.name}
                src={`/api/v2/playback/resources/${r.id}/content`}
              />
            ))}
        </div>
      ))}
      {media && job && (
        <div className="cv-group">
          <p>{t(`catalogV2.job.${job.status}`)}</p>
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
            {t("catalogV2.upload")}
            <input name="file" type="file" required />
          </label>
          <label className="cv-check">
            <input name="public" type="checkbox" />
            {t("catalogV2.publicFile")}
          </label>
          <button>{t("catalogV2.upload")}</button>
        </form>
      )}
    </section>
  );
}
