"use client";
import dynamic from "next/dynamic";
import { Entity } from "./api";
import { useCatalog } from "./CatalogProvider";
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
        <ResourcePanel
          entity={entity}
          playback={enabled("playback")}
          media={enabled("media")}
        />
      )}{" "}
      {enabled("community") && <CommunityPanel entity={entity} />}{" "}
      {user && enabled("records") && <PersonalPanel entity={entity} />}
    </>
  );
}
