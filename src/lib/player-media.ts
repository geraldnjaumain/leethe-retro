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

export type DownloadOption = {
  quality: string;
  resolution: number;
  audioLabel?: string;
};

export type CaptionCandidate = {
  id: string;
  label: string;
  lang: string;
  url: string;
};

export type PlaybackPreferences = {
  autoplayVideo: boolean;
  autoplayNext: boolean;
  playbackRate: number;
};

export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  autoplayVideo: true,
  autoplayNext: true,
  playbackRate: 1,
};

const PLAYBACK_RATES = new Set([0.5, 0.75, 1, 1.25, 1.5, 2]);

export function normalizePlaybackPreferences(value: unknown): PlaybackPreferences {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const playbackRate = Number(record.playbackRate);
  return {
    autoplayVideo:
      typeof record.autoplayVideo === "boolean"
        ? record.autoplayVideo
        : DEFAULT_PLAYBACK_PREFERENCES.autoplayVideo,
    autoplayNext:
      typeof record.autoplayNext === "boolean"
        ? record.autoplayNext
        : DEFAULT_PLAYBACK_PREFERENCES.autoplayNext,
    playbackRate: PLAYBACK_RATES.has(playbackRate)
      ? playbackRate
      : DEFAULT_PLAYBACK_PREFERENCES.playbackRate,
  };
}

export function nextEpisodeTarget(
  activeSeason: number | undefined,
  activeEpisode: number | undefined,
  episodes: Array<{ episode_number: number }>,
  seasons: Array<{ season_number: number }>,
) {
  if (!activeSeason || !activeEpisode) return null;
  const currentEpisodeIndex = episodes.findIndex(
    (episode) => episode.episode_number === activeEpisode,
  );
  if (currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length - 1) {
    return {
      season: activeSeason,
      episode: episodes[currentEpisodeIndex + 1].episode_number,
    };
  }

  const orderedSeasons = seasons
    .filter((season) => season.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const currentSeasonIndex = orderedSeasons.findIndex(
    (season) => season.season_number === activeSeason,
  );
  if (currentSeasonIndex >= 0 && currentSeasonIndex < orderedSeasons.length - 1) {
    return { season: orderedSeasons[currentSeasonIndex + 1].season_number, episode: 1 };
  }
  return null;
}

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

export function episodeDownloadFileName(
  title: string,
  season: number,
  episode: number,
  label: string,
  quality?: string,
) {
  const series = safeFilePart(title) || "leethe-series";
  const episodeLabel = safeFilePart(label) || `Episode-${episode}`;
  const number = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  return `${series}-${number}-${episodeLabel}${quality ? `-${safeFilePart(quality)}` : ""}.mp4`;
}

export function selectPreferredDownloadOption<T extends DownloadOption>(
  options: T[],
  preferredQuality: string,
  preferredAudio: string,
) {
  if (!options.length) return undefined;
  const audioOptions =
    preferredAudio === "Any"
      ? options
      : options.filter((option) => (option.audioLabel?.trim() || "Default") === preferredAudio);
  const candidates = audioOptions.length ? audioOptions : options;
  const exact = candidates.find((option) => option.quality === preferredQuality);
  if (exact) return exact;

  const preferredResolution = Number.parseInt(preferredQuality, 10);
  if (!Number.isFinite(preferredResolution)) return candidates[0];
  return [...candidates].sort((left, right) => {
    const distance = Math.abs(left.resolution - preferredResolution);
    const otherDistance = Math.abs(right.resolution - preferredResolution);
    return distance - otherDistance || right.resolution - left.resolution;
  })[0];
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
