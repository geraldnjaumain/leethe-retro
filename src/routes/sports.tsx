import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/leethe/Nav";
import { getSportsData, getSportsNews } from "@/lib/sports";
import type { SportsMatch } from "@/lib/sports";
import { sportsMatchTimestamp } from "@/lib/sports-data";
import { SportsPlayer } from "@/components/leethe/SportsPlayer";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/sports")({
  head: () => ({ meta: [{ title: "Leethe - Sports" }] }),
  component: SportsPage,
});

function SportsPage() {
  const navigate = useNavigate({ from: "/sports" });
  const [playingMatch, setPlayingMatch] = useState<{ url: string; title: string } | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<"all" | "live" | "upcoming" | "results">(
    "all",
  );

  const query = useQuery({
    queryKey: ["sports-matches"],
    queryFn: () => getSportsData(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const newsQuery = useQuery({
    queryKey: ["sports-news"],
    queryFn: () => getSportsNews(),
    staleTime: 60_000 * 15,
  });

  const leagues = useMemo(() => {
    if (!query.data) return ["All"];
    const uniqueLeagues = Array.from(new Set(query.data.map((m) => m.leagueName)));
    return ["All", ...uniqueLeagues.sort()];
  }, [query.data]);

  const { featuredUpcoming, standardMatches } = useMemo(() => {
    if (!query.data) return { featuredUpcoming: [], standardMatches: [] };
    const leagueMatches =
      selectedLeague === "All"
        ? query.data
        : query.data.filter((m) => m.leagueName === selectedLeague);
    const filteredData = leagueMatches.filter((match) => {
      if (selectedStatus === "live") return match.status === 1;
      if (selectedStatus === "upcoming") return match.status === 0;
      if (selectedStatus === "results") return match.status === 2;
      return true;
    });

    const now = Date.now();
    const upcoming = filteredData
      .filter((m) => m.status === 0)
      .map((m) => ({
        ...m,
        parsedTime: sportsMatchTimestamp(m.matchTime),
      }));

    // Find upcoming matches starting soon (strictly within the next 4 hours)
    const featured = upcoming
      .filter((m) => m.parsedTime > now - 3600000 && m.parsedTime < now + 4 * 3600000)
      .sort((a, b) => a.parsedTime - b.parsedTime);

    const featuredIds = new Set(featured.map((f) => f.id));
    const standard = filteredData.filter((m) => !featuredIds.has(m.id));

    return { featuredUpcoming: featured, standardMatches: standard };
  }, [query.data, selectedLeague, selectedStatus]);

  const totals = useMemo(
    () => ({
      live: query.data?.filter((match) => match.status === 1).length ?? 0,
      upcoming: query.data?.filter((match) => match.status === 0).length ?? 0,
      results: query.data?.filter((match) => match.status === 2).length ?? 0,
    }),
    [query.data],
  );

  return (
    <div className="min-h-screen">
      {playingMatch && (
        <SportsPlayer
          url={playingMatch.url}
          title={playingMatch.title}
          onClose={() => setPlayingMatch(null)}
        />
      )}
      <Nav
        type="movie"
        onTypeChange={(t) => navigate({ to: "/", search: { type: t } })}
        sort="popular"
        onSortChange={() => {}}
        activeTab="sports"
      />
      <main className="mx-auto max-w-[1200px] px-3 py-5 sm:px-4 sm:py-6 animate-fade-in">
        <section className="panel-aluminum mb-7 overflow-hidden rounded-lg p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80">
                Sports center
              </div>
              <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-foreground">
                Live scores, schedules, and highlights
              </h1>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                Scores refresh every minute. Watch controls appear only when a playable direct
                source is available.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[11px] disabled:opacity-50"
            >
              {query.isFetching ? "Refreshing..." : "Refresh scores"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <SportsTotal label="Live now" value={totals.live} active={totals.live > 0} />
            <SportsTotal label="Upcoming" value={totals.upcoming} />
            <SportsTotal label="Recent results" value={totals.results} />
          </div>
        </section>

        <h2 className="mb-4 text-[18px] font-semibold tracking-tight text-foreground/90">
          Top sports news
        </h2>
        {newsQuery.isLoading ? (
          <div className="mb-8 h-[220px] animate-pulse rounded-xl bg-white/5" />
        ) : newsQuery.data && newsQuery.data.length > 0 ? (
          <div className="mb-8 flex space-x-4 overflow-x-auto pb-4 scrollbar-hide">
            {newsQuery.data.map((news) => (
              <a
                key={news.id}
                href={news.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex h-[240px] w-[300px] shrink-0 flex-col justify-end overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10 transition-transform hover:scale-[1.02]"
              >
                <div className="absolute left-3 top-3 z-10 rounded-full bg-black/65 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
                  {news.sport}
                </div>
                {news.imageUrl && (
                  <img
                    src={news.imageUrl}
                    alt={news.headline}
                    className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity group-hover:opacity-80"
                    loading="lazy"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="relative z-10 p-4">
                  <h3 className="line-clamp-3 text-[14px] font-bold leading-snug text-white">
                    {news.headline}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[11px] text-white/70">{news.description}</p>
                </div>
              </a>
            ))}
          </div>
        ) : null}

        <div className="mt-8 mb-6 flex items-center justify-between border-t border-white/10 pt-8">
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground/90">Matches</h2>
        </div>

        <div className="mb-3 flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
          {[
            ["all", "All matches"],
            ["live", `Live ${totals.live}`],
            ["upcoming", "Upcoming"],
            ["results", "Results"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedStatus(value as typeof selectedStatus)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                selectedStatus === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {leagues.length > 1 ? (
          <div className="mb-6 flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
            {leagues.map((league) => (
              <button
                key={league}
                type="button"
                onClick={() => setSelectedLeague(league)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  selectedLeague === league
                    ? "bg-white text-black"
                    : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {league}
              </button>
            ))}
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            Loading matches...
          </div>
        ) : query.isError ? (
          <div className="panel-aluminum rounded-lg py-12 text-center text-[13px] text-destructive">
            <div>Failed to load sports data.</div>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="chip-pill chip-pill-interactive mt-3 rounded-full px-4 py-1 text-[11px] text-foreground"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {featuredUpcoming.length > 0 && (
              <div className="mb-8">
                <h2 className="mb-4 flex items-center gap-2 text-[14px] font-bold text-foreground/90 uppercase tracking-wider text-[oklch(0.6_0.15_245)]">
                  <svg
                    className="h-4 w-4 animate-pulse"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Starting Soon
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featuredUpcoming.map((match) => (
                    <MatchCard
                      key={match.id}
                      match={match}
                      featured
                      onPlay={(url) =>
                        setPlayingMatch({
                          url,
                          title: `${match.homeTeamName} vs ${match.awayTeamName}`,
                        })
                      }
                    />
                  ))}
                </div>
                <h2 className="mt-8 mb-4 text-[14px] font-bold text-foreground/90 uppercase tracking-wider text-muted-foreground">
                  All Matches
                </h2>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {standardMatches.length === 0 && featuredUpcoming.length === 0 ? (
                <div className="col-span-full py-12 text-center text-[13px] text-muted-foreground">
                  No matches available.
                </div>
              ) : (
                standardMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    onPlay={(url) =>
                      setPlayingMatch({
                        url,
                        title: `${match.homeTeamName} vs ${match.awayTeamName}`,
                      })
                    }
                  />
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SportsTotal({
  label,
  value,
  active = false,
}: {
  label: string;
  value: number;
  active?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/8 bg-black/15 px-3 py-2">
      <div className={`text-[20px] font-semibold tabular-nums ${active ? "text-red-400" : ""}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function MatchCard({
  match,
  onPlay,
  featured = false,
}: {
  match: SportsMatch;
  onPlay: (url: string) => void;
  featured?: boolean;
}) {
  const matchDate = match.matchTime
    ? new Date(sportsMatchTimestamp(match.matchTime)).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <article
      className={`flex flex-col justify-between overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-1 ${
        featured
          ? "bg-gradient-to-br from-[oklch(0.2_0.02_250)] to-[oklch(0.12_0.01_250)] border-t border-[oklch(0.6_0.15_245)]"
          : "panel-aluminum"
      }`}
    >
      <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span className="truncate pr-2" title={match.leagueName}>
          {match.leagueName}
        </span>
        <span className="shrink-0">
          {match.status === 1 ? (
            <span className="flex items-center gap-1.5 text-red-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
              Live
            </span>
          ) : (
            <span className={featured ? "text-[oklch(0.6_0.15_245)] font-bold" : ""}>
              {matchDate}
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex w-2/5 flex-col items-center gap-2">
          <div
            className={`grid place-items-center overflow-hidden rounded-md bg-white/5 p-1.5 ${featured ? "h-16 w-16" : "h-12 w-12"}`}
          >
            {match.homeTeamLogo ? (
              <img
                src={match.homeTeamLogo}
                alt={match.homeTeamName}
                className="max-h-full max-w-full object-contain drop-shadow-md"
                loading="lazy"
              />
            ) : (
              <TeamFallback name={match.homeTeamName} />
            )}
          </div>
          <div
            className={`text-center font-semibold leading-tight line-clamp-2 ${featured ? "text-[14px]" : "text-[12px]"}`}
          >
            {match.homeTeamName}
          </div>
        </div>

        <div className="w-1/5 text-center">
          <div
            className={`font-bold tabular-nums text-foreground/90 ${featured ? "text-2xl" : "text-xl"}`}
          >
            {match.status === 1 || match.status === 2
              ? `${match.homeScore ?? "-"}:${match.awayScore ?? "-"}`
              : "VS"}
          </div>
        </div>

        <div className="flex w-2/5 flex-col items-center gap-2">
          <div
            className={`grid place-items-center overflow-hidden rounded-md bg-white/5 p-1.5 ${featured ? "h-16 w-16" : "h-12 w-12"}`}
          >
            {match.awayTeamLogo ? (
              <img
                src={match.awayTeamLogo}
                alt={match.awayTeamName}
                className="max-h-full max-w-full object-contain drop-shadow-md"
                loading="lazy"
              />
            ) : (
              <TeamFallback name={match.awayTeamName} />
            )}
          </div>
          <div
            className={`text-center font-semibold leading-tight line-clamp-2 ${featured ? "text-[14px]" : "text-[12px]"}`}
          >
            {match.awayTeamName}
          </div>
        </div>
      </div>

      {match.liveUrl && match.status === 1 ? (
        <button
          type="button"
          onClick={() => onPlay(match.liveUrl!)}
          className="mt-2 block w-full rounded-md bg-gradient-to-b from-[oklch(0.6_0.15_245)] to-[oklch(0.5_0.15_245)] px-3 py-2 text-center text-[12px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Watch live
        </button>
      ) : match.status === 1 ? (
        <button
          type="button"
          disabled
          className="mt-2 block w-full rounded-md bg-white/5 px-3 py-2 text-center text-[12px] font-semibold text-white/40 cursor-not-allowed"
        >
          Stream Unavailable
        </button>
      ) : match.replayUrl && match.status === 2 ? (
        <button
          type="button"
          onClick={() => onPlay(match.replayUrl!)}
          className="mt-2 block w-full rounded-md bg-gradient-to-b from-white/20 to-white/10 px-3 py-2 text-center text-[12px] font-semibold text-white shadow-sm transition-all hover:bg-white/30 active:scale-[0.98]"
        >
          Watch Highlights
        </button>
      ) : null}
    </article>
  );
}

function TeamFallback({ name }: { name: string }) {
  return (
    <span className="text-[13px] font-semibold uppercase tracking-wider text-white/35">
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")}
    </span>
  );
}
