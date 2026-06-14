import { describe, expect, it } from "vitest";
import {
  buildOperationalAlerts,
  ratio,
  reliabilityScore,
  trendDelta,
} from "../src/lib/admin-insights";
import type { AdminDashboard } from "../src/lib/product";

function dashboard(overrides: Partial<AdminDashboard["system"]> = {}): AdminDashboard {
  return {
    totals: { pageViews: 100, playbackStarts: 20, downloads: 2, openTickets: 0 },
    previousTotals: { pageViews: 80, playbackStarts: 10, downloads: 1, openTickets: 0 },
    daily: [],
    eventTotals: [
      { name: "page_view", count: 100 },
      { name: "playback_start", count: 20 },
      { name: "playback_error", count: 0 },
      { name: "download", count: 2 },
      { name: "support_submitted", count: 0 },
    ],
    uniqueSessions: 40,
    topPaths: [],
    mediaTypes: [],
    tickets: [],
    ticketTotal: 0,
    system: {
      database: "healthy",
      analytics: "enabled",
      streamResolver: "disabled",
      dashboardQueryMs: 100,
      catalogTitles: 100,
      catalogDetails: 100,
      catalogShards: 1,
      catalogPages: 20,
      staleCatalogPages: 0,
      recentSyncFailures: 0,
      activeRateLimitBuckets: 0,
      schemaMigrations: 6,
      lastCatalogSync: new Date().toISOString(),
      lastAnalyticsEvent: new Date().toISOString(),
      oldestOpenTicket: null,
      resolvedLast14Days: 0,
      ticketsOlderThan24Hours: 0,
      ticketsOlderThan7Days: 0,
      tickets: { open: 0, inProgress: 0, resolved: 0 },
      ...overrides,
    },
    popularTitles: [],
    catalogBreakdown: [],
    shardStats: [],
    supportCategories: [],
    recentSyncEvents: [],
    auditEvents: [],
  };
}

describe("admin insights", () => {
  it("calculates production ratios and trends without dividing by zero", () => {
    expect(ratio(5, 20)).toBe(25);
    expect(ratio(5, 0)).toBe(0);
    expect(trendDelta(120, 100)).toBe(20);
  });

  it("surfaces actionable catalog and support alerts", () => {
    const data = dashboard({
      catalogDetails: 10,
      staleCatalogPages: 18,
      ticketsOlderThan7Days: 2,
    });
    expect(buildOperationalAlerts(data).map((alert) => alert.id)).toEqual(
      expect.arrayContaining(["aged-support", "stale-catalog", "detail-coverage"]),
    );
    expect(reliabilityScore(data)).toBeLessThan(70);
  });

  it("reports an all-clear state when no threshold is breached", () => {
    expect(buildOperationalAlerts(dashboard())).toEqual([
      expect.objectContaining({ id: "all-clear" }),
    ]);
    expect(reliabilityScore(dashboard())).toBe(100);
  });
});
