import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/catalog-db.server", () => ({
  checkCatalogDatabaseReadiness: vi.fn().mockRejectedValue(new Error("Database unavailable")),
}));

vi.mock("../src/lib/env.server", () => ({
  validateProductionEnv: vi.fn(),
}));

vi.mock("../src/lib/logger.server", () => ({
  log: vi.fn(),
  serializeError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { serveHealthCheck } from "../src/lib/health.server";

describe("readiness degradation", () => {
  it("keeps normal readiness routable while reporting a database outage", async () => {
    const response = await serveHealthCheck(new Request("https://example.com/readyz"));

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "degraded",
      database: "unavailable",
    });
  });

  it("fails strict readiness so operational checks alert", async () => {
    const response = await serveHealthCheck(new Request("https://example.com/readyz?strict=1"));

    expect(response?.status).toBe(503);
  });
});
