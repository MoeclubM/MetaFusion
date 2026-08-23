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

const MEDIA_CATEGORY_MAP_ZH: Record<string, string> = {
  audio: "音频",
  video: "视频",
  book: "图书",
  document: "文档",
  comic: "漫画",
  image: "画集 / 图册",
  picture: "图片",
  software: "程序",
  game: "交互程序",
  disc: "实体光盘",
  digital: "数字母带",
  broadcast: "电视首播 / 广播",
  paperback: "平装单行本",
  hardcover: "精装典藏本",
  stream: "网络流媒体",
  web: "网络发布",
};

const MEDIA_CATEGORY_MAP_EN: Record<string, string> = {
  audio: "Audio",
  video: "Video",
  book: "Book",
  document: "Document",
  comic: "Comic",
  image: "Artbook / Gallery",
  picture: "Picture",
  software: "Software",
  game: "Interactive Game",
  disc: "Physical Disc",
  digital: "Digital Master",
  broadcast: "TV / Radio Broadcast",
  paperback: "Paperback",
  hardcover: "Hardcover",
  stream: "Streaming",
  web: "Web",
};

const FORMAT_MAP_ZH: Record<string, string> = {
  cd: "CD (Compact Disc)",
  "blu-ray": "Blu-ray (蓝光光盘)",
  "4k ultra hd blu-ray": "4K UHD 蓝光",
  vinyl: "Vinyl (黑胶唱片)",
  sacd: "SACD / DSD 高解析",
  "hi-res flac": "Hi-Res FLAC 无损",
  "dvd-video": "DVD 影碟",
  "epub/pdf": "EPUB / PDF 电子书",
  cassette: "磁带 (Cassette Tape)",
  broadcast: "电视首播 / 广播",
  paperback: "平装单行本",
  hardcover: "精装典藏本",
  digital: "数字发行 / 母带",
  stream: "网络流媒体",
};

const FORMAT_MAP_EN: Record<string, string> = {
  cd: "CD (Compact Disc)",
  "blu-ray": "Blu-ray (BDMV)",
  "4k ultra hd blu-ray": "4K Ultra HD Blu-ray",
  vinyl: "Vinyl (12\" LP)",
  sacd: "SACD / DSD ISO",
  "hi-res flac": "Hi-Res FLAC (24/192)",
  "dvd-video": "DVD-Video",
  "epub/pdf": "EPUB / PDF",
  cassette: "Cassette Tape",
  broadcast: "TV / Radio Broadcast",
  paperback: "Paperback",
  hardcover: "Hardcover",
  digital: "Digital Master",
  stream: "Streaming",
};

export function formatMediaCategory(category?: string | null, locale = "zh-CN"): string {
  if (!category) return "";
  const key = category.toLowerCase().trim();
  if (locale === "en-US") {
    return MEDIA_CATEGORY_MAP_EN[key] || category;
  }
  return MEDIA_CATEGORY_MAP_ZH[key] || category;
}

export function formatMediaFormat(format?: string | null, locale = "zh-CN"): string {
  if (!format) return "";
  const key = format.toLowerCase().trim();
  if (locale === "en-US") {
    return FORMAT_MAP_EN[key] || format;
  }
  return FORMAT_MAP_ZH[key] || format;
}

