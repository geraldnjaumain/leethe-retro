import { createServerFn } from "@tanstack/react-start";
import type { DirectStreamResult } from "./moviebox.server";
import { streamRateLimitMiddleware } from "./rate-limit";
import type { MediaType } from "./tmdb";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ResolveWatchStreamsInput = {
  title: string;
  type: MediaType;
  tmdbId?: string;
  year?: string;
  runtimeMinutes?: number;
  seasonCount?: number;
  season?: number;
  episode?: number;
  subjectId?: string;
};

export type EpisodeDownloadRequest = {
  season: number;
  episode: number;
  label?: string;
};

export type ResolveEpisodeDownloadsInput = Omit<
  ResolveWatchStreamsInput,
  "type" | "season" | "episode"
> & {
  type: "tv";
  episodes: EpisodeDownloadRequest[];
};

function positiveInt(value: unknown, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, parsed) : undefined;
}

export function validateStreamInput(raw: unknown): ResolveWatchStreamsInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 180) : "";
  if (!title) throw new Error("A title is required to resolve a stream.");

  const type = value.type === "tv" ? "tv" : "movie";
  return {
    title,
    type,
    tmdbId:
      typeof value.tmdbId === "string" && /^\d{1,12}$/.test(value.tmdbId.trim())
        ? value.tmdbId.trim()
        : undefined,
    year:
      typeof value.year === "string" && /^(18|19|20|21)\d{2}$/.test(value.year.trim())
        ? value.year.trim()
        : undefined,
    runtimeMinutes: positiveInt(value.runtimeMinutes, 1_000),
    seasonCount: positiveInt(value.seasonCount, 999),
    season: positiveInt(value.season, 999),
    episode: positiveInt(value.episode, 10_000),
    subjectId:
      typeof value.subjectId === "string" && /^\d{1,24}$/.test(value.subjectId.trim())
        ? value.subjectId.trim()
        : undefined,
  };
}

export const resolveWatchStreams = createServerFn({ method: "POST" })
  .middleware([streamRateLimitMiddleware])
  .inputValidator(validateStreamInput)
  .handler(async ({ data }): Promise<DirectStreamResult> => {
    const { getServerConfig } = await import("./config.server");
    if (!getServerConfig().externalStreamResolverEnabled) {
      return {
        success: false,
        streams: [],
        error:
          "Streaming is disabled until the operator enables the resolver and confirms distribution rights.",
      };
    }
    const { resolveStreams } = await import("./moviebox.server");
    const releaseYear = data.year ? Number.parseInt(data.year, 10) : undefined;
    return resolveStreams(
      data.title,
      data.type,
      data.tmdbId,
      data.season,
      data.episode,
      Number.isFinite(releaseYear) ? releaseYear : undefined,
      data.subjectId,
      data.runtimeMinutes,
      data.seasonCount,
    );
  });

function validateEpisodeDownloadsInput(raw: unknown): ResolveEpisodeDownloadsInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = validateStreamInput({ ...value, type: "tv" });
  const episodes = (Array.isArray(value.episodes) ? value.episodes : [])
    .slice(0, 60)
    .map((episode): EpisodeDownloadRequest | null => {
      const item =
        episode && typeof episode === "object" ? (episode as Record<string, unknown>) : {};
      const season = positiveInt(item.season, 999);
      const episodeNumber = positiveInt(item.episode, 10_000);
      if (!season || !episodeNumber) return null;
      return {
        season,
        episode: episodeNumber,
        label: typeof item.label === "string" ? item.label.trim().slice(0, 180) : undefined,
      };
    })
    .filter((episode): episode is EpisodeDownloadRequest => Boolean(episode));
  if (!episodes.length) throw new Error("Choose at least one episode to prepare.");
  return { ...base, type: "tv", episodes };
}

function downloadableStreams<T extends { url: string; resolution: number }>(streams: T[]) {
  return streams.filter((stream) => !/\.m3u8(?:[?#]|$)/i.test(stream.url));
}

export const resolveEpisodeDownloads = createServerFn({ method: "POST" })
  .middleware([streamRateLimitMiddleware])
  .inputValidator(validateEpisodeDownloadsInput)
  .handler(async ({ data }) => {
    const { getServerConfig } = await import("./config.server");
    if (!getServerConfig().externalStreamResolverEnabled) {
      throw new Error("External downloads are unavailable.");
    }
    const { resolveStreams } = await import("./moviebox.server");
    const releaseYear = data.year ? Number.parseInt(data.year, 10) : undefined;
    let subjectId = data.subjectId;

    const resolveEpisode = async (request: EpisodeDownloadRequest) => {
      const result = await resolveStreams(
        data.title,
        "tv",
        data.tmdbId,
        request.season,
        request.episode,
        Number.isFinite(releaseYear) ? releaseYear : undefined,
        subjectId,
        data.runtimeMinutes,
        data.seasonCount,
      );
      subjectId ||= result.subjectId;
      const streams = downloadableStreams(result.streams);
      return {
        season: request.season,
        episode: request.episode,
        label: request.label || `S${request.season}E${request.episode}`,
        success: streams.length > 0,
        options: streams.map((stream) => ({
          url: stream.url,
          quality: stream.quality,
          resolution: stream.resolution,
          audioLabel: stream.audioLabel,
          size: stream.size,
        })),
        error: streams.length ? undefined : result.error || "No downloadable source was found.",
      };
    };

    const [first, ...rest] = data.episodes;
    const prepared = [await resolveEpisode(first)];
    for (let index = 0; index < rest.length; index += 4) {
      prepared.push(...(await Promise.all(rest.slice(index, index + 4).map(resolveEpisode))));
    }
    return { subjectId, downloads: prepared };
  });

export const resolveStreamCaptions = createServerFn({ method: "POST" })
  .middleware([streamRateLimitMiddleware])
  .inputValidator((raw: unknown) => {
    const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const subjectId = typeof value.subjectId === "string" ? value.subjectId.trim() : "";
    const resourceId = typeof value.resourceId === "string" ? value.resourceId.trim() : "";
    if (!/^\d{1,24}$/.test(subjectId) || !resourceId || resourceId.length > 80) {
      throw new Error("Invalid caption request.");
    }
    return {
      subjectId,
      resourceId,
    };
  })
  .handler(async ({ data }) => {
    const { getServerConfig } = await import("./config.server");
    if (!getServerConfig().externalStreamResolverEnabled) return [];
    const { getAsyncCaptions } = await import("./moviebox.server");
    return JSON.parse(
      JSON.stringify(await getAsyncCaptions(data.subjectId, data.resourceId)),
    ) as JsonValue[];
  });

function privateLiteralHostname(hostname: string) {
  if (hostname.includes(":")) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const [a, b] = hostname.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function validateSubtitleUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 2_048) throw new Error("Invalid subtitle URL.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid subtitle URL.");
  }
  const hostname = url.hostname.toLowerCase();
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    privateLiteralHostname(normalizedHostname)
  ) {
    throw new Error("Invalid subtitle URL.");
  }
  url.hash = "";
  return url.toString();
}

export const proxySubtitle = createServerFn({ method: "GET" })
  .middleware([streamRateLimitMiddleware])
  .inputValidator(validateSubtitleUrl)
  .handler(async ({ data }) => {
    try {
      const { getServerConfig } = await import("./config.server");
      if (!getServerConfig().externalStreamResolverEnabled) return "";
      const { fetchSubtitleText } = await import("./subtitle-proxy.server");
      return await fetchSubtitleText(data);
    } catch {
      return "";
    }
  });

export function validateSkipSegmentsInput(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tmdbId =
    typeof value.tmdbId === "string" ? value.tmdbId.trim() : String(value.tmdbId ?? "");
  if (!/^\d{1,12}$/.test(tmdbId)) throw new Error("Invalid title id.");
  const mediaType: MediaType = value.mediaType === "tv" ? "tv" : "movie";
  const season = positiveInt(value.season, 999);
  const episode = positiveInt(value.episode, 10_000);
  if (mediaType === "tv" && (!season || !episode)) throw new Error("Invalid episode.");
  return { tmdbId, mediaType, season, episode };
}

export const resolveSkipSegments = createServerFn({ method: "POST" })
  .middleware([streamRateLimitMiddleware])
  .inputValidator(validateSkipSegmentsInput)
  .handler(async ({ data }) => {
    try {
      const { tmdbId, mediaType, season, episode } = data;
      const { tmdbCachedRequest } = await import("./tmdb-cache.server");
      const tmdbData = await tmdbCachedRequest<{ imdb_id?: string }>(
        `/${mediaType}/${tmdbId}/external_ids`,
      );
      const imdbId = tmdbData.imdb_id;

      if (!imdbId) return [];

      const url = new URL("/segments", "https://api.introdb.app");
      url.searchParams.set("imdb_id", imdbId);
      if (mediaType === "tv") {
        if (!season || !episode) return [];
        url.searchParams.set("season", String(season));
        url.searchParams.set("episode", String(episode));
      }

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return [];
      const { readBoundedText } = await import("./upstream-response.server");
      const payload = JSON.parse(await readBoundedText(res, 1_000_000)) as unknown;
      const record =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const segments = Array.isArray(payload)
        ? payload
        : Array.isArray(record.segments)
          ? record.segments
          : Array.isArray(record.data)
            ? record.data
            : [];
      if (!Array.isArray(segments)) return [];

      return segments
        .map((segment) => {
          const item =
            segment && typeof segment === "object" ? (segment as Record<string, unknown>) : {};
          const kind = String(item.segment_type || item.type || "intro").toLowerCase();
          return {
            type: kind === "credits" ? ("credits" as const) : ("intro" as const),
            start: Number(item.start_sec || item.start || 0),
            end: Number(item.end_sec || item.end || 0),
          };
        })
        .filter((s) => s.end > s.start);
    } catch {
      return [];
    }
  });
