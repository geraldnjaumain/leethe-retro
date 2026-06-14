import { describe, expect, it } from "vitest";
import { getServerConfig } from "../src/lib/config.server";
import { validateProductionEnv } from "../src/lib/env.server";
import { serveHealthCheck } from "../src/lib/health.server";
import { consumeRateLimit, rateLimitResponse } from "../src/lib/rate-limit.server";
import { applySecurityHeaders } from "../src/lib/security-headers.server";
import {
  renderRobotsTxt,
  renderSitemapXml,
  serveSiteMetadata,
} from "../src/lib/site-metadata.server";
import { validateCatalogRequest, validateTmdbRequest } from "../src/lib/tmdb";
import {
  validateSkipSegmentsInput,
  validateStreamInput,
  validateSubtitleUrl,
} from "../src/lib/stream";

describe("production input boundaries", () => {
  it("rejects a weak configured production admin password", () => {
    const keys = [
      "NODE_ENV",
      "DATABASE_URL",
      "TMDB_READ_ACCESS_TOKEN",
      "SITE_URL",
      "LEGAL_CONTACT_EMAIL",
      "ADMIN_PASSWORD",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

    try {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgresql://example.com/database";
      process.env.TMDB_READ_ACCESS_TOKEN = "test-read-access-token-long-enough";
      process.env.SITE_URL = "https://example.com";
      process.env.LEGAL_CONTACT_EMAIL = "legal@example.com";
      process.env.ADMIN_PASSWORD = "short";
      expect(() => validateProductionEnv()).toThrow();
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("requires both rights gates before enabling the external stream resolver", () => {
    const previousEnabled = process.env.ENABLE_EXTERNAL_STREAM_RESOLVER;
    const previousConfirmed = process.env.STREAMING_RIGHTS_CONFIRMED;

    try {
      process.env.ENABLE_EXTERNAL_STREAM_RESOLVER = "false";
      process.env.STREAMING_RIGHTS_CONFIRMED = "false";
      expect(getServerConfig().externalStreamResolverEnabled).toBe(false);

      process.env.ENABLE_EXTERNAL_STREAM_RESOLVER = "true";
      expect(getServerConfig().externalStreamResolverEnabled).toBe(false);

      process.env.STREAMING_RIGHTS_CONFIRMED = "true";
      expect(getServerConfig().externalStreamResolverEnabled).toBe(true);
    } finally {
      if (previousEnabled === undefined) delete process.env.ENABLE_EXTERNAL_STREAM_RESOLVER;
      else process.env.ENABLE_EXTERNAL_STREAM_RESOLVER = previousEnabled;
      if (previousConfirmed === undefined) delete process.env.STREAMING_RIGHTS_CONFIRMED;
      else process.env.STREAMING_RIGHTS_CONFIRMED = previousConfirmed;
    }
  });

  it("caps catalog pages", () => {
    expect(
      validateCatalogRequest({ action: "discover", type: "movie", page: 99999 }),
    ).toMatchObject({
      page: 500,
    });
  });

  it("rejects arbitrary TMDB proxy paths", () => {
    expect(() => validateTmdbRequest({ path: "/configuration" })).toThrow("Invalid TMDB path");
    expect(validateTmdbRequest({ path: "/tv/123/season/2" }).path).toBe("/tv/123/season/2");
  });

  it("caps stream episode and rejects malformed ids", () => {
    expect(
      validateStreamInput({ title: "Example", type: "tv", episode: 999999, tmdbId: "../1" }),
    ).toMatchObject({ episode: 10_000, tmdbId: undefined });
  });

  it("rejects private-network and insecure subtitle proxy targets", () => {
    expect(() => validateSubtitleUrl("http://captions.example.com/subtitle.vtt")).toThrow(
      "Invalid subtitle URL",
    );
    expect(() => validateSubtitleUrl("https://127.0.0.1/subtitle.vtt")).toThrow(
      "Invalid subtitle URL",
    );
    expect(() => validateSubtitleUrl("https://[::1]/subtitle.vtt")).toThrow("Invalid subtitle URL");
    expect(() => validateSubtitleUrl("https://metadata.google.internal/subtitle.vtt")).toThrow(
      "Invalid subtitle URL",
    );
    expect(validateSubtitleUrl("https://cdn.example.com/subtitle.vtt#track")).toBe(
      "https://cdn.example.com/subtitle.vtt",
    );
  });

  it("validates skip-segment title and episode identifiers", () => {
    expect(validateSkipSegmentsInput({ tmdbId: "123", mediaType: "movie" })).toEqual({
      tmdbId: "123",
      mediaType: "movie",
      season: undefined,
      episode: undefined,
    });
    expect(() => validateSkipSegmentsInput({ tmdbId: "../123", mediaType: "movie" })).toThrow(
      "Invalid title id",
    );
    expect(() => validateSkipSegmentsInput({ tmdbId: "123", mediaType: "tv" })).toThrow(
      "Invalid episode",
    );
  });
});

describe("HTTP protection", () => {
  it("sets the security header baseline", () => {
    const response = applySecurityHeaders(new Response("ok"), "request-1");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe("request-1");
  });

  it("enforces request limits", () => {
    const request = new Request("https://example.com");
    expect(consumeRateLimit(request, "test", 1, 60_000).allowed).toBe(true);
    expect(consumeRateLimit(request, "test", 1, 60_000).allowed).toBe(false);
  });

  it("uses a generous global circuit breaker without a trusted proxy", async () => {
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "false";
    const request = new Request("https://example.com");

    try {
      for (let index = 0; index < 100; index += 1) {
        expect(await rateLimitResponse(request, "global-circuit-test", 1)).toBeNull();
      }
      expect((await rateLimitResponse(request, "global-circuit-test", 1))?.status).toBe(429);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });

  it("serves liveness without requiring database readiness", async () => {
    const response = await serveHealthCheck(new Request("https://example.com/healthz"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    await expect(response?.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("serves crawler metadata only on its dedicated routes", async () => {
    const previous = process.env.SITE_URL;
    process.env.SITE_URL = "https://example.com";

    try {
      const request = new Request("https://example.com/robots.txt");
      await expect(renderRobotsTxt(request).text()).resolves.toContain(
        "Sitemap: https://example.com/sitemap.xml",
      );
      await expect(renderSitemapXml(request).text()).resolves.toContain("<urlset");
      expect(serveSiteMetadata(new Request("https://example.com/unrelated"))).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  });
});
