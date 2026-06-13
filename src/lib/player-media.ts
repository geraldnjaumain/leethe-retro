export type PlayerStream = {
  url: string;
  resolution: number;
  quality?: string;
  codecName?: string;
  title?: string;
  audioLabel?: string;
  languageCode?: string;
  resourceId?: string;
};

export type StreamPreference = {
  url?: string;
  resourceId?: string;
  resolution?: number;
  audioKey?: string;
};

export type CaptionCandidate = {
  id: string;
  label: string;
  lang: string;
  url: string;
};

export function isDirectDownload(url: string | undefined) {
  return Boolean(url) && !/\.m3u8(?:[?#]|$)/i.test(url || "");
}

function safeFilePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export function downloadFileName(
  title: string,
  quality?: string,
  season?: number,
  episode?: number,
) {
  const episodePart = season && episode ? `-S${season}E${episode}` : "";
  return `${safeFilePart(title) || "leethe-download"}${episodePart}${quality ? `-${safeFilePart(quality)}` : ""}.mp4`;
}

export function audioKey(stream: PlayerStream | undefined) {
  if (!stream) return "default";
  const label = (stream.audioLabel || "").trim().toLowerCase();
  const code = (stream.languageCode || "").trim().toLowerCase();
  return label || code ? `${label}|${code}` : "default";
}

function isLikelyHevcStream(stream: PlayerStream | undefined) {
  if (!stream) return false;
  return /\bhevc\b|\bh\.?265\b|\/h265\//i.test(
    [stream.codecName, stream.title, stream.url].filter(Boolean).join(" "),
  );
}

export function findPreferredStreamIndex(
  streams: PlayerStream[],
  preference: StreamPreference | null,
) {
  if (!streams.length) return 0;
  if (!preference) return 0;
  const hasCompatibleStream = streams.some((stream) => !isLikelyHevcStream(stream));

  const exact = streams.findIndex(
    (stream) =>
      (preference.resourceId && stream.resourceId === preference.resourceId) ||
      (preference.url && stream.url === preference.url),
  );
  if (exact >= 0 && !(hasCompatibleStream && isLikelyHevcStream(streams[exact]))) return exact;

  const byQualityAndAudio = streams.findIndex(
    (stream) =>
      stream.resolution === preference.resolution && audioKey(stream) === preference.audioKey,
  );
  if (byQualityAndAudio >= 0) return byQualityAndAudio;

  const byQuality = streams.findIndex((stream) => stream.resolution === preference.resolution);
  if (byQuality >= 0) return byQuality;

  const byAudio = streams.findIndex((stream) => audioKey(stream) === preference.audioKey);
  return byAudio >= 0 ? byAudio : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanCaptionUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeCaptionCandidates(value: unknown): CaptionCandidate[] {
  const captions = Array.isArray(value) ? value : [];
  return captions
    .map((caption, index): CaptionCandidate | null => {
      if (typeof caption === "string") {
        const url = cleanCaptionUrl(caption);
        return url
          ? { id: `caption-${index}`, label: `Subtitle ${index + 1}`, lang: "en", url }
          : null;
      }
      if (!isRecord(caption)) return null;
      const url =
        cleanCaptionUrl(caption.url) ||
        cleanCaptionUrl(caption.file) ||
        cleanCaptionUrl(caption.src) ||
        cleanCaptionUrl(caption.path) ||
        cleanCaptionUrl(caption.link) ||
        cleanCaptionUrl(caption.captionUrl) ||
        cleanCaptionUrl(caption.resourceLink);
      if (!url) return null;
      const lang = String(
        caption.langCode || caption.lanCode || caption.lang || caption.lan || "en",
      ).slice(0, 12);
      const label = String(
        caption.label ||
          caption.name ||
          caption.title ||
          caption.lanName ||
          caption.language ||
          caption.lang ||
          `Subtitle ${index + 1}`,
      ).slice(0, 64);
      return { id: `caption-${index}-${lang}-${url.length}`, label, lang, url };
    })
    .filter((caption): caption is CaptionCandidate => Boolean(caption));
}

export function looksLikeSrt(url: string) {
  return /\.srt(?:[?#]|$)/i.test(url);
}

export function srtToVtt(raw: string) {
  const normalized = raw.replace(/\r+/g, "").replace(/\{\\an\d+\}/g, "");
  const body = normalized
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}[,.]\d{3})/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  const cleaned = body.trim();
  return cleaned.startsWith("WEBVTT") ? cleaned : `WEBVTT\n\n${cleaned}`;
}
