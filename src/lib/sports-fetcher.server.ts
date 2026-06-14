import { log, serializeError } from "./logger.server";
import {
  dedupeSportsNews,
  mergeSportsMatches,
  type SportsMatch,
  type SportsNews,
} from "./sports-data";
import { createSportsStreamProxyUrl } from "./sports-stream.server";
import { readBoundedText } from "./upstream-response.server";

export type { SportsMatch, SportsNews };

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const SPORTS_TIMEOUT_MS = 10_000;
const MAX_SPORTS_JSON_BYTES = 4_000_000;
const PRIMARY_ENDPOINTS = [
  {
    sport: "Soccer" as const,
    url: "https://h5-api.aoneroom.com/wefeed-h5api-bff/live/match-list-v5?date=&language=en&offset=0&limit=50&type=1",
  },
  {
    sport: "Basketball" as const,
    url: "https://h5-api.aoneroom.com/wefeed-h5api-bff/live/match-list-v5?date=&language=en&offset=0&limit=50&type=2",
  },
];
const NEWS_ENDPOINTS = [
  {
    sport: "Soccer" as const,
    url: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news",
  },
  {
    sport: "Basketball" as const,
    url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news",
  },
  {
    sport: "Football" as const,
    url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
  },
];

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "", limit = 180) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, limit) : fallback;
}

function score(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function externalHttpsUrl(value: unknown) {
  const raw = text(value, "", 2_048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function fetchJson(url: string, headers?: HeadersInit) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(SPORTS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Sports upstream returned ${response.status}.`);
  return JSON.parse(await readBoundedText(response, MAX_SPORTS_JSON_BYTES)) as unknown;
}

function primaryStatus(value: unknown) {
  if (value === "MatchPlaying" || value === "MatchIng" || value === "Live") return 1;
  if (value === "MatchEnded" || value === "Finished") return 2;
  return 0;
}

function primaryMatches(payload: unknown, sport: SportsMatch["sport"]) {
  const data = record(record(payload).data);
  return list(data.list).flatMap((raw): SportsMatch[] => {
    const item = record(raw);
    const id = text(item.id);
    if (!id) return [];
    const home = record(item.team1);
    const away = record(item.team2);
    const homeInfo = record(item.teamMatchInfo1);
    const awayInfo = record(item.teamMatchInfo2);
    const playSources = list(item.playSource);
    const highlights = list(item.highlights);
    const liveSource = item.playPath || record(playSources[0]).path;
    const replaySource = record(highlights[0]).path;

    return [
      {
        id,
        leagueId: text(item.leagueId),
        leagueName: text(item.league, "Other"),
        sport,
        homeTeamName: text(home.name, "Home"),
        homeTeamLogo: externalHttpsUrl(home.avatar),
        awayTeamName: text(away.name, "Away"),
        awayTeamLogo: externalHttpsUrl(away.avatar),
        matchTime: text(item.startTime || item.arrangedTime),
        status: primaryStatus(item.status),
        homeScore: score(homeInfo.score || home.score),
        awayScore: score(awayInfo.score || away.score),
        liveUrl: createSportsStreamProxyUrl(liveSource, true),
        replayUrl: createSportsStreamProxyUrl(replaySource, true),
      },
    ];
  });
}

function espnWorldCupMatches(payload: unknown) {
  return list(record(payload).events).flatMap((raw): SportsMatch[] => {
    const event = record(raw);
    const competition = record(list(event.competitions)[0]);
    const competitors = list(competition.competitors).map(record);
    if (competitors.length < 2) return [];
    const home = competitors.find((team) => team.homeAway === "home") || competitors[0];
    const away = competitors.find((team) => team.homeAway === "away") || competitors[1];
    const homeTeam = record(home.team);
    const awayTeam = record(away.team);
    const state = record(record(event.status).type).state;

    return [
      {
        id: `espn-${text(event.id)}`,
        leagueId: "fifa.world",
        leagueName: "FIFA World Cup",
        sport: "Soccer",
        homeTeamName: text(homeTeam.displayName || homeTeam.name, "Home"),
        homeTeamLogo: externalHttpsUrl(homeTeam.logo),
        awayTeamName: text(awayTeam.displayName || awayTeam.name, "Away"),
        awayTeamLogo: externalHttpsUrl(awayTeam.logo),
        matchTime: text(event.date),
        status: state === "in" ? 1 : state === "post" ? 2 : 0,
        homeScore: score(home.score),
        awayScore: score(away.score),
      },
    ];
  });
}

export async function fetchSportsData(): Promise<SportsMatch[]> {
  const primaryRequests = PRIMARY_ENDPOINTS.map(async ({ sport, url }) =>
    primaryMatches(await fetchJson(url, { "User-Agent": MOBILE_USER_AGENT }), sport),
  );
  const worldCupRequest = fetchJson(
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=2026&limit=200",
  ).then(espnWorldCupMatches);

  const results = await Promise.allSettled([...primaryRequests, worldCupRequest]);
  const matches = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    log("warn", "sports_match_sources_failed", {
      failedSources: failures.length,
      totalSources: results.length,
    });
  }
  return mergeSportsMatches(matches);
}

function newsArticles(payload: unknown, sport: SportsNews["sport"]) {
  return list(record(payload).articles).flatMap((raw): SportsNews[] => {
    const item = record(raw);
    const headline = text(item.headline);
    const links = record(item.links);
    const web = record(links.web);
    const api = record(links.api);
    const news = record(api.news);
    const url = externalHttpsUrl(web.href || news.href);
    if (!headline || !url) return [];
    const images = list(item.images);

    return [
      {
        id: text(item.id, headline),
        headline,
        description: text(item.description, "", 400),
        imageUrl: externalHttpsUrl(record(images[0]).url) || undefined,
        url,
        publishedAt: text(item.published, new Date(0).toISOString(), 80),
        sport,
      },
    ];
  });
}

export async function fetchSportsNews(): Promise<SportsNews[]> {
  const results = await Promise.allSettled(
    NEWS_ENDPOINTS.map(async ({ sport, url }) => newsArticles(await fetchJson(url), sport)),
  );
  const articles = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    log("warn", "sports_news_sources_failed", {
      failedSources: failures.length,
      totalSources: results.length,
      errors: failures.slice(0, 2).map((result) => serializeError(result.reason)),
    });
  }
  return dedupeSportsNews(articles).slice(0, 20);
}
