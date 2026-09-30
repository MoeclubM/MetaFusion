"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { formatDuration } from "@/lib/duration";
import { orderedTracksWithDepth } from "@/lib/trackTree";
import { Entity, title } from "./api";
import { InclusionContents } from "./InclusionContents";

/** 通用详情保留父子轨、正式编号与每条轨道实际收录的表达。 */
export function TrackDirectory({ tracks, expressions, loading, titleOrder }: {
  tracks: Entity[];
  expressions: Record<string, Entity>;
  loading?: boolean;
  titleOrder?: string[];
}) {
  const { locale } = useI18n();
  return (
    <div className="divide-y divide-line-subtle">
      {orderedTracksWithDepth(tracks).map(({ track, depth }) => {
        const duration = formatDuration(Number(track.attributes?.duration));
        return (
          <div key={track.id} className="px-4 py-3 space-y-1.5" style={depth ? { paddingLeft: `${16 + depth * 16}px` } : undefined}>
            <div className="flex items-start justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="shrink-0 font-mono text-text-muted">{track.number || track.position}</span>
                <Link href={`/catalog/${track.id}`} className="font-medium text-text-strong hover:text-primary">
                  {title(track, locale, titleOrder)}
                </Link>
              </div>
              {duration && <span className="shrink-0 font-mono text-text-muted">{duration}</span>}
            </div>
            <div className="pl-5"><InclusionContents contents={track.contents} expressions={expressions} loading={loading} /></div>
          </div>
        );
      })}
    </div>
  );
}
