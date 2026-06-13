import { createServerFn } from "@tanstack/react-start";
import { catalogRateLimitMiddleware, upstreamRateLimitMiddleware } from "./rate-limit";

export class TmdbConfigError extends Error {
  constructor() {
    super("Missing TMDB API credentials. Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY.");
    this.name = "TmdbConfigError";
  }
}

export type MediaType = "movie" | "tv";
export type DiscoverSort = "popular" | "new" | "rated";
type TmdbRequestParams = Record<string, string | number | undefined>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type CatalogRequest =
  | { action: "genres"; type: MediaType }
  | { action: "discover"; type: MediaType; genre?: number; sort?: DiscoverSort; page?: number }
  | { action: "search"; type: MediaType; query: string; page?: number }
  | { action: "detail"; type: MediaType; id: string | number }
  | { action: "similar"; type: MediaType; id: string | number };

const ALLOWED_DIRECT_PATHS = [/^\/collection\/\d{1,12}$/, /^\/tv\/\d{1,12}\/season\/\d{1,3}$/];
const ALLOWED_DIRECT_PARAMS = new Set(["language"]);

export function validateTmdbRequest(raw: unknown): { path: string; params: TmdbRequestParams } {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!ALLOWED_DIRECT_PATHS.some((pattern) => pattern.test(path))) {
    throw new Error("Invalid TMDB path.");
  }

  const rawParams =
    value.params && typeof value.params === "object"
      ? (value.params as Record<string, unknown>)
      : {};
  const params = Object.fromEntries(
    Object.entries(rawParams)
      .filter(([key, v]) => ALLOWED_DIRECT_PARAMS.has(key) && typeof v === "string")
      .map(([k, v]) => [k.slice(0, 80), typeof v === "string" ? v.slice(0, 240) : v]),
  ) as TmdbRequestParams;
  return { path, params };
}

const tmdbCachedRequestFn = createServerFn({ method: "POST" })
  .middleware([upstreamRateLimitMiddleware])
  .inputValidator(validateTmdbRequest)
  .handler(async ({ data }) => {
    const { tmdbCachedRequest } = await import("./tmdb-cache.server");
    return (await tmdbCachedRequest(data.path, data.params)) as JsonValue;
  });

function boundedPage(value: unknown) {
  return Math.min(500, Math.max(1, Number.parseInt(String(value ?? "1"), 10) || 1));
}

export function validateCatalogRequest(raw: unknown): CatalogRequest {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const action = typeof value.action === "string" ? value.action : "";
  const type: MediaType = value.type === "tv" ? "tv" : "movie";
  const page = boundedPage(value.page);
  const id =
    typeof value.id === "number" || typeof value.id === "string"
      ? String(value.id).slice(0, 80)
      : "";
  if (id && !/^\d{1,12}$/.test(id)) throw new Error("Invalid title id.");

  if (action === "genres") return { action, type };
  if (action === "discover") {
    return {
      action,
      type,
      genre: value.genre && Number.isInteger(Number(value.genre)) ? Number(value.genre) : undefined,
      sort: value.sort === "new" ? "new" : value.sort === "rated" ? "rated" : "popular",
      page,
    };
  }
  if (action === "search") {
    return {
      action,
      type,
      query: typeof value.query === "string" ? value.query.trim().slice(0, 120) : "",
      page,
    };
  }
  if (action === "detail" && id) return { action, type, id };
  if (action === "similar" && id) return { action, type, id };
  throw new Error("Invalid catalog request.");
}

const catalogRequestFn = createServerFn({ method: "POST" })
  .middleware([catalogRateLimitMiddleware])
  .inputValidator(validateCatalogRequest)
  .handler(async ({ data }) => {
    const catalog = await import("./catalog-db.server");
    if (data.action === "genres") return catalog.fetchGenresWithDatabase(data.type);
    if (data.action === "discover") return catalog.discoverWithDatabase(data.type, data);
    if (data.action === "search") {
      return catalog.searchTitlesWithDatabase(data.type, data.query, data.page);
    }
    if (data.action === "detail") return catalog.fetchDetailWithDatabase(data.type, data.id);
    return catalog.fetchSimilarWithDatabase(data.type, data.id);
  });

export type TmdbItem = {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  overview: string;
  genre_ids?: number[];
};

export type TmdbGenre = { id: number; name: string };
export type TmdbPage<T> = { results: T[]; page: number; total_pages: number };
export type TmdbVideo = {
  key: string;
  site: string;
  type: string;
  name: string;
  official?: boolean;
  published_at?: string;
};

async function tmdb<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  try {
    return (await tmdbCachedRequestFn({ data: { path, params } })) as T;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Missing TMDB API credentials")) {
      throw new TmdbConfigError();
    }
    throw error;
  }
}

export function fetchGenres(type: MediaType) {
  return catalogRequestFn({ data: { action: "genres", type } }) as Promise<TmdbGenre[]>;
}

export function discover(
  type: MediaType,
  opts: { genre?: number; sort?: DiscoverSort; page?: number } = {},
) {
  return catalogRequestFn({
    data: {
      action: "discover",
      type,
      genre: opts.genre,
      sort: opts.sort,
      page: opts.page ?? 1,
    },
  }) as Promise<TmdbPage<TmdbItem>>;
}

export function discoverSortValue(type: MediaType, sort: DiscoverSort) {
  if (sort === "new") return type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
  if (sort === "rated") return "vote_average.desc";
  return "popularity.desc";
}

export function searchTitles(type: MediaType, query: string, page = 1) {
  return catalogRequestFn({
    data: { action: "search", type, query, page },
  }) as Promise<TmdbPage<TmdbItem>>;
}

export function fetchSimilar(type: MediaType, id: string | number) {
  return catalogRequestFn({
    data: { action: "similar", type, id },
  }) as Promise<TmdbItem[]>;
}

export function fetchCollection(id: number) {
  return tmdb<{
    id: number;
    name: string;
    overview: string;
    backdrop_path: string | null;
    poster_path: string | null;
    parts: TmdbItem[];
  }>(`/collection/${id}`);
}

export type TmdbDetail = TmdbItem & {
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  tagline?: string;
  genres: TmdbGenre[];
  status?: string;
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  seasons?: {
    id: number;
    season_number: number;
    name: string;
    episode_count: number;
    air_date: string | null;
    poster_path: string | null;
    overview: string;
  }[];
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null }[];
  };
  videos?: { results: TmdbVideo[] };
};

export type TmdbEpisode = {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
  vote_average: number;
};

export function fetchDetail(type: MediaType, id: string | number) {
  return catalogRequestFn({
    data: { action: "detail", type, id },
  }) as Promise<TmdbDetail>;
}

export function selectYoutubeTrailer(videos: TmdbVideo[] | undefined) {
  const youtubeVideos = (videos ?? []).filter((v) => v.site === "YouTube" && v.key);
  return (
    youtubeVideos.find((v) => v.type === "Trailer" && v.official) ??
    youtubeVideos.find((v) => v.type === "Trailer") ??
    youtubeVideos.find((v) => v.type === "Teaser" && v.official) ??
    youtubeVideos[0]
  );
}

export function fetchSeason(id: string | number, seasonNumber: number) {
  const safeId = String(id);
  if (!/^\d{1,12}$/.test(safeId)) throw new Error("Invalid series id.");
  const safeSeason = Math.min(999, Math.max(1, Math.trunc(seasonNumber) || 1));
  return tmdb<{ episodes: TmdbEpisode[]; name: string; overview: string }>(
    `/tv/${safeId}/season/${safeSeason}`,
  );
}

export function still(path: string | null, size: "w300" | "original" = "w300") {
  return path ? `/tmdb-img/${size}${path}` : null;
}

export function poster(path: string | null, size: "w342" | "w500" | "original" = "w500") {
  return path ? `/tmdb-img/${size}${path}` : null;
}

export function backdrop(path: string | null, size: "w780" | "w1280" | "original" = "w1280") {
  return path ? `/tmdb-img/${size}${path}` : null;
}

export function title(item: TmdbItem) {
  return item.title ?? item.name ?? "Untitled";
}

export function year(item: TmdbItem) {
  const d = item.release_date ?? item.first_air_date;
  return d ? d.slice(0, 4) : "";
}
