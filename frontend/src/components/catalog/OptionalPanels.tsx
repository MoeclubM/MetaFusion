"use client";
import dynamic from "next/dynamic";
import { Entity } from "./api";
import { useCatalog } from "./CatalogProvider";
import { getStorageEntityUrl } from "@/lib/services";
import { useI18n } from "@/i18n/I18nProvider";
const ResourcePanel = dynamic(() => import("./ResourcePanel"));
const PersonalPanel = dynamic(() =>
  import("./RecordPanels").then((m) => m.PersonalPanel),
);
export function OptionalPanels({ entity }: { entity: Entity }) {
  const { modules, user } = useCatalog();
  const { t } = useI18n();
  const enabled = (id: string) =>
    modules.some((m) => m.id === id && m.enabled && m.healthy);
  return (
    <>
      {enabled("archive") && (
        <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] text-xs space-y-1">
          <div className="font-semibold text-sky-600 dark:text-sky-400">{t("catalog.resourceGatewayTitle")}</div>
          <p className="text-gray-500">{t("catalog.resourceGatewayDesc")}</p>
          <a href={getStorageEntityUrl(entity.id)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-block pt-1">
            {t("catalog.resourceGatewayVisit")}
          </a>
        </div>
      )}{" "}
      {user && enabled("records") && <PersonalPanel entity={entity} />}
    </>
  );
}
