export type MediaType = "movie" | "tv_series" | "anime" | "music" | "audiobook" | "novel" | "comic" | "gallery" | string;

export function mediumLabel(mediaType: MediaType, t?: (k: string) => string): string {
  if (t) {
    switch (mediaType) {
      case "movie": case "anime": case "tv_series": return t("media.disc");
      case "music": case "audiobook": return t("media.disc");
      case "novel": return t("media.volume");
      case "comic": return t("media.reel");
      case "gallery": return t("media.volume");
      default: return t("media.carrier");
    }
  }
  switch (mediaType) {
    case "movie": case "anime": case "tv_series": return "碟";
    case "music": case "audiobook": return "碟";
    case "novel": return "册";
    case "comic": return "卷";
    case "gallery": return "册";
    default: return "载体";
  }
}

export function entryLabel(mediaType: MediaType, t?: (k: string) => string): string {
  if (t) {
    switch (mediaType) {
      case "music": case "audiobook": return t("media.track");
      case "movie": case "tv_series": case "anime": return t("media.episode");
      case "novel": return t("media.chapter");
      case "comic": return t("media.talk");
      case "gallery": return t("media.page");
      default: return t("media.entry");
    }
  }
  switch (mediaType) {
    case "music": case "audiobook": return "曲目";
    case "movie": case "tv_series": case "anime": return "分集";
    case "novel": return "章节";
    case "comic": return "话";
    case "gallery": return "页";
    default: return "条目";
  }
}

export function carrierLabel(t?: (k: string, v?: Record<string, string|number>) => string): string {
  return t ? t("media.carrierLabel") : "载体";
}

export function entryRowHeader(mediaType: MediaType, t?: (k: string, v?: Record<string, string|number>) => string): string {
  const label = entryLabel(mediaType, t as any);
  return t ? t("media.entryRow", { label }) : `${label} / 母版条目`;
}
