export type SportsMatch = {
  id: string;
  leagueId: string;
  leagueName: string;
  sport: "Soccer" | "Basketball" | "Football" | "Other";
  homeTeamName: string;
  homeTeamLogo: string;
  awayTeamName: string;
  awayTeamLogo: string;
  matchTime: string;
  status: number;
  homeScore?: number;
  awayScore?: number;
  liveUrl?: string;
  replayUrl?: string;
};

export type SportsNews = {
  id: string;
  headline: string;
  description: string;
  imageUrl?: string;
  url: string;
  publishedAt: string;
  sport: SportsMatch["sport"];
};

function normalizedKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sportsMatchKey(match: SportsMatch) {
  const teams = [normalizedKey(match.homeTeamName), normalizedKey(match.awayTeamName)].sort();
  return `${normalizedKey(match.leagueName)}:${teams.join(":")}`;
}

export function mergeSportsMatches(matches: SportsMatch[]) {
  const merged = new Map<string, SportsMatch>();

  for (const match of matches) {
    const key = sportsMatchKey(match);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, match);
      continue;
    }

    const preferred =
      Number(Boolean(match.liveUrl || match.replayUrl)) >
      Number(Boolean(current.liveUrl || current.replayUrl))
        ? match
        : current;
    const fallback = preferred === current ? match : current;
    merged.set(key, {
      ...fallback,
      ...preferred,
      homeTeamLogo: preferred.homeTeamLogo || fallback.homeTeamLogo,
      awayTeamLogo: preferred.awayTeamLogo || fallback.awayTeamLogo,
      liveUrl: preferred.liveUrl || fallback.liveUrl,
      replayUrl: preferred.replayUrl || fallback.replayUrl,
      status: Math.max(preferred.status, fallback.status),
    });
  }

  return [...merged.values()].sort((a, b) => {
    if (a.status === 1 && b.status !== 1) return -1;
    if (b.status === 1 && a.status !== 1) return 1;
    return sportsMatchTimestamp(a.matchTime) - sportsMatchTimestamp(b.matchTime);
  });
}

export function dedupeSportsNews(articles: SportsNews[]) {
  const seen = new Set<string>();
  return articles
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((article) => {
      let urlKey = article.url;
      try {
        const url = new URL(article.url);
        url.search = "";
        url.hash = "";
        urlKey = url.toString();
      } catch {
        // Fall back to the normalized headline.
      }
      const key = urlKey || normalizedKey(article.headline);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function sportsMatchTimestamp(value: string) {
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return value.length <= 10 ? numeric * 1_000 : numeric;
  }
  const safeValue = value.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/, "$1T$2");
  const parsed = Date.parse(safeValue);
  return Number.isFinite(parsed) ? parsed : 8640000000000000;
}

export function sportsMediaUrl(value: unknown, requireMediaHint = true) {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const mediaHint = `${url.pathname}${url.search}`.toLowerCase();
    if (requireMediaHint && !mediaHint.includes(".m3u8") && !mediaHint.includes(".mp4")) {
      return undefined;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sportsPlaybackType(value: string) {
  try {
    const url = new URL(value, "http://localhost");
    const inner = url.pathname === "/api/sports-stream" ? url.searchParams.get("url") : value;
    if (!inner) return null;
    const hint = inner.toLowerCase();
    if (hint.includes(".m3u8")) return "hls" as const;
    if (hint.includes(".mp4")) return "mp4" as const;
  } catch {
    return null;
  }
  return null;
}
