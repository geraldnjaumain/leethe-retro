import { describe, expect, it } from "vitest";
import {
  dedupeSportsNews,
  mergeSportsMatches,
  sportsMediaUrl,
  sportsMatchTimestamp,
  sportsPlaybackType,
  type SportsMatch,
} from "../src/lib/sports-data";

function match(overrides: Partial<SportsMatch> = {}): SportsMatch {
  return {
    id: "one",
    leagueId: "world",
    leagueName: "FIFA World Cup",
    sport: "Soccer",
    homeTeamName: "Germany",
    homeTeamLogo: "",
    awayTeamName: "Curaçao",
    awayTeamLogo: "",
    matchTime: "2026-06-14T18:00:00Z",
    status: 1,
    homeScore: 4,
    awayScore: 1,
    ...overrides,
  };
}

describe("sports data", () => {
  it("merges duplicate matches while preserving the playable source", () => {
    const matches = mergeSportsMatches([
      match({ id: "schedule", awayTeamName: "Curacao" }),
      match({ id: "stream", liveUrl: "/api/sports-stream?url=source" }),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: "stream",
      liveUrl: "/api/sports-stream?url=source",
    });
  });

  it("deduplicates news links across feeds", () => {
    const articles = dedupeSportsNews([
      {
        id: "one",
        headline: "Final result",
        description: "",
        url: "https://example.com/story?source=feed",
        publishedAt: "2026-06-14T10:00:00Z",
        sport: "Soccer",
      },
      {
        id: "two",
        headline: "Final result",
        description: "",
        url: "https://example.com/story",
        publishedAt: "2026-06-14T11:00:00Z",
        sport: "Soccer",
      },
    ]);

    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe("two");
  });

  it("only exposes direct HTTPS media through the sports proxy", () => {
    const hls = sportsMediaUrl("https://cdn.example.com/live/master.m3u8?token=one");
    expect(hls).toBe("https://cdn.example.com/live/master.m3u8?token=one");
    expect(
      sportsPlaybackType(`/api/sports-stream?url=${encodeURIComponent(hls!)}&sig=example`),
    ).toBe("hls");
    expect(sportsPlaybackType("https://cdn.example.com/replay.mp4")).toBe("mp4");
    expect(sportsMediaUrl("https://example.com/watch.html")).toBeUndefined();
    expect(sportsMediaUrl("http://cdn.example.com/live.m3u8")).toBeUndefined();
  });

  it("normalizes second and millisecond timestamps", () => {
    expect(sportsMatchTimestamp("1710000000")).toBe(1_710_000_000_000);
    expect(sportsMatchTimestamp("1710000000000")).toBe(1_710_000_000_000);
  });
});
