import { getMessages, translate } from "@/i18n/getMessages";

export type MediaType = "movie" | "tv_series" | "anime" | "music" | "audiobook" | "novel" | "comic" | "gallery" | string;

export function mediumLabel(mediaType: MediaType, t?: (k: string) => string): string {
  const trans = t || ((k: string) => translate(getMessages(), k));
  switch (mediaType) {
    case "movie": case "anime": case "tv_series": return trans("media.disc");
    case "music": case "audiobook": return trans("media.disc");
    case "novel": return trans("media.volume");
    case "comic": return trans("media.reel");
    case "gallery": return trans("media.volume");
    default: return trans("media.carrier");
  }
}

export function entryLabel(mediaType: MediaType, t?: (k: string) => string): string {
  const trans = t || ((k: string) => translate(getMessages(), k));
  switch (mediaType) {
    case "music": case "audiobook": return trans("media.track");
    case "movie": case "tv_series": case "anime": return trans("media.episode");
    case "novel": return trans("media.chapter");
    case "comic": return trans("media.talk");
    case "gallery": return trans("media.page");
    default: return trans("media.entry");
  }
}

export function carrierLabel(t?: (k: string, v?: Record<string, string|number>) => string): string {
  const trans = t || ((k: string, v?: Record<string, string|number>) => translate(getMessages(), k, v));
  return trans("media.carrierLabel");
}

export function entryRowHeader(mediaType: MediaType, t?: (k: string, v?: Record<string, string|number>) => string): string {
  const trans = t || ((k: string, v?: Record<string, string|number>) => translate(getMessages(), k, v));
  const label = entryLabel(mediaType, t as any);
  return trans("media.entryRow", { label });
}
