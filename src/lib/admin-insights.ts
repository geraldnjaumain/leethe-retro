import type { AdminDashboard, ProductEventName } from "./product";

export type AdminTab = "command" | "audience" | "reliability" | "support" | "catalog";
export type AlertSeverity = "critical" | "warning" | "info";

export type OperationalAlert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  tab: AdminTab;
};

export function eventCount(data: AdminDashboard, name: ProductEventName) {
  return data.eventTotals.find((event) => event.name === name)?.count ?? 0;
}

export function ratio(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

export function trendDelta(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function ageInHours(value: string | null, now = Date.now()) {
  return value ? Math.max(0, (now - new Date(value).getTime()) / 3_600_000) : 0;
}

export function buildOperationalAlerts(data: AdminDashboard, now = Date.now()): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const playbackStarts = eventCount(data, "playback_start");
  const playbackErrors = eventCount(data, "playback_error");
  const playbackErrorRate = ratio(playbackErrors, playbackStarts);
  const stalePageRate = ratio(data.system.staleCatalogPages, data.system.catalogPages);
  const detailCoverage = ratio(data.system.catalogDetails, data.system.catalogTitles);
  const oldestTicketHours = ageInHours(data.system.oldestOpenTicket, now);

  if (data.system.recentSyncFailures > 0) {
    alerts.push({
      id: "sync-failures",
      severity: "critical",
      title: "Catalog sync failures need attention",
      detail: `${data.system.recentSyncFailures} failed sync attempt${data.system.recentSyncFailures === 1 ? "" : "s"} in the last 24 hours.`,
      tab: "reliability",
    });
  }
  if (playbackStarts >= 5 && playbackErrorRate >= 10) {
    alerts.push({
      id: "playback-error-rate",
      severity: "critical",
      title: "Playback error rate is elevated",
      detail: `${playbackErrorRate.toFixed(1)}% of playback starts reported an error in the last 14 days.`,
      tab: "audience",
    });
  }
  if (data.system.ticketsOlderThan7Days > 0 || oldestTicketHours >= 168) {
    alerts.push({
      id: "aged-support",
      severity: "critical",
      title: "Support backlog breached seven days",
      detail: `${data.system.ticketsOlderThan7Days} unresolved ticket${data.system.ticketsOlderThan7Days === 1 ? "" : "s"} are older than seven days.`,
      tab: "support",
    });
  } else if (data.system.ticketsOlderThan24Hours > 0) {
    alerts.push({
      id: "aged-support",
      severity: "warning",
      title: "Support backlog is aging",
      detail: `${data.system.ticketsOlderThan24Hours} unresolved ticket${data.system.ticketsOlderThan24Hours === 1 ? "" : "s"} are older than 24 hours.`,
      tab: "support",
    });
  }
  if (stalePageRate >= 25) {
    alerts.push({
      id: "stale-catalog",
      severity: stalePageRate >= 75 ? "critical" : "warning",
      title: "Catalog cache is stale",
      detail: `${stalePageRate.toFixed(0)}% of cached catalog pages are older than 24 hours.`,
      tab: "catalog",
    });
  }
  if (detailCoverage < 25) {
    alerts.push({
      id: "detail-coverage",
      severity: "warning",
      title: "Title detail coverage is low",
      detail: `Only ${detailCoverage.toFixed(0)}% of catalog titles have persisted detail payloads.`,
      tab: "catalog",
    });
  }
  if (data.system.dashboardQueryMs >= 1_500) {
    alerts.push({
      id: "dashboard-query",
      severity: "warning",
      title: "Operations query is slow",
      detail: `The latest dashboard read took ${data.system.dashboardQueryMs.toLocaleString()} ms.`,
      tab: "reliability",
    });
  }
  if (data.system.analytics === "disabled") {
    alerts.push({
      id: "analytics-disabled",
      severity: "info",
      title: "Product analytics are disabled",
      detail:
        "Audience and playback trends will remain empty until first-party analytics are enabled.",
      tab: "audience",
    });
  }
  if (!alerts.length) {
    alerts.push({
      id: "all-clear",
      severity: "info",
      title: "No active operational alerts",
      detail: "The current thresholds do not indicate an incident or overdue workflow.",
      tab: "command",
    });
  }
  return alerts;
}

export function reliabilityScore(data: AdminDashboard) {
  const alerts = buildOperationalAlerts(data);
  const deductions = alerts.reduce((total, alert) => {
    if (alert.id === "all-clear" || alert.id === "analytics-disabled") return total;
    return total + (alert.severity === "critical" ? 20 : alert.severity === "warning" ? 8 : 2);
  }, 0);
  return Math.max(0, 100 - deductions);
}
