"use client";
import dynamic from "next/dynamic";
import { Entity } from "./api";
import { useCatalog } from "./CatalogProvider";
import { getStorageEntityUrl } from "@/lib/services";
const ResourcePanel = dynamic(() => import("./ResourcePanel"));
const CommunityPanel = dynamic(() =>
  import("./RecordPanels").then((m) => m.CommunityPanel),
);
const PersonalPanel = dynamic(() =>
  import("./RecordPanels").then((m) => m.PersonalPanel),
);
export function OptionalPanels({ entity }: { entity: Entity }) {
  const { modules, user } = useCatalog();
  const enabled = (id: string) =>
    modules.some((m) => m.id === id && m.enabled && m.healthy);
  return (
    <>
      {enabled("archive") && (
        <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] text-xs space-y-1">
          <div className="font-semibold text-sky-600 dark:text-sky-400">独立资源存储中心</div>
          <p className="text-gray-500">元数据与存储服务已解耦，大文件与媒体镜像由独立资源中心托管。</p>
          <a href={getStorageEntityUrl(entity.id)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-block pt-1">
            前往资源中心获取下载 →
          </a>
        </div>
      )}{" "}
      {enabled("community") && <CommunityPanel entity={entity} />}{" "}
      {user && enabled("records") && <PersonalPanel entity={entity} />}
    </>
  );
}
