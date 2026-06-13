import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "read" as "read" | "write" | "miss",
  written: false,
}));
const payloadQuery = vi.hoisted(() =>
  vi.fn(async (text: string) => {
    if (text.includes("SELECT path") && state.mode === "read") {
      return [
        {
          path: "/collection/1001",
          params: {},
          body: { id: 1001, name: "Persisted Collection" },
          stored_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
        },
      ];
    }
    if (text.includes("INSERT INTO tmdb_payload_cache")) state.written = true;
    return [];
  }),
);

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: payloadQuery }),
}));

vi.mock("../src/lib/env.server", () => ({
  envValue: (key: string) => {
    if (key === "DATABASE_URL") return "postgres://cache.test/db";
    if (key === "TMDB_READ_ACCESS_TOKEN") return "test-token";
    return undefined;
  },
  localCacheDirectory: () => undefined,
}));

vi.mock("../src/lib/logger.server", () => ({
  log: vi.fn(),
  serializeError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { tmdbCachedRequest } from "../src/lib/tmdb-cache.server";

describe("persistent direct TMDB payload cache", () => {
  beforeEach(() => {
    state.mode = "read";
    state.written = false;
    payloadQuery.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Upstream must not be used for this test.")),
    );
  });

  it("serves a persisted collection without contacting TMDB", async () => {
    const result = await tmdbCachedRequest<{ id: number; name: string }>("/collection/1001");

    expect(result.name).toBe("Persisted Collection");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists a newly fetched TV season", async () => {
    state.mode = "write";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1002, name: "Season 1", episodes: [] }), {
          status: 200,
        }),
      ),
    );

    const result = await tmdbCachedRequest<{ id: number; name: string }>("/tv/1002/season/1");

    expect(result.name).toBe("Season 1");
    expect(state.written).toBe(true);
  });

  it("does not persist broad search or discover payloads", async () => {
    state.mode = "miss";

    await expect(tmdbCachedRequest("/discover/movie")).rejects.toThrow(
      "Upstream must not be used for this test.",
    );
    expect(payloadQuery).not.toHaveBeenCalled();
  });
});
