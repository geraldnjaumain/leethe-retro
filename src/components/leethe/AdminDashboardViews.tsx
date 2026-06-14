import { useMemo, useState, type ReactNode } from "react";
import {
  buildOperationalAlerts,
  eventCount,
  ratio,
  reliabilityScore,
  trendDelta,
  type AdminTab,
  type OperationalAlert,
} from "@/lib/admin-insights";
import type { AdminDashboard } from "@/lib/product";

const tabLabels: Record<AdminTab, string> = {
  command: "Command center",
  audience: "Audience",
  reliability: "Reliability",
  support: "Support",
  catalog: "Catalog",
};

const tabDescriptions: Record<AdminTab, string> = {
  command: "Priorities, outcomes, and active risks",
  audience: "Engagement, playback quality, and affected paths",
  reliability: "Dependencies, cache freshness, and operator activity",
  support: "Backlog, aging, categories, and ticket workflows",
  catalog: "Coverage, freshness, shards, and popular inventory",
};

export function AdminTabNav({
  activeTab,
  alerts,
  onChange,
}: {
  activeTab: AdminTab;
  alerts: OperationalAlert[];
  onChange: (tab: AdminTab) => void;
}) {
  const alertCounts = useMemo(
    () =>
      alerts.reduce(
        (counts, alert) => {
          if (alert.severity !== "info") counts[alert.tab] += 1;
          return counts;
        },
        { command: 0, audience: 0, reliability: 0, support: 0, catalog: 0 },
      ),
    [alerts],
  );

  return (
    <nav aria-label="Operations dashboard views" className="space-y-1" role="tablist">
      {(Object.keys(tabLabels) as AdminTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => onChange(tab)}
          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2.5 text-left transition-colors ${
            activeTab === tab
              ? "border-primary/35 bg-primary/12 text-foreground"
              : "border-transparent text-muted-foreground hover:border-[var(--aluminum-line)] hover:bg-white/5 hover:text-foreground"
          }`}
        >
          <AdminTabIcon tab={tab} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium">{tabLabels[tab]}</span>
            <span className="mt-0.5 block line-clamp-1 text-[8px] opacity-70">
              {tabDescriptions[tab]}
            </span>
          </span>
          {alertCounts[tab] ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[oklch(0.62_0.18_45)] px-1 text-[8px] font-semibold text-white">
              {alertCounts[tab]}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function MobileAdminTabs({
  activeTab,
  onChange,
}: {
  activeTab: AdminTab;
  onChange: (tab: AdminTab) => void;
}) {
  return (
    <div
      className="panel-aluminum flex gap-1 overflow-x-auto rounded-md p-1 xl:hidden"
      role="tablist"
    >
      {(Object.keys(tabLabels) as AdminTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => onChange(tab)}
          className={`whitespace-nowrap rounded px-3 py-2 text-[10px] ${
            activeTab === tab ? "bg-primary/15 text-primary" : "text-muted-foreground"
          }`}
        >
          {tabLabels[tab]}
        </button>
      ))}
    </div>
  );
}

export function ViewHeading({ tab, refreshedAt }: { tab: AdminTab; refreshedAt: Date }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--aluminum-line)] pb-3">
      <div>
        <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-primary/80">
          Operations
        </div>
        <h1 className="mt-1 text-[20px] font-semibold tracking-tight">{tabLabels[tab]}</h1>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{tabDescriptions[tab]}</p>
      </div>
      <span className="text-[9px] text-muted-foreground">
        Refreshed{" "}
        {refreshedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </span>
    </div>
  );
}

export function CommandCenterView({
  data,
  alerts,
  onNavigate,
}: {
  data: AdminDashboard;
  alerts: OperationalAlert[];
  onNavigate: (tab: AdminTab) => void;
}) {
  const playbackErrors = eventCount(data, "playback_error");
  const playConversion = ratio(data.totals.playbackStarts, data.totals.pageViews);
  const playbackSuccess =
    data.totals.playbackStarts > 0 ? 100 - ratio(playbackErrors, data.totals.playbackStarts) : null;

  return (
    <div className="space-y-4" role="tabpanel">
      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <KpiCard
          label="Active sessions"
          value={data.uniqueSessions.toLocaleString()}
          detail="Distinct first-party sessions · 14 days"
          tone="neutral"
        />
        <KpiCard
          label="View to play"
          value={`${playConversion.toFixed(1)}%`}
          detail={`${data.totals.playbackStarts.toLocaleString()} starts from ${data.totals.pageViews.toLocaleString()} views`}
          tone={playConversion >= 10 ? "positive" : "warning"}
        />
        <KpiCard
          label="Playback success"
          value={
            playbackSuccess == null ? "No data" : `${Math.max(0, playbackSuccess).toFixed(1)}%`
          }
          detail={
            playbackSuccess == null
              ? "No playback starts recorded"
              : `${playbackErrors.toLocaleString()} reported playback errors`
          }
          tone={
            playbackSuccess == null ? "neutral" : playbackSuccess >= 95 ? "positive" : "warning"
          }
        />
        <KpiCard
          label="Support backlog"
          value={data.totals.openTickets.toLocaleString()}
          detail={`${data.system.ticketsOlderThan24Hours} older than 24 hours`}
          tone={data.system.ticketsOlderThan24Hours ? "warning" : "positive"}
        />
      </section>

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Panel title="Daily operating pulse" subtitle="Select a signal to inspect">
          <TrendChart data={data.daily} />
        </Panel>
        <Panel title="Needs attention" subtitle={`${alerts.length} active signal(s)`}>
          <AlertList alerts={alerts} onNavigate={onNavigate} />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Engagement outcomes" subtitle="Per 100 page views">
          <RatioBars
            rows={[
              { label: "Playback starts", value: playConversion, color: "bg-primary" },
              {
                label: "Direct downloads",
                value: ratio(data.totals.downloads, data.totals.pageViews),
                color: "bg-[oklch(0.7_0.15_155)]",
              },
              {
                label: "Support reports",
                value: ratio(eventCount(data, "support_submitted"), data.totals.pageViews),
                color: "bg-[oklch(0.72_0.16_55)]",
              },
            ]}
          />
        </Panel>
        <Panel title="Support workflow" subtitle="Current ticket distribution">
          <TicketStatusVisual data={data} />
        </Panel>
        <Panel title="Catalog posture" subtitle="Freshness and persisted coverage">
          <RatioBars
            rows={[
              {
                label: "Detail coverage",
                value: ratio(data.system.catalogDetails, data.system.catalogTitles),
                color: "bg-primary",
              },
              {
                label: "Fresh cached pages",
                value: 100 - ratio(data.system.staleCatalogPages, data.system.catalogPages),
                color: "bg-[oklch(0.7_0.15_155)]",
              },
            ]}
          />
        </Panel>
      </section>
    </div>
  );
}

export function AudienceView({ data }: { data: AdminDashboard }) {
  const playbackErrors = eventCount(data, "playback_error");
  const playbackErrorRate =
    data.totals.playbackStarts > 0 ? ratio(playbackErrors, data.totals.playbackStarts) : null;
  return (
    <div className="space-y-4" role="tabpanel">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DeltaCard
          label="Page views"
          current={data.totals.pageViews}
          previous={data.previousTotals.pageViews}
        />
        <DeltaCard
          label="Playback starts"
          current={data.totals.playbackStarts}
          previous={data.previousTotals.playbackStarts}
        />
        <KpiCard
          label="Playback error rate"
          value={playbackErrorRate == null ? "No data" : `${playbackErrorRate.toFixed(1)}%`}
          detail={
            playbackErrorRate == null
              ? "No playback starts recorded"
              : `${playbackErrors.toLocaleString()} errors · 14 days`
          }
          tone={
            playbackErrorRate == null ? "neutral" : playbackErrorRate < 5 ? "positive" : "warning"
          }
        />
        <DeltaCard
          label="Downloads"
          current={data.totals.downloads}
          previous={data.previousTotals.downloads}
        />
      </section>
      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Panel title="Audience and playback trend" subtitle="Last 14 days">
          <TrendChart data={data.daily} />
        </Panel>
        <Panel title="Movies vs series" subtitle="Measured product events">
          <MediaTypeComparison data={data} />
        </Panel>
      </section>
      <Panel title="Top affected paths" subtitle="Ranked by total measured activity">
        <TopPathTable data={data} />
      </Panel>
    </div>
  );
}

export function ReliabilityView({
  data,
  alerts,
  onNavigate,
}: {
  data: AdminDashboard;
  alerts: OperationalAlert[];
  onNavigate: (tab: AdminTab) => void;
}) {
  const score = reliabilityScore(data);
  return (
    <div className="space-y-4" role="tabpanel">
      <section className="grid gap-4 2xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Reliability score" subtitle="Threshold-based operating signal">
          <ScoreGauge value={score} />
        </Panel>
        <Panel title="Active reliability alerts" subtitle="Highest severity first">
          <AlertList
            alerts={alerts.filter(
              (alert) => alert.tab === "reliability" || alert.tab === "catalog",
            )}
            onNavigate={onNavigate}
          />
        </Panel>
      </section>
      <Panel title="System checks" subtitle="Configuration, recency, and dependencies">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <StatusItem label="Application" value="healthy" tone="healthy" />
          <StatusItem label="Database" value={data.system.database} tone="healthy" />
          <StatusItem
            label="Dashboard query"
            value={`${data.system.dashboardQueryMs} ms`}
            tone={data.system.dashboardQueryMs < 1_500 ? "healthy" : "warning"}
          />
          <StatusItem
            label="Last catalog sync"
            value={formatDate(data.system.lastCatalogSync)}
            tone={data.system.lastCatalogSync ? "healthy" : "warning"}
          />
          <StatusItem
            label="Sync failures (24h)"
            value={data.system.recentSyncFailures.toLocaleString()}
            tone={data.system.recentSyncFailures ? "critical" : "healthy"}
          />
          <StatusItem
            label="Active rate limits"
            value={data.system.activeRateLimitBuckets.toLocaleString()}
            tone={data.system.activeRateLimitBuckets ? "neutral" : "healthy"}
          />
          <StatusItem
            label="Product analytics"
            value={data.system.analytics}
            tone={data.system.analytics === "enabled" ? "healthy" : "neutral"}
          />
          <StatusItem
            label="Last analytics event"
            value={formatDate(data.system.lastAnalyticsEvent)}
            tone={data.system.lastAnalyticsEvent ? "healthy" : "neutral"}
          />
          <StatusItem label="Stream resolver" value={data.system.streamResolver} tone="neutral" />
          <StatusItem
            label="Schema migrations"
            value={data.system.schemaMigrations.toLocaleString()}
            tone={data.system.schemaMigrations >= 6 ? "healthy" : "warning"}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--aluminum-line)] pt-3">
          <a
            href="/healthz"
            target="_blank"
            rel="noreferrer"
            className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
          >
            Open liveness
          </a>
          <a
            href="/readyz?strict=1"
            target="_blank"
            rel="noreferrer"
            className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
          >
            Open strict readiness
          </a>
        </div>
      </Panel>
      <section className="grid gap-4 2xl:grid-cols-2">
        <Panel title="Catalog sync timeline" subtitle="Latest 12 attempts">
          <SyncTimeline data={data} />
        </Panel>
        <Panel title="Operator audit" subtitle="Recent support workflow changes">
          <AuditTable data={data} />
        </Panel>
      </section>
    </div>
  );
}

export function SupportSummary({ data }: { data: AdminDashboard }) {
  const backlog = data.system.tickets.open + data.system.tickets.inProgress;
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Unresolved"
          value={backlog.toLocaleString()}
          detail={`${data.system.tickets.inProgress} actively in progress`}
          tone={backlog ? "warning" : "positive"}
        />
        <KpiCard
          label="Older than 24h"
          value={data.system.ticketsOlderThan24Hours.toLocaleString()}
          detail="Unresolved support reports"
          tone={data.system.ticketsOlderThan24Hours ? "warning" : "positive"}
        />
        <KpiCard
          label="Older than 7d"
          value={data.system.ticketsOlderThan7Days.toLocaleString()}
          detail="Requires immediate triage"
          tone={data.system.ticketsOlderThan7Days ? "warning" : "positive"}
        />
        <KpiCard
          label="Resolved in 14d"
          value={data.system.resolvedLast14Days.toLocaleString()}
          detail="Completed support workflows"
          tone="positive"
        />
      </section>
      <section className="grid gap-4 2xl:grid-cols-[minmax(280px,0.55fr)_minmax(0,1fr)]">
        <Panel title="Workflow distribution" subtitle="All support tickets">
          <TicketStatusVisual data={data} />
        </Panel>
        <Panel title="Backlog by category" subtitle="Unresolved work first">
          <SupportCategoryBars data={data} />
        </Panel>
      </section>
    </div>
  );
}

export function CatalogView({ data }: { data: AdminDashboard }) {
  const coverage = ratio(data.system.catalogDetails, data.system.catalogTitles);
  const freshPages = 100 - ratio(data.system.staleCatalogPages, data.system.catalogPages);
  return (
    <div className="space-y-4" role="tabpanel">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Catalog titles"
          value={data.system.catalogTitles.toLocaleString()}
          detail={`Distributed across ${data.system.catalogShards} shard${data.system.catalogShards === 1 ? "" : "s"}`}
          tone="neutral"
        />
        <KpiCard
          label="Detail coverage"
          value={`${coverage.toFixed(1)}%`}
          detail={`${data.system.catalogDetails.toLocaleString()} persisted title payloads`}
          tone={coverage >= 50 ? "positive" : "warning"}
        />
        <KpiCard
          label="Fresh cached pages"
          value={`${freshPages.toFixed(1)}%`}
          detail={`${data.system.staleCatalogPages.toLocaleString()} pages older than 24 hours`}
          tone={freshPages >= 75 ? "positive" : "warning"}
        />
        <KpiCard
          label="Last catalog sync"
          value={compactDate(data.system.lastCatalogSync)}
          detail={formatDate(data.system.lastCatalogSync)}
          tone={data.system.lastCatalogSync ? "positive" : "warning"}
        />
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Coverage by media type" subtitle="Persisted detail payloads">
          <CatalogCoverageBars data={data} />
        </Panel>
        <Panel title="Shard distribution" subtitle="Titles and detail coverage">
          <ShardBars data={data} />
        </Panel>
      </section>
      <Panel title="Popular catalog inventory" subtitle="Current TMDB popularity signal">
        <PopularTitlesTable data={data} />
      </Panel>
    </div>
  );
}

function AdminTabIcon({ tab }: { tab: AdminTab }) {
  const paths: Record<AdminTab, string> = {
    command: "M4 13h4l2-7 4 12 2-5h4",
    audience: "M5 19c0-3 3-5 7-5s7 2 7 5M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    reliability: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Zm-3 9 2 2 4-5",
    support: "M4 5h16v11H8l-4 4V5Zm4 4h8m-8 3h5",
    catalog: "M5 4h14v16H5zM9 4v16m4-12h3m-3 4h3m-3 4h3",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
      <path d={paths[tab]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <article className="panel-aluminum min-w-0 rounded-md p-3">
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[var(--aluminum-line)] pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/85">
          {title}
        </h2>
        <span className="text-right text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </article>
  );
}

function KpiCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
}) {
  return (
    <article className="panel-aluminum rounded-md p-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            tone === "positive"
              ? "bg-[oklch(0.72_0.18_145)]"
              : tone === "warning"
                ? "bg-[oklch(0.72_0.16_55)]"
                : "bg-primary"
          }`}
        />
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-2 text-[25px] font-light tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{detail}</div>
    </article>
  );
}

function DeltaCard({
  label,
  current,
  previous,
}: {
  label: string;
  current: number;
  previous: number;
}) {
  const delta = trendDelta(current, previous);
  return (
    <KpiCard
      label={label}
      value={current.toLocaleString()}
      detail={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs previous 14 days`}
      tone={delta >= 0 ? "positive" : "warning"}
    />
  );
}

const trendMetrics = [
  {
    key: "pageViews",
    label: "Page views",
    color: "oklch(0.72 0.16 235)",
    area: "oklch(0.72 0.16 235 / 0.12)",
  },
  {
    key: "playbackStarts",
    label: "Playback starts",
    color: "oklch(0.73 0.17 150)",
    area: "oklch(0.73 0.17 150 / 0.12)",
  },
  {
    key: "playbackErrors",
    label: "Playback errors",
    color: "oklch(0.7 0.18 40)",
    area: "oklch(0.7 0.18 40 / 0.12)",
  },
  {
    key: "downloads",
    label: "Downloads",
    color: "oklch(0.72 0.14 295)",
    area: "oklch(0.72 0.14 295 / 0.12)",
  },
  {
    key: "supportSubmitted",
    label: "Support reports",
    color: "oklch(0.75 0.14 75)",
    area: "oklch(0.75 0.14 75 / 0.12)",
  },
] as const;

function TrendChart({ data }: { data: AdminDashboard["daily"] }) {
  const [metric, setMetric] = useState<(typeof trendMetrics)[number]["key"]>("pageViews");
  const config = trendMetrics.find((item) => item.key === metric) ?? trendMetrics[0];
  const values = data.map((item) => item[metric]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, ...values);
  const average = total / Math.max(1, values.length);
  const points = data.map((item, index) => ({
    x: 24 + (index / Math.max(1, data.length - 1)) * 632,
    y: 200 - (item[metric] / max) * 165,
    value: item[metric],
    date: item.date,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `24,200 ${line} 656,200`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Trend signal">
        {trendMetrics.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={metric === item.key}
            onClick={() => setMetric(item.key)}
            className={`rounded-full border px-2.5 py-1 text-[9px] ${
              metric === item.key
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-[var(--aluminum-line)] text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {total === 0 ? (
        <div className="grid min-h-56 place-items-center rounded-md border border-dashed border-[var(--aluminum-line)] bg-black/10 text-center">
          <div>
            <div className="text-[12px] font-medium">
              No {config.label.toLocaleLowerCase()} recorded
            </div>
            <p className="mt-1 text-[9px] text-muted-foreground">
              This signal has no events in the latest 14-day window.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <svg
            viewBox="0 0 680 230"
            className="h-56 w-full overflow-visible"
            aria-label={`${config.label} over the last 14 days`}
            role="img"
          >
            {[35, 76, 118, 159, 200].map((y, index) => (
              <g key={y}>
                <line x1="24" y1={y} x2="656" y2={y} stroke="oklch(0.6 0.01 250 / 0.14)" />
                <text x="0" y={y + 3} fill="oklch(0.62 0.01 250)" fontSize="8">
                  {Math.round(max * (1 - index / 4))}
                </text>
              </g>
            ))}
            <polygon points={area} fill={config.area} />
            <polyline
              points={line}
              fill="none"
              stroke={config.color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {points.map((point) => (
              <circle
                key={point.date}
                cx={point.x}
                cy={point.y}
                r="3"
                fill={config.color}
                stroke="oklch(0.13 0.006 250)"
                strokeWidth="2"
              >
                <title>
                  {point.date}: {point.value}
                </title>
              </circle>
            ))}
            {points
              .filter((_, index) => index % 2 === 0)
              .map((point) => (
                <text
                  key={`date-${point.date}`}
                  x={point.x}
                  y="222"
                  textAnchor="middle"
                  fill="oklch(0.62 0.01 250)"
                  fontSize="8"
                >
                  {shortDate(point.date)}
                </text>
              ))}
          </svg>
          <dl className="grid grid-cols-3 gap-2 sm:w-28 sm:grid-cols-1">
            <ChartStat label="Latest" value={(values.at(-1) ?? 0).toLocaleString()} />
            <ChartStat label="Daily average" value={average.toFixed(1)} />
            <ChartStat label="Peak" value={max.toLocaleString()} />
          </dl>
        </div>
      )}
    </div>
  );
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--aluminum-line)] bg-black/15 px-2 py-2">
      <dt className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[13px] font-medium">{value}</dd>
    </div>
  );
}

function AlertList({
  alerts,
  onNavigate,
}: {
  alerts: OperationalAlert[];
  onNavigate: (tab: AdminTab) => void;
}) {
  if (!alerts.length) {
    return <p className="py-8 text-center text-[10px] text-muted-foreground">No active alerts.</p>;
  }
  const sorted = [...alerts].sort(
    (left, right) =>
      ({ critical: 0, warning: 1, info: 2 })[left.severity] -
      { critical: 0, warning: 1, info: 2 }[right.severity],
  );
  return (
    <div className="space-y-2">
      {sorted.map((alert) => (
        <button
          key={alert.id}
          type="button"
          onClick={() => onNavigate(alert.tab)}
          className="flex w-full gap-3 rounded-md border border-[var(--aluminum-line)] bg-black/15 p-3 text-left hover:bg-white/5"
        >
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
              alert.severity === "critical"
                ? "bg-destructive"
                : alert.severity === "warning"
                  ? "bg-[oklch(0.72_0.16_55)]"
                  : "bg-primary"
            }`}
          />
          <span>
            <span className="block text-[10px] font-medium text-foreground/90">{alert.title}</span>
            <span className="mt-0.5 block text-[9px] leading-relaxed text-muted-foreground">
              {alert.detail}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RatioBars({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  return (
    <div className="space-y-4 py-1">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[9px]">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium">{row.value.toFixed(1)}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/35">
            <div
              className={`h-full rounded-full ${row.color}`}
              style={{ width: `${Math.min(100, Math.max(row.value > 0 ? 2 : 0, row.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TicketStatusVisual({ data }: { data: AdminDashboard }) {
  const { open, inProgress, resolved } = data.system.tickets;
  const total = open + inProgress + resolved;
  const resolvedAngle = ratio(resolved, total) * 3.6;
  const progressAngle = resolvedAngle + ratio(inProgress, total) * 3.6;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[130px_1fr]">
      <div
        className="relative mx-auto grid h-28 w-28 place-items-center rounded-full"
        style={{
          background: total
            ? `conic-gradient(oklch(0.68 0.17 150) 0deg ${resolvedAngle}deg, oklch(0.72 0.15 235) ${resolvedAngle}deg ${progressAngle}deg, oklch(0.72 0.16 55) ${progressAngle}deg 360deg)`
            : "oklch(0.28 0.008 250)",
        }}
      >
        <div className="grid h-20 w-20 place-items-center rounded-full bg-[oklch(0.15_0.006_250)] text-center">
          <span>
            <strong className="block text-[20px] font-light">{open + inProgress}</strong>
            <span className="text-[8px] text-muted-foreground">unresolved</span>
          </span>
        </div>
      </div>
      <dl className="space-y-2 text-[9px]">
        <LegendStat color="bg-[oklch(0.72_0.16_55)]" label="Open" value={open} />
        <LegendStat color="bg-primary" label="In progress" value={inProgress} />
        <LegendStat color="bg-[oklch(0.68_0.17_150)]" label="Resolved" value={resolved} />
      </dl>
    </div>
  );
}

function LegendStat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <dt className="flex-1 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value.toLocaleString()}</dd>
    </div>
  );
}

function MediaTypeComparison({ data }: { data: AdminDashboard }) {
  if (!data.mediaTypes.length) {
    return <EmptyState>Media-specific activity has not been recorded yet.</EmptyState>;
  }
  return (
    <div className="space-y-3">
      {data.mediaTypes.map((item) => (
        <div key={item.mediaType} className="rounded-md border border-[var(--aluminum-line)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium capitalize">
              {item.mediaType === "tv" ? "TV series" : "Movies"}
            </span>
            <span className="text-[9px] text-muted-foreground">
              {ratio(item.playbackStarts, item.pageViews).toFixed(1)}% view to play
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <CompactStat label="Views" value={item.pageViews} />
            <CompactStat label="Plays" value={item.playbackStarts} />
            <CompactStat label="Errors" value={item.playbackErrors} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-black/20 px-2 py-2">
      <div className="text-[12px] font-medium">{value.toLocaleString()}</div>
      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function TopPathTable({ data }: { data: AdminDashboard }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[10px]">
        <thead className="border-b border-[var(--aluminum-line)] text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">Path</th>
            <th className="px-2 py-2 text-right font-medium">Views</th>
            <th className="px-2 py-2 text-right font-medium">Plays</th>
            <th className="px-2 py-2 text-right font-medium">Errors</th>
            <th className="px-2 py-2 text-right font-medium">Error rate</th>
            <th className="px-2 py-2 text-right font-medium">Downloads</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--aluminum-line)]/50">
          {data.topPaths.map((item) => (
            <tr key={item.path} className="hover:bg-white/3">
              <td className="max-w-[380px] truncate px-2 py-2 font-medium">{item.path}</td>
              <td className="px-2 py-2 text-right">{item.pageViews}</td>
              <td className="px-2 py-2 text-right">{item.playbackStarts}</td>
              <td className="px-2 py-2 text-right">{item.playbackErrors}</td>
              <td
                className={`px-2 py-2 text-right ${
                  ratio(item.playbackErrors, item.playbackStarts) >= 10 ? "text-destructive" : ""
                }`}
              >
                {item.playbackStarts
                  ? `${ratio(item.playbackErrors, item.playbackStarts).toFixed(1)}%`
                  : "—"}
              </td>
              <td className="px-2 py-2 text-right">{item.downloads}</td>
            </tr>
          ))}
          {!data.topPaths.length ? (
            <tr>
              <td colSpan={6}>
                <EmptyState>No path-level analytics are available yet.</EmptyState>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ScoreGauge({ value }: { value: number }) {
  const tone =
    value >= 90
      ? "oklch(0.7 0.17 150)"
      : value >= 70
        ? "oklch(0.74 0.16 55)"
        : "oklch(0.65 0.2 30)";
  return (
    <div className="py-2 text-center">
      <div
        className="relative mx-auto grid h-40 w-40 place-items-center rounded-full"
        style={{
          background: `conic-gradient(${tone} 0deg ${value * 3.6}deg, oklch(0.25 0.008 250) ${value * 3.6}deg 360deg)`,
        }}
      >
        <div className="grid h-28 w-28 place-items-center rounded-full bg-[oklch(0.15_0.006_250)]">
          <span>
            <strong className="block text-[36px] font-light">{value}</strong>
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">of 100</span>
          </span>
        </div>
      </div>
      <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
        Score decreases when critical production thresholds are breached.
      </p>
    </div>
  );
}

function StatusItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "healthy" | "neutral" | "warning" | "critical";
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--aluminum-line)] bg-black/15 px-3 py-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          tone === "healthy"
            ? "bg-[oklch(0.72_0.18_145)]"
            : tone === "critical"
              ? "bg-destructive"
              : tone === "warning"
                ? "bg-[oklch(0.72_0.16_55)]"
                : "bg-primary"
        }`}
      />
      <div className="min-w-0">
        <div className="text-[8px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="line-clamp-1 text-[10px] font-medium capitalize">{value}</div>
      </div>
    </div>
  );
}

function SyncTimeline({ data }: { data: AdminDashboard }) {
  if (!data.recentSyncEvents.length)
    return <EmptyState>No catalog sync events recorded.</EmptyState>;
  return (
    <ol className="max-h-80 space-y-1 overflow-auto pr-1">
      {data.recentSyncEvents.map((event, index) => (
        <li
          key={`${event.syncedAt}-${index}`}
          className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-2 hover:bg-white/3"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              event.failed ? "bg-destructive" : "bg-[oklch(0.7_0.17_150)]"
            }`}
          />
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-medium">{event.source}</span>
            <span className="text-[8px] text-muted-foreground">
              {event.mediaType ?? "all"} page {event.page ?? "-"} · {event.itemCount} items
            </span>
          </span>
          <time className="text-[8px] text-muted-foreground" dateTime={event.syncedAt}>
            {formatDate(event.syncedAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function AuditTable({ data }: { data: AdminDashboard }) {
  if (!data.auditEvents.length) return <EmptyState>No operator changes recorded yet.</EmptyState>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-left text-[9px]">
        <thead className="sticky top-0 bg-[oklch(0.16_0.005_250)] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Action</th>
            <th className="px-2 py-1.5 font-medium">Target</th>
            <th className="px-2 py-1.5 text-right font-medium">Affected</th>
            <th className="px-2 py-1.5 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--aluminum-line)]/50">
          {data.auditEvents.map((event) => (
            <tr key={event.id}>
              <td className="px-2 py-2 capitalize">
                {event.action.replaceAll("_", " ")}
                {event.status ? ` → ${event.status.replace("_", " ")}` : ""}
              </td>
              <td className="px-2 py-2 text-muted-foreground">
                {event.targetId ?? "Ticket batch"}
              </td>
              <td className="px-2 py-2 text-right">{event.affectedCount}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                {formatDate(event.occurredAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupportCategoryBars({ data }: { data: AdminDashboard }) {
  const max = Math.max(1, ...data.supportCategories.map((item) => item.open + item.inProgress));
  if (!data.supportCategories.length)
    return <EmptyState>No support categories recorded yet.</EmptyState>;
  return (
    <div className="space-y-3">
      {data.supportCategories.map((item) => {
        const unresolved = item.open + item.inProgress;
        return (
          <div key={item.category}>
            <div className="mb-1 flex items-center justify-between text-[9px]">
              <span className="capitalize text-muted-foreground">{item.category}</span>
              <span>{unresolved} unresolved</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-black/35">
              <div
                className="bg-[oklch(0.72_0.16_55)]"
                style={{ width: `${(item.open / max) * 100}%` }}
              />
              <div className="bg-primary" style={{ width: `${(item.inProgress / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CatalogCoverageBars({ data }: { data: AdminDashboard }) {
  return (
    <div className="space-y-4">
      {data.catalogBreakdown.map((item) => (
        <div key={item.mediaType}>
          <div className="mb-1 flex items-center justify-between text-[9px]">
            <span className="font-medium capitalize">
              {item.mediaType === "tv" ? "TV series" : "Movies"}
            </span>
            <span className="text-muted-foreground">
              {item.details.toLocaleString()} / {item.titles.toLocaleString()} details
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-black/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[oklch(0.48_0.16_245)] to-[oklch(0.74_0.16_235)]"
              style={{ width: `${ratio(item.details, item.titles)}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[8px] text-muted-foreground">
            {ratio(item.details, item.titles).toFixed(1)}% covered
          </div>
        </div>
      ))}
    </div>
  );
}

function ShardBars({ data }: { data: AdminDashboard }) {
  const max = Math.max(1, ...data.shardStats.map((item) => item.titles));
  return (
    <div className="space-y-3">
      {data.shardStats.map((item) => (
        <div key={item.shard}>
          <div className="mb-1 flex items-center justify-between text-[9px]">
            <span>Shard {item.shard}</span>
            <span className="text-muted-foreground">
              {item.titles.toLocaleString()} titles · {ratio(item.details, item.titles).toFixed(0)}%
              detailed
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/35">
            <div
              className="h-full rounded-full bg-[oklch(0.68_0.16_235)]"
              style={{ width: `${(item.titles / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PopularTitlesTable({ data }: { data: AdminDashboard }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[10px]">
        <thead className="border-b border-[var(--aluminum-line)] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">Rank</th>
            <th className="px-2 py-1.5 font-medium">Title</th>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 text-right font-medium">TMDB popularity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--aluminum-line)]/50">
          {data.popularTitles.map((title) => (
            <tr key={`${title.mediaType}:${title.title}`} className="hover:bg-white/3">
              <td className="px-2 py-2 font-medium text-primary">#{title.rank}</td>
              <td className="px-2 py-2 font-medium">{title.title}</td>
              <td className="px-2 py-2 capitalize text-muted-foreground">
                {title.mediaType === "tv" ? "TV series" : "Movie"}
              </td>
              <td className="px-2 py-2 text-right">
                {Math.round(title.popularity).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[10px] text-muted-foreground">{children}</p>;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

function compactDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Never";
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
