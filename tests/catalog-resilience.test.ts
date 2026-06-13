import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  mode: "database-down" as "database-down" | "stale-discover" | "stale-detail" | "detail-write",
  detailWriteFinished: false,
}));
const tmdbRequest = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/env.server", () => ({
  envValue: (key: string) => (key === "DATABASE_URL" ? "postgres://catalog.test/db" : undefined),
}));

vi.mock("../src/lib/logger.server", () => ({
  log: vi.fn(),
  serializeError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

vi.mock("../src/lib/tmdb-cache.server", () => ({
  tmdbCachedRequest: tmdbRequest,
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    const query = async (text: string, params: unknown[] = []) => {
      if (testState.mode === "database-down") throw new Error("Database unavailable");
      if (text.includes("FROM schema_migrations")) return [{ count: 5 }];

      if (text.includes("FROM catalog_pages")) {
        return params[2] === true ? [{ title_tmdb_ids: [1], total_pages: 1 }] : [];
      }

      if (text.includes("FROM unnest") && text.includes("JOIN media_titles")) {
        return [
          {
            media_type: "movie",
            tmdb_id: 1,
            title: "Cached Movie",
            overview: "Available during an upstream outage.",
            vote_average: 8,
            genre_ids: [],
            raw: {},
          },
        ];
      }

      if (text.includes("SELECT *") && text.includes("detail_raw IS NOT NULL")) {
        if (testState.mode !== "stale-detail" || params[2] !== true) return [];
        return [
          {
            media_type: "movie",
            tmdb_id: 1,
            title: "Cached Detail",
            overview: "Stale detail.",
            vote_average: 8,
            raw: {},
            detail_raw: { id: 1, title: "Cached Detail", overview: "Stale detail." },
          },
        ];
      }

      if (text.includes("UPDATE media_titles") && text.includes("detail_raw")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        testState.detailWriteFinished = true;
      }

      return [];
    };

    return {
      query,
      transaction: async (queries: Array<Promise<unknown>>) => Promise.all(queries),
    };
  },
}));

import { discoverWithDatabase, fetchDetailWithDatabase } from "../src/lib/catalog-db.server";

describe("catalog outage resilience", () => {
  beforeEach(() => {
    testState.mode = "database-down";
    testState.detailWriteFinished = false;
    tmdbRequest.mockReset();
  });

  it("serves live TMDB data while the database is unavailable", async () => {
    tmdbRequest.mockResolvedValue({
      page: 1,
      total_pages: 1,
      results: [{ id: 2, title: "Live Movie", overview: "" }],
    });

    const result = await discoverWithDatabase("movie");

    expect(result.results[0]?.title).toBe("Live Movie");
  });

  it("serves stale database pages when TMDB is unavailable", async () => {
    testState.mode = "stale-discover";
    tmdbRequest.mockRejectedValue(new Error("TMDB unavailable"));

    const result = await discoverWithDatabase("movie");

    expect(result.results[0]?.title).toBe("Cached Movie");
  });

  it("serves stale title details when TMDB is unavailable", async () => {
    testState.mode = "stale-detail";
    tmdbRequest.mockRejectedValue(new Error("TMDB unavailable"));

    const result = await fetchDetailWithDatabase("movie", 1);

    expect(result.title).toBe("Cached Detail");
  });

  it("waits for durable detail persistence before returning", async () => {
    testState.mode = "detail-write";
    tmdbRequest.mockResolvedValue({
      id: 1,
      title: "Fresh Detail",
      overview: "Fresh detail.",
      genres: [],
    });

    const result = await fetchDetailWithDatabase("movie", 1);

    expect(result.title).toBe("Fresh Detail");
    expect(testState.detailWriteFinished).toBe(true);
  });
});
