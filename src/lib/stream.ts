import { createServerFn } from "@tanstack/react-start";
import type { DirectStreamResult } from "./moviebox.server";
import { streamRateLimitMiddleware } from "./rate-limit";
import type { MediaType } from "./tmdb";

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
        error: "External streaming is unavailable.",
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
    return {
      subjectId: String(value.subjectId || ""),
      resourceId: String(value.resourceId || ""),
    };
  })
  .handler(async ({ data }) => {
    const { getAsyncCaptions } = await import("./moviebox.server");
    return (await getAsyncCaptions(data.subjectId, data.resourceId)) as any[];
  });

export const proxySubtitle = createServerFn({ method: "GET" })
  .inputValidator((url: unknown) => {
    if (typeof url !== "string" || !url.startsWith("http")) throw new Error("Invalid URL");
    return url;
  })
  .handler(async ({ data }) => {
    try {
      const response = await fetch(data);
      if (!response.ok) throw new Error("Failed to fetch");
      return await response.text();
    } catch {
      return "";
    }
  });
export const resolveSkipSegments = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => {
    const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      tmdbId: String(value.tmdbId || ""),
      mediaType: value.mediaType === "tv" ? "tv" : "movie",
      season: typeof value.season === "number" ? value.season : undefined,
      episode: typeof value.episode === "number" ? value.episode : undefined,
    };
  })
  .handler(async ({ data }) => {
    try {
      const { tmdbId, mediaType, season, episode } = data;
      const { getMediaMappings } = await import("./moviebox.server");
      const mapping = await getMediaMappings(mediaType, tmdbId);
      let imdbId = mapping?.imdbId;

      if (!imdbId) {
        const tmdbReq = await fetch(
          `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=4d5e2e8e932b12fa6b3064e4337ba7dd`,
        );
        if (tmdbReq.ok) {
          const tmdbData = await tmdbReq.json();
          imdbId = tmdbData.imdb_id;
        }
      }

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
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];
      const payload = await res.json();
      const segments: any[] = Array.isArray(payload)
        ? payload
        : payload.segments || payload.data || [];
      if (!Array.isArray(segments)) return [];

      return segments
        .map((s) => ({
          type:
            (s.segment_type || s.type || "intro").toLowerCase() === "credits" ? "credits" : "intro",
          start: Number(s.start_sec || s.start || 0),
          end: Number(s.end_sec || s.end || 0),
        }))
        .filter((s) => s.end > s.start);
    } catch {
      return [];
    }
  });
