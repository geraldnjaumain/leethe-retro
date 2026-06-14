import { createHash, createHmac, randomUUID as nodeRandomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envValue, localCacheDirectory } from "./env.server";
import { log, serializeError } from "./logger.server";
import { readBoundedText } from "./upstream-response.server";

type MovieBoxCover = string | { url?: string; path?: string } | null | undefined;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type MovieBoxCatalogApiItem = {
  subjectId?: string | number;
  subjectType?: number;
  title?: string;
  description?: string;
  releaseDate?: string;
  cover?: MovieBoxCover;
  imdbRatingValue?: string | number;
  imdbRating?: string | number;
  hasResource?: boolean;
  durationSeconds?: number;
  seNum?: number;
};

type MovieBoxListResponse = {
  items?: MovieBoxCatalogApiItem[];
};

type MovieBoxResourceItem = {
  title?: string;
  resourceLink?: string;
  sourceUrl?: string;
  resolution?: string | number;
  size?: string | number;
  codecName?: string;
  duration?: string | number;
  se?: string | number;
  ep?: string | number;
  id?: string;
  resourceId?: string;
  uploadBy?: string;
  language?: string;
  lang?: string;
  langCode?: string;
  lan?: string;
  lanCode?: string;
  lanName?: string;
  audio?: string;
  audioTrack?: string;
  audioLang?: string;
  audioLanguage?: string;
  extCaptions?: unknown[];
};

type MovieBoxResourceResponse = {
  list?: MovieBoxResourceItem[];
};

export type MovieBoxStreamLink = {
  url: string;
  resolution: number;
  quality: string;
  size: number;
  codecName: string;
  duration: number;
  season: number;
  episode: number;
  title?: string;
  sourceName?: string;
  audioLabel?: string;
  languageCode?: string;
  resourceId?: string;
  extCaptions?: JsonValue[];
};

export type DirectStreamResult = {
  success: boolean;
  streams: MovieBoxStreamLink[];
  subjectId?: string;
  title?: string;
  error?: string;
};

type MovieBoxSearchResult = {
  subjectId: string;
  subjectType: number;
  title: string;
  description: string;
  releaseDate: string;
  cover: string | null;
  imdbRating: number;
  hasResource: boolean;
  durationSeconds: number;
  seasonNumbers: number;
};

const SUBJECT_TYPE = {
  ALL: 0,
  MOVIES: 1,
  TV_SERIES: 2,
} as const;

const DEFAULT_HOST_POOL = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com",
];
const DEFAULT_H5_API_HOST = "https://h5-api.aoneroom.com";
const DEFAULT_WEB_ORIGIN = "https://netfilm.world";

const SEARCH_PATH = "/wefeed-mobile-bff/subject-api/search";
const RESOURCE_PATH = "/wefeed-mobile-bff/subject-api/resource";
const RETRY_STATUS_CODES = new Set([403, 407, 429, 500, 502, 503, 504]);
const HOST_TIMEOUT_MS = 15000;
const HOST_COOLDOWN_MS = 45_000;
const MAX_JSON_BYTES = 5_000_000;
const SIGNATURE_BODY_MAX_BYTES = 102_400;
const RESOURCE_PAGE_SIZE = 20;
const RESOURCE_PAGE_LIMIT = 5;

let runtimeToken: string | null = null;
let preferredHost: string | null = null;
const hostCooldownUntil = new Map<string, number>();

const AUDIO_LABEL_PATTERNS: Array<[RegExp, string]> = [
  [/\bdual[\s._-]*audio\b/i, "Dual Audio"],
  [/\bmulti[\s._-]*audio\b/i, "Multi Audio"],
  [/\benglish\b|\beng\b/i, "English"],
  [/\bjapanese\b|\bjpn\b|\bjp\b/i, "Japanese"],
  [/\bkorean\b|\bkor\b/i, "Korean"],
  [/\bhindi\b|\bhin\b/i, "Hindi"],
  [/\bspanish\b|\bspa\b/i, "Spanish"],
  [/\bfrench\b|\bfre\b|\bfra\b/i, "French"],
  [/\barabic\b|\bara\b|العربية|عربي/i, "Arabic"],
  [/\bgerman\b|\bdeu\b|\bger\b/i, "German"],
  [/\bportuguese\b|\bpor\b|\bpt-br\b/i, "Portuguese"],
  [/\bturkish\b|\btur\b/i, "Turkish"],
  [/\brussian\b|\brus\b/i, "Russian"],
  [/\bchinese\b|\bmandarin\b|\bzho\b|\bchi\b/i, "Chinese"],
  [/\btamil\b|\btam\b/i, "Tamil"],
  [/\btelugu\b|\btel\b/i, "Telugu"],
];

function cleanBaseUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export function getMovieBoxProviderConfig() {
  const configuredHosts = (envValue("MOVIEBOX_API_HOSTS") || "")
    .split(",")
    .map((host) => cleanBaseUrl(host))
    .filter((host): host is string => Boolean(host));
  return {
    apiHosts: configuredHosts.length ? [...new Set(configuredHosts)] : DEFAULT_HOST_POOL,
    h5ApiHost: cleanBaseUrl(envValue("MOVIEBOX_H5_API_HOST")) || DEFAULT_H5_API_HOST,
    webOrigin: cleanBaseUrl(envValue("MOVIEBOX_WEB_ORIGIN")) || DEFAULT_WEB_ORIGIN,
  };
}

function getMovieBoxSigningKey(useAltKey = false) {
  return envValue(useAltKey ? "MOVIEBOX_SECRET_KEY_ALT" : "MOVIEBOX_SECRET_KEY_DEFAULT");
}

function isMissingSigningKey(error: unknown) {
  return error instanceof Error && error.message.includes("MovieBox signing key");
}

function cleanExternalText(value: unknown, maxLength = 240): string | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = String(value)
    .normalize("NFKC")
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159) ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function cleanSubjectId(value: unknown): string | undefined {
  const id = cleanExternalText(value, 32);
  return id && /^\d{1,24}$/.test(id) ? id : undefined;
}

function cleanRating(value: unknown): number | undefined {
  const rating = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(rating) || rating <= 0) return undefined;
  return Math.min(10, Math.max(0, Number(rating.toFixed(1))));
}

function cleanYear(value: unknown): number | undefined {
  const year = Number.parseInt(String(value ?? "").slice(0, 4), 10);
  if (!Number.isFinite(year) || year < 1880 || year > 2200) return undefined;
  return year;
}

function normalizeTitleForMatch(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value: string) {
  const stop = new Set(["a", "an", "and", "the", "of", "movie", "film"]);
  return normalizeTitleForMatch(value)
    .split(" ")
    .filter((token) => token.length > 1 && !stop.has(token));
}

function romanToNumber(value: string) {
  const roman = value.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) return undefined;
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman[index]] ?? 0;
    const next = values[roman[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && total <= 50 ? total : undefined;
}

function titlePartMarkers(value: string) {
  const normalized = normalizeTitleForMatch(value);
  const markers = new Set<number>();
  for (const token of normalized.split(" ")) {
    const numeric = Number.parseInt(token, 10);
    if (Number.isFinite(numeric) && numeric > 0 && numeric <= 50) markers.add(numeric);
    const roman = romanToNumber(token);
    if (roman) markers.add(roman);
  }
  return markers;
}

function titleScore(expectedTitle: string, candidateTitle: string) {
  const expected = normalizeTitleForMatch(expectedTitle);
  const candidate = normalizeTitleForMatch(candidateTitle);
  if (!expected || !candidate) return -80;
  if (expected === candidate) return 60;

  const expectedTokens = titleTokens(expectedTitle);
  const candidateTokenSet = new Set(titleTokens(candidateTitle));
  const matched = expectedTokens.filter((token) => candidateTokenSet.has(token)).length;
  const overlap = expectedTokens.length ? matched / expectedTokens.length : 0;
  let score = Math.round(overlap * 42);

  if (candidate.startsWith(`${expected} `) || expected.startsWith(`${candidate} `)) score += 8;
  if (candidate.includes(` ${expected} `) || expected.includes(` ${candidate} `)) score += 4;

  const expectedMarkers = titlePartMarkers(expectedTitle);
  const candidateMarkers = titlePartMarkers(candidateTitle);
  if (expectedMarkers.size > 0) {
    const markerMatch = Array.from(expectedMarkers).some((marker) => candidateMarkers.has(marker));
    if (!markerMatch) score -= 25;
  } else if (candidateMarkers.size > 0) {
    score -= 10;
  }

  return score;
}

function scoreMovieBoxCandidate(
  expectedTitle: string,
  type: "movie" | "tv",
  candidate: MovieBoxSearchResult,
  releaseYear?: number,
  runtimeMinutes?: number,
  seasonCount?: number,
) {
  let score = titleScore(expectedTitle, candidate.title);
  const reasons: string[] = [`title ${score}`];

  const candidateYear = cleanYear(candidate.releaseDate);
  if (releaseYear && candidateYear) {
    const delta = Math.abs(candidateYear - releaseYear);
    if (delta === 0) {
      score += 30;
      reasons.push("exact year");
    } else if (delta === 1) {
      score += 16;
      reasons.push("near year");
    } else {
      score -= 28;
      reasons.push("year mismatch");
    }
  }

  if (type === "movie" && runtimeMinutes && candidate.durationSeconds) {
    const candidateMinutes = Math.round(candidate.durationSeconds / 60);
    const delta = Math.abs(candidateMinutes - runtimeMinutes);
    if (delta <= 8) {
      score += 14;
      reasons.push("runtime match");
    } else if (delta <= 18) {
      score += 6;
      reasons.push("runtime near");
    } else {
      score -= 12;
      reasons.push("runtime mismatch");
    }
  }

  if (type === "tv" && seasonCount && candidate.seasonNumbers) {
    if (candidate.seasonNumbers === seasonCount) {
      score += 18;
      reasons.push("season count match");
    } else if (Math.abs(candidate.seasonNumbers - seasonCount) <= 1) {
      score += 6;
      reasons.push("season count near");
    } else {
      score -= 14;
      reasons.push("season count mismatch");
    }
  }

  if (candidate.hasResource) score += 6;
  return { candidate, score, reasons };
}

function chooseMovieBoxCandidate(
  expectedTitle: string,
  type: "movie" | "tv",
  candidates: MovieBoxSearchResult[],
  releaseYear?: number,
  runtimeMinutes?: number,
  seasonCount?: number,
) {
  const scored = candidates
    .map((candidate) =>
      scoreMovieBoxCandidate(
        expectedTitle,
        type,
        candidate,
        releaseYear,
        runtimeMinutes,
        seasonCount,
      ),
    )
    .sort((a, b) => b.score - a.score);
  const best = scored.find((item) => item.candidate.hasResource) ?? scored[0];
  if (!best) return null;

  const threshold = type === "movie" ? 58 : 52;
  const bestYear = cleanYear(best.candidate.releaseDate);
  const hasHardYearMismatch =
    Boolean(releaseYear && bestYear && Math.abs(bestYear - releaseYear) > 1) &&
    normalizeTitleForMatch(expectedTitle) !== normalizeTitleForMatch(best.candidate.title);

  return best.score >= threshold && !hasHardYearMismatch ? best : null;
}

function cleanPositiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, max);
}

function cleanExternalUrl(value: unknown): string | undefined {
  const raw = cleanExternalText(value, 2048);
  if (!raw) return undefined;

  const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanCoverUrl(cover: MovieBoxCover): string | null {
  if (typeof cover === "string") return cleanExternalUrl(cover) || null;
  if (!cover) return null;
  return cleanExternalUrl(cover.url) || cleanExternalUrl(cover.path) || null;
}

function md5Hex(data: string) {
  return createHash("md5").update(data).digest("hex");
}

function b64Decode(value: string) {
  const padding = (4 - (value.length % 4)) % 4;
  return Buffer.from(value + "=".repeat(padding), "base64");
}

function generateXClientToken(timestampMs = Date.now()) {
  const ts = String(timestampMs);
  return `${ts},${md5Hex(ts.split("").reverse().join(""))}`;
}

function sortedQueryString(url: string) {
  const parsed = new URL(url);
  const params = Array.from(parsed.searchParams.entries());
  if (!params.length) return "";
  params.sort((a, b) => a[0].localeCompare(b[0]));
  return params.map(([k, v]) => `${k}=${v}`).join("&");
}

function generateXTrSignature(
  method: string,
  accept: string,
  contentType: string,
  url: string,
  body: string | null = null,
  useAltKey = false,
  timestampMs = Date.now(),
) {
  const parsed = new URL(url);
  const query = sortedQueryString(url);
  const canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  let bodyHash = "";
  let bodyLength = "";

  if (body) {
    const bodyBytes = Buffer.from(body, "utf8");
    const truncated = bodyBytes.subarray(0, SIGNATURE_BODY_MAX_BYTES);
    bodyHash = md5Hex(truncated.toString());
    bodyLength = String(bodyBytes.length);
  }

  const canonical = [
    method.toUpperCase(),
    accept,
    contentType,
    bodyLength,
    String(timestampMs),
    bodyHash,
    canonicalUrl,
  ].join("\n");

  const secret = getMovieBoxSigningKey(useAltKey);
  if (!secret) {
    throw new Error("MovieBox signing key is not configured.");
  }
  const mac = createHmac("md5", b64Decode(secret)).update(canonical, "utf8").digest();
  return `${timestampMs}|2|${mac.toString("base64")}`;
}

function randomHex(length: number) {
  return Array.from({ length }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}

function generateClientInfo() {
  const androidVersions = [
    { version: "11", build: "RP1A.200720.011" },
    { version: "12", build: "S1B.220414.015" },
    { version: "13", build: "TQ2A.230405.003" },
  ];
  const devices = [
    { model: "23078RKD5C", brand: "Redmi" },
    { model: "2201117TY", brand: "Redmi" },
    { model: "22101316G", brand: "Redmi" },
  ];
  const versionCodes = [50020042, 50020043, 50020044, 50020045, 50020046];
  const android = androidVersions[Math.floor(Math.random() * androidVersions.length)];
  const device = devices[Math.floor(Math.random() * devices.length)];
  const versionCode = versionCodes[Math.floor(Math.random() * versionCodes.length)];

  return {
    userAgent: `com.community.oneroom/${versionCode} (Linux; U; Android ${android.version}; en_US; ${device.model}; Build/${android.build}; Cronet/135.0.7012.3)`,
    clientInfo: JSON.stringify({
      package_name: "com.community.oneroom",
      version_name: "3.0.03.0529.03",
      version_code: versionCode,
      os: "android",
      os_version: android.version,
      install_ch: "ps",
      device_id: randomHex(32),
      install_store: "ps",
      gaid: nodeRandomUUID(),
      brand: device.brand,
      model: device.model,
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "US",
      timezone: "America/New_York",
      sp_code: "40401",
      "X-Play-Mode": "2",
    }),
  };
}

function buildSignedHeaders(method: "GET" | "POST", url: string, body: string | null) {
  const ts = Date.now();
  const accept = "application/json";
  const contentType = body ? "application/json; charset=utf-8" : "application/json";
  const { userAgent, clientInfo } = generateClientInfo();
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: accept,
    "Content-Type": contentType,
    Connection: "keep-alive",
    "X-Client-Token": generateXClientToken(ts),
    "x-tr-signature": generateXTrSignature(method, accept, contentType, url, body, false, ts),
    "X-Client-Info": clientInfo,
    "X-Client-Status": "0",
  };
  if (runtimeToken) headers.Authorization = `Bearer ${runtimeToken}`;
  return headers;
}

function responseSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function parseJsonResponse(text: string, base: string, status: number, contentType: string | null) {
  const trimmed = text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/:\s*(\d{16,})/g, ': "$1"');
  const type = contentType || "unknown content-type";

  if (!trimmed) throw new Error(`Host ${base} returned an empty response (${status}, ${type})`);
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error(
      `Host ${base} returned a non-JSON response (${status}, ${type}): ${responseSnippet(text)}`,
    );
  }
  return JSON.parse(trimmed) as unknown;
}

function absorbXUser(responseHeaders: Headers) {
  const xUser = responseHeaders.get("x-user");
  if (!xUser) return;
  try {
    const payload = JSON.parse(xUser) as { token?: string };
    if (payload.token) runtimeToken = payload.token;
  } catch {
    // The header is opportunistic; ignore malformed values.
  }
}

function orderedHosts() {
  const hostPool = getMovieBoxProviderConfig().apiHosts;
  const now = Date.now();
  const available = hostPool.filter((host) => (hostCooldownUntil.get(host) || 0) <= now);
  const fallback = available.length ? available : hostPool;
  const ordered = preferredHost
    ? [preferredHost, ...fallback.filter((host) => host !== preferredHost)]
    : fallback;
  return ordered.concat(hostPool.filter((host) => !ordered.includes(host)));
}

async function apiRequest<T>(
  method: "GET" | "POST",
  pathAndQuery: string,
  body?: Record<string, unknown>,
): Promise<T> {
  if (!pathAndQuery.startsWith("/") || pathAndQuery.startsWith("//")) {
    throw new Error("Invalid MovieBox API path");
  }

  let lastError: Error | null = null;
  for (const base of orderedHosts()) {
    const url = `${base}${pathAndQuery}`;
    const bodyStr = body ? JSON.stringify(body) : null;

    try {
      const res = await fetch(url, {
        method,
        headers: buildSignedHeaders(method, url, bodyStr),
        body: bodyStr ?? undefined,
        signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
      });
      absorbXUser(res.headers);
      const text = await readBoundedText(res, MAX_JSON_BYTES);

      if (RETRY_STATUS_CODES.has(res.status)) {
        lastError = new Error(`Host ${base} returned ${res.status}: ${responseSnippet(text)}`);
        if (base === preferredHost) preferredHost = null;
        hostCooldownUntil.set(base, Date.now() + HOST_COOLDOWN_MS);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Provider rejected the request (${res.status}): ${responseSnippet(text)}`);
      }

      const json = parseJsonResponse(text, base, res.status, res.headers.get("content-type"));
      preferredHost = base;
      hostCooldownUntil.delete(base);
      if (json && typeof json === "object" && "data" in json) {
        return (json as { data: T }).data;
      }
      return json as T;
    } catch (err) {
      lastError = err as Error;
      if (base === preferredHost) preferredHost = null;
      hostCooldownUntil.set(base, Date.now() + HOST_COOLDOWN_MS);
    }
  }

  throw new Error(`All MovieBox API hosts exhausted: ${lastError?.message}`);
}

function apiGet<T>(path: string, params?: Record<string, string | number>) {
  const qs = params
    ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    : "";
  return apiRequest<T>("GET", qs ? `${path}?${qs}` : path);
}

async function h5ApiGet<T = unknown>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T | null> {
  const { h5ApiHost, webOrigin } = getMovieBoxProviderConfig();
  let fullPath = path;
  if (params) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    fullPath = `${path}?${qs}`;
  }

  const url = `${h5ApiHost}${fullPath}`;
  const ts = Date.now();
  const accept = "application/json";
  const contentType = "application/json";
  const sig = generateXTrSignature("GET", accept, contentType, url, null, false, ts);

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: accept,
    "Content-Type": contentType,
    "X-Client-Token": generateXClientToken(ts),
    "x-tr-signature": sig,
    Origin: webOrigin,
    Referer: `${webOrigin}/`,
  };

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });

  const text = await readBoundedText(res, MAX_JSON_BYTES);
  if (text.includes("404 page")) return null;
  if (!res.ok) throw new Error(`H5 API returned ${res.status}: ${text.slice(0, 180)}`);

  const sanitized = text.replace(/:\s*(\d{16,})/g, ': "$1"');
  const json = JSON.parse(sanitized) as unknown;
  if (json && typeof json === "object" && "data" in json) return (json as { data: T }).data;
  return json as T;
}

async function h5ApiPost<T>(path: string, body: Record<string, unknown>) {
  const { h5ApiHost, webOrigin } = getMovieBoxProviderConfig();
  const url = `${h5ApiHost}${path}`;
  const ts = Date.now();
  const accept = "application/json";
  const contentType = "application/json; charset=utf-8";
  const bodyStr = JSON.stringify(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: accept,
      "Content-Type": contentType,
      "X-Client-Token": generateXClientToken(ts),
      "x-tr-signature": generateXTrSignature("POST", accept, contentType, url, bodyStr, false, ts),
      Origin: webOrigin,
      Referer: `${webOrigin}/`,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15000),
  });

  const text = await readBoundedText(res, MAX_JSON_BYTES);
  if (text.includes("404 page")) return null;
  if (!res.ok) throw new Error(`H5 API returned ${res.status}: ${text.slice(0, 180)}`);
  const json = JSON.parse(text.replace(/:\s*(\d{16,})/g, ': "$1"')) as unknown;
  if (json && typeof json === "object" && "data" in json) return (json as { data: T }).data;
  return json as T;
}

function detectAudioLabel(item: MovieBoxResourceItem) {
  const explicit = cleanExternalText(
    item.audioLanguage ||
      item.audioLang ||
      item.audioTrack ||
      item.audio ||
      item.lanName ||
      item.language,
    80,
  );
  if (explicit) return explicit;

  const haystack = [item.title, item.sourceUrl, item.lang, item.langCode, item.lan, item.lanCode]
    .filter(Boolean)
    .join(" ");
  return AUDIO_LABEL_PATTERNS.flatMap(([pattern, label]) => (pattern.test(haystack) ? [label] : []))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 3)
    .join(" / ");
}

export async function getAsyncCaptions(subjectId: string, resourceId: string): Promise<unknown[]> {
  try {
    const safeSubjectId = cleanSubjectId(subjectId);
    const safeResourceId = cleanExternalText(resourceId, 80);
    if (!safeSubjectId || !safeResourceId) return [];

    const data = await h5ApiGet<{ captions?: unknown[] }>("/wefeed-h5api-bff/subject/caption", {
      format: "MP4",
      id: safeResourceId,
      subjectId: safeSubjectId,
      detailPath: "",
    });
    return data?.captions || [];
  } catch (err) {
    return [];
  }
}

async function searchMovieBoxV3(query: string, type: "movie" | "tv" | "all" = "movie") {
  const subjectType =
    type === "movie"
      ? SUBJECT_TYPE.MOVIES
      : type === "tv"
        ? SUBJECT_TYPE.TV_SERIES
        : SUBJECT_TYPE.ALL;
  const keyword = cleanExternalText(query, 120);
  if (!keyword) return [];

  const body = { keyword, page: 1, perPage: 20, subjectType };
  let data: MovieBoxListResponse | null = null;

  try {
    data = await h5ApiPost<MovieBoxListResponse>("/wefeed-h5api-bff/subject/search", body);
  } catch (err) {
    if (isMissingSigningKey(err)) throw err;
    data = null;
  }

  if (!data?.items?.length) {
    data = await apiRequest<MovieBoxListResponse>("POST", SEARCH_PATH, body).catch((err) => {
      if (isMissingSigningKey(err)) throw err;
      return null;
    });
  }

  if (!data?.items?.length) return [];
  return data.items
    .filter((item) => item.subjectType === subjectType || subjectType === SUBJECT_TYPE.ALL)
    .map(
      (item): MovieBoxSearchResult => ({
        subjectId: cleanSubjectId(item.subjectId) || "",
        subjectType: item.subjectType || SUBJECT_TYPE.ALL,
        title: cleanExternalText(item.title, 140) || "",
        description: cleanExternalText(item.description, 700) || "",
        releaseDate: cleanExternalText(item.releaseDate, 32) || "",
        cover: cleanCoverUrl(item.cover),
        imdbRating: cleanRating(item.imdbRatingValue || item.imdbRating) || 0,
        hasResource: Boolean(item.hasResource),
        durationSeconds: cleanPositiveInt(item.durationSeconds, 864_000) || 0,
        seasonNumbers: cleanPositiveInt(item.seNum, 100) || 0,
      }),
    )
    .filter((item) => item.subjectId && item.title);
}

async function getMovieBoxStreams(
  subjectId: string,
  resolution = 1080,
  season?: number,
  episode?: number,
) {
  const safeSubjectId = cleanSubjectId(subjectId);
  if (!safeSubjectId) return [];

  let page = 1;
  const perPage = RESOURCE_PAGE_SIZE;
  let allStreams: MovieBoxStreamLink[] = [];

  while (page <= RESOURCE_PAGE_LIMIT) {
    const data = await apiGet<MovieBoxResourceResponse>(RESOURCE_PATH, {
      subjectId: safeSubjectId,
      resolution: cleanPositiveInt(resolution, 2160) || 1080,
      page,
      perPage,
      ...(season ? { se: season } : {}),
      ...(episode ? { ep: episode } : {}),
    });

    if (!data?.list?.length) break;

    const parsed = data.list
      .map(
        (item): MovieBoxStreamLink => ({
          url: cleanExternalUrl(item.resourceLink) || cleanExternalUrl(item.sourceUrl) || "",
          resolution: cleanPositiveInt(item.resolution, 2160) || 0,
          quality: `${cleanPositiveInt(item.resolution, 2160) || 0}p`,
          size: cleanPositiveInt(item.size, Number.MAX_SAFE_INTEGER) || 0,
          codecName: cleanExternalText(item.codecName, 40) || "unknown",
          duration: cleanPositiveInt(item.duration, 864_000) || 0,
          season: cleanPositiveInt(item.se, 100) || 0,
          episode: cleanPositiveInt(item.ep, 10_000) || 0,
          title: cleanExternalText(item.title, 140) || "",
          sourceName: cleanExternalText(item.uploadBy, 80) || "",
          audioLabel: detectAudioLabel(item),
          languageCode:
            cleanExternalText(item.langCode || item.lanCode || item.lang || item.lan, 16) || "",
          resourceId: cleanExternalText(item.id || item.resourceId, 80) || "",
          extCaptions: JSON.parse(JSON.stringify(item.extCaptions || [])) as JsonValue[],
        }),
      )
      .filter((stream) => stream.url && stream.url.startsWith("http"));

    allStreams = allStreams.concat(parsed);

    if (data.list.length < perPage) break;

    page++;
  }

  return dedupeMovieBoxStreams(allStreams);
}

function dedupeMovieBoxStreams(streams: MovieBoxStreamLink[]) {
  const seen = new Set<string>();
  return streams.filter((stream) => {
    const key = [
      stream.url,
      stream.resolution,
      stream.audioLabel?.toLowerCase() || "",
      stream.languageCode?.toLowerCase() || "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeMovieBoxSubjectId(value?: string | number) {
  const id = String(value || "").trim();
  return /^\d{12,24}$/.test(id) ? id : undefined;
}

function filterEpisode(
  streams: MovieBoxStreamLink[],
  type: string,
  season?: number,
  episode?: number,
) {
  let filtered = [...streams];
  if (type === "tv" && season && episode) {
    const exact = filtered.filter((s) => s.season === season && s.episode === episode);
    if (exact.length) filtered = exact;
    else {
      const byEp = filtered.filter((s) => s.episode === episode);
      if (byEp.length) filtered = byEp;
    }
  }
  return filtered.sort((a, b) => streamPlayabilityScore(b) - streamPlayabilityScore(a));
}

function streamPlayabilityScore(stream: MovieBoxStreamLink) {
  const haystack = [stream.codecName, stream.title, stream.url].join(" ").toLowerCase();
  const hevcPenalty = /\bhevc\b|\bh\.?265\b|\/h265\//i.test(haystack) ? 800 : 0;
  const avcBonus = /\bavc\b|\bh\.?264\b|\/h264\//i.test(haystack) ? 160 : 0;
  const mp4Bonus = /\.mp4(?:[?#]|$)/i.test(stream.url) ? 40 : 0;
  return stream.resolution + avcBonus + mp4Bonus - hevcPenalty;
}

const subjectIdMemoryCache = new Map<string, string>();
let subjectIdCacheLoaded = false;

async function loadSubjectIdCache() {
  if (subjectIdCacheLoaded) return;
  const root = localCacheDirectory();
  if (root) {
    try {
      const data = await readFile(join(root, "moviebox_subject_ids.json"), "utf8");
      const parsed = JSON.parse(data) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) subjectIdMemoryCache.set(k, v);
    } catch {
      // The local cache is opportunistic; a missing or malformed file is a cache miss.
    }
  }
  subjectIdCacheLoaded = true;
}

function saveSubjectIdCache() {
  const root = localCacheDirectory();
  if (!root) return;
  writeFile(
    join(root, "moviebox_subject_ids.json"),
    JSON.stringify(Object.fromEntries(subjectIdMemoryCache)),
  ).catch(() => {});
}

export async function resolveStreams(
  title: string,
  type: "movie" | "tv" = "movie",
  tmdbId?: string | number,
  season?: number,
  episode?: number,
  releaseYear?: number,
  subjectId?: string | number,
  runtimeMinutes?: number,
  seasonCount?: number,
): Promise<DirectStreamResult> {
  await loadSubjectIdCache();
  try {
    const directSubjectId =
      normalizeMovieBoxSubjectId(subjectId) || normalizeMovieBoxSubjectId(tmdbId);
    if (directSubjectId) {
      const streams = filterEpisode(
        await getMovieBoxStreams(directSubjectId, 1080, season, episode),
        type,
        season,
        episode,
      );
      if (streams.length) return { success: true, streams, subjectId: directSubjectId, title };
    }

    if (tmdbId) {
      const cachedSubjectId = subjectIdMemoryCache.get(`${type}:${tmdbId}`);
      if (cachedSubjectId) {
        const streams = filterEpisode(
          await getMovieBoxStreams(cachedSubjectId, 1080, season, episode),
          type,
          season,
          episode,
        );
        if (streams.length) return { success: true, streams, subjectId: cachedSubjectId, title };
      }
    }

    const results = await searchMovieBoxV3(title, type);
    if (!results.length) {
      return { success: false, streams: [], error: "No stream result found for this title." };
    }

    const bestMatch = chooseMovieBoxCandidate(
      title,
      type,
      results,
      releaseYear,
      runtimeMinutes,
      seasonCount,
    );
    if (!bestMatch) {
      return {
        success: false,
        streams: [],
        error: "No confirmed stream match was found for this TMDB title.",
      };
    }

    const best = bestMatch.candidate;

    const streams = filterEpisode(
      await getMovieBoxStreams(best.subjectId, 1080, season, episode),
      type,
      season,
      episode,
    );

    if (streams.length > 0 && tmdbId) {
      subjectIdMemoryCache.set(`${type}:${tmdbId}`, best.subjectId);
      saveSubjectIdCache();
    }

    return {
      success: streams.length > 0,
      streams,
      subjectId: best.subjectId,
      title: best.title,
      error: streams.length ? undefined : "No playable stream was returned for this title.",
    };
  } catch (err) {
    log("warn", "stream_resolver_failed", {
      type,
      tmdbId: Boolean(tmdbId),
      season,
      episode,
      error: serializeError(err),
    });
    return {
      success: false,
      streams: [],
      error: isMissingSigningKey(err)
        ? "The playback provider is not configured."
        : "The playback provider is temporarily unavailable.",
    };
  }
}
