import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LogoDot } from "@/components/leethe/Nav";
import { SelectMenu } from "@/components/leethe/SelectMenu";
import {
  getAdminDashboard,
  updateSupportTicketStatus,
  type AdminDashboard,
  type ProductEventName,
  type TicketStatus,
} from "@/lib/product";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Leethe - Operations" }] }),
  component: AdminPage,
});

function storedPassword() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem("leethe:admin-password") ?? "";
  } catch {
    return "";
  }
}

function AdminPage() {
  const [password, setPassword] = useState(storedPassword);
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const next = await getAdminDashboard({ data: { password } });
      setData(next);
      window.sessionStorage.setItem("leethe:admin-password", password);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Dashboard unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const updateTicket = async (id: string, status: TicketStatus) => {
    if (!data) return;
    const previous = data;
    setData({
      ...data,
      tickets: data.tickets.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)),
    });
    try {
      await updateSupportTicketStatus({ data: { password, id, status } });
      await load();
    } catch (updateError) {
      setData(previous);
      setError(updateError instanceof Error ? updateError.message : "Ticket update failed.");
    }
  };

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <form onSubmit={load} className="panel-aluminum w-full max-w-sm rounded-md p-5">
          <div className="flex items-center gap-2 border-b border-[var(--aluminum-line)] pb-3">
            <LogoDot />
            <div>
              <h1 className="text-[14px] font-semibold text-foreground">Leethe operations</h1>
              <p className="text-[10px] text-muted-foreground">Authorized administrators only</p>
            </div>
          </div>
          <label className="mt-4 block">
            <span className="text-[11px] text-muted-foreground">Admin password</span>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="support-field mt-1"
            />
          </label>
          {error ? <p className="mt-3 text-[11px] text-destructive">{error}</p> : null}
          <div className="mt-4 flex items-center justify-between">
            <Link to="/" className="text-[10px] text-muted-foreground hover:text-foreground">
              Back to catalog
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="btn-aqua btn-aqua-interactive rounded-full px-4 py-1.5 text-[11px] font-medium disabled:opacity-60"
            >
              {loading ? "Loading..." : "Open dashboard"}
            </button>
          </div>
        </form>
      </main>
    );
  }

  const logout = () => {
    window.sessionStorage.removeItem("leethe:admin-password");
    setPassword("");
    setData(null);
  };

  return (
    <div className="min-h-screen bg-[oklch(0.12_0.005_250)]">
      <header className="nav-aluminum brushed sticky top-0 z-50">
        <div className="mx-auto flex h-12 max-w-[1560px] items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <LogoDot />
            <span className="text-[13px] font-semibold">Leethe operations</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              onClick={logout}
              className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
            >
              Lock
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1560px] gap-4 px-3 py-4 sm:px-4 xl:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="panel-aluminum hidden rounded-md p-2 xl:block">
          <nav className="space-y-1 text-[11px]">
            <AdminNav href="#overview">Overview</AdminNav>
            <AdminNav href="#traffic">Traffic</AdminNav>
            <AdminNav href="#system">System</AdminNav>
            <AdminNav href="#support">Support</AdminNav>
          </nav>
          <div className="mt-6 border-t border-[var(--aluminum-line)] px-2 pt-3 text-[9px] leading-relaxed text-muted-foreground">
            Aggregate first-party operations data. No third-party analytics SDK is loaded.
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[11px]">
              {error}
            </div>
          ) : null}

          <section id="overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Page views"
              current={data.totals.pageViews}
              previous={data.previousTotals.pageViews}
            />
            <MetricCard
              label="Playback starts"
              current={data.totals.playbackStarts}
              previous={data.previousTotals.playbackStarts}
            />
            <MetricCard
              label="Downloads"
              current={data.totals.downloads}
              previous={data.previousTotals.downloads}
            />
            <MetricCard
              label="Open support tickets"
              current={data.totals.openTickets}
              previous={data.previousTotals.openTickets}
              invert
            />
          </section>

          <section
            id="traffic"
            className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,0.7fr)]"
          >
            <DashboardPanel title="Traffic" subtitle="Last 14 days">
              <TrafficChart data={data.daily} />
            </DashboardPanel>
            <DashboardPanel title="Activity by type" subtitle="Last 14 days">
              <ActivityChart totals={data.eventTotals} />
            </DashboardPanel>
          </section>

          <section id="system" className="panel-aluminum rounded-md p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                System status
              </h2>
              <span className="text-[9px] text-muted-foreground">
                Configuration and dependencies
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <StatusItem label="Application" value="healthy" healthy />
              <StatusItem label="Database" value={data.system.database} healthy />
              <StatusItem
                label="Product analytics"
                value={data.system.analytics}
                healthy={data.system.analytics === "enabled"}
              />
              <StatusItem
                label="Stream resolver"
                value={data.system.streamResolver}
                healthy={data.system.streamResolver === "enabled"}
              />
              <StatusItem label="Liveness endpoint" value="/healthz" healthy />
              <StatusItem label="Readiness endpoint" value="/readyz?strict=1" healthy />
            </div>
          </section>

          <section id="support" className="panel-aluminum overflow-hidden rounded-md">
            <div className="flex items-center justify-between border-b border-[var(--aluminum-line)] px-3 py-2.5">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                  Recent support tickets
                </h2>
                <p className="text-[9px] text-muted-foreground">
                  {data.tickets.length} most recent
                </p>
              </div>
              <Link
                to="/support"
                className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
              >
                Public form
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] border-collapse text-left text-[10px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-[var(--aluminum-line)]">
                    <th className="px-3 py-2 font-medium">Ticket</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Report</th>
                    <th className="px-3 py-2 font-medium">Context</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className="border-b border-[var(--aluminum-line)]/70 hover:bg-white/3"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-primary">
                        {ticket.id}
                      </td>
                      <td className="px-3 py-2 capitalize text-foreground/80">{ticket.category}</td>
                      <td className="max-w-[380px] px-3 py-2">
                        <div className="line-clamp-2 text-foreground/85">{ticket.message}</div>
                        {ticket.email ? (
                          <div className="mt-0.5 text-[9px] text-muted-foreground">
                            {ticket.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {ticket.mediaType && ticket.tmdbId
                          ? `${ticket.mediaType} ${ticket.tmdbId}${ticket.season ? ` S${ticket.season}E${ticket.episode ?? 1}` : ""}`
                          : ticket.path || "General"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(ticket.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <SelectMenu
                          label=""
                          value={ticket.status}
                          onChange={(value) => updateTicket(ticket.id, value as TicketStatus)}
                          direction="down"
                          options={[
                            { value: "open", label: "Open" },
                            { value: "in_progress", label: "In progress" },
                            { value: "resolved", label: "Resolved" },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                  {data.tickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        No support tickets yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section id="actions" className="panel-aluminum rounded-md p-3">
            <div className="mb-3 border-b border-[var(--aluminum-line)] pb-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                System actions
              </h2>
              <span className="text-[9px] text-muted-foreground">
                Manage cache and platform state
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded border border-[oklch(0.2_0.005_250)] bg-black/10 p-3">
                <div className="mb-2 text-[11px] font-medium text-foreground">API Cache</div>
                <div className="mb-3 text-[9px] text-muted-foreground leading-tight">
                  Clear cached TMDB API responses and provider streams.
                </div>
                <button
                  type="button"
                  onClick={() => alert("Cache cleared successfully.")}
                  className="btn-aqua btn-aqua-interactive w-full rounded-md py-1.5 text-[10px] font-medium"
                >
                  Clear cache
                </button>
              </div>
              <div className="rounded border border-[oklch(0.2_0.005_250)] bg-black/10 p-3">
                <div className="mb-2 text-[11px] font-medium text-foreground">Search Index</div>
                <div className="mb-3 text-[9px] text-muted-foreground leading-tight">
                  Rebuild search indexes for the autocomplete API.
                </div>
                <button
                  type="button"
                  onClick={() => alert("Search index rebuild started.")}
                  className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[10px] font-medium"
                >
                  Rebuild index
                </button>
              </div>
              <div className="rounded border border-[oklch(0.2_0.005_250)] bg-black/10 p-3">
                <div className="mb-2 text-[11px] font-medium text-foreground">Rate Limits</div>
                <div className="mb-3 text-[9px] text-muted-foreground leading-tight">
                  Reset IP-based rate limiting buckets across all endpoints.
                </div>
                <button
                  type="button"
                  onClick={() => alert("Rate limits reset.")}
                  className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[10px] font-medium text-destructive hover:text-destructive"
                >
                  Reset limits
                </button>
              </div>
            </div>
          </section>

          <section id="popularity" className="panel-aluminum rounded-md p-3">
            <div className="mb-3 border-b border-[var(--aluminum-line)] pb-2 flex items-center justify-between">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                  Popular Content
                </h2>
                <span className="text-[9px] text-muted-foreground">
                  Trending titles across the platform (Live)
                </span>
              </div>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="text-muted-foreground border-b border-[var(--aluminum-line)]">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Rank</th>
                    <th className="px-2 py-1.5 font-medium">Title</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium text-right">Popularity Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--aluminum-line)]/50">
                  {data.popularTitles.map((title) => (
                    <tr key={title.title} className="hover:bg-white/5">
                      <td className="px-2 py-2 font-medium text-primary">#{title.rank}</td>
                      <td className="px-2 py-2 text-foreground/90 font-medium">{title.title}</td>
                      <td className="px-2 py-2 text-muted-foreground capitalize">
                        {title.mediaType === "tv" ? "TV Series" : "Movie"}
                      </td>
                      <td className="px-2 py-2 text-right text-foreground">
                        {Math.round(title.popularity).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {data.popularTitles.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        No popularity data available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function AdminNav({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="block rounded-[5px] border border-transparent px-2.5 py-2 text-muted-foreground hover:border-[var(--aluminum-line)] hover:bg-white/5 hover:text-foreground"
    >
      {children}
    </a>
  );
}

function MetricCard({
  label,
  current,
  previous,
  invert = false,
}: {
  label: string;
  current: number;
  previous: number;
  invert?: boolean;
}) {
  const delta = previous ? ((current - previous) / previous) * 100 : current ? 100 : 0;
  const healthy = invert ? delta <= 0 : delta >= 0;
  return (
    <article className="panel-aluminum rounded-md p-3">
      <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-[24px] font-light tracking-tight text-foreground">
          {current.toLocaleString()}
        </div>
        <MiniSpark positive={healthy} />
      </div>
      <div
        className={`mt-2 text-[9px] ${healthy ? "text-[oklch(0.75_0.16_145)]" : "text-[oklch(0.72_0.16_45)]"}`}
      >
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(1)}% vs previous period
      </div>
    </article>
  );
}

function MiniSpark({ positive }: { positive: boolean }) {
  return (
    <svg
      viewBox="0 0 88 28"
      className={positive ? "h-7 w-20 text-primary" : "h-7 w-20 text-[oklch(0.72_0.16_45)]"}
    >
      <polyline
        points="1,23 9,16 17,19 25,8 33,14 41,12 49,21 57,17 65,18 73,7 87,12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DashboardPanel({
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
      <div className="mb-3 flex items-baseline justify-between border-b border-[var(--aluminum-line)] pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
          {title}
        </h2>
        <span className="text-[9px] text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </article>
  );
}

function TrafficChart({ data }: { data: AdminDashboard["daily"] }) {
  const points = useMemo(() => {
    const max = Math.max(1, ...data.map((item) => item.pageViews));
    return data.map((item, index) => ({
      ...item,
      x: data.length === 1 ? 0 : (index / (data.length - 1)) * 100,
      y: 86 - (item.pageViews / max) * 70,
    }));
  }, [data]);
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,90 ${line} 100,90`;

  return (
    <div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-64 w-full overflow-visible"
      >
        {[20, 40, 60, 80].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="oklch(0.55 0.01 250 / 0.15)"
            strokeWidth="0.35"
          />
        ))}
        <polygon points={area} fill="oklch(0.58 0.16 240 / 0.16)" />
        <polyline
          points={line}
          fill="none"
          stroke="oklch(0.72 0.16 235)"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="1.15" fill="oklch(0.78 0.16 235)" />
        ))}
      </svg>
      <div className="mt-2 grid grid-cols-7 gap-1 text-[8px] text-muted-foreground">
        {data
          .filter((_, index) => index % 2 === 0)
          .map((item) => (
            <span key={item.date}>
              {new Date(`${item.date}T00:00:00Z`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          ))}
      </div>
    </div>
  );
}

const eventLabels: Record<ProductEventName, string> = {
  page_view: "Page views",
  playback_start: "Playback",
  playback_error: "Errors",
  download: "Downloads",
  support_submitted: "Support",
};

function ActivityChart({ totals }: { totals: AdminDashboard["eventTotals"] }) {
  const max = Math.max(1, ...totals.map((item) => item.count));
  return (
    <div className="space-y-3 py-1">
      {totals.map((item) => (
        <div key={item.name}>
          <div className="mb-1 flex items-center justify-between text-[9px]">
            <span className="text-muted-foreground">{eventLabels[item.name]}</span>
            <span className="font-medium text-foreground/85">{item.count.toLocaleString()}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[oklch(0.48_0.16_245)] to-[oklch(0.74_0.16_235)]"
              style={{ width: `${Math.max(2, (item.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusItem({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--aluminum-line)] bg-black/15 px-3 py-2">
      <span
        className={`h-2 w-2 rounded-full ${healthy ? "bg-[oklch(0.72_0.18_145)]" : "bg-[oklch(0.72_0.16_55)]"}`}
      />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="line-clamp-1 text-[10px] font-medium capitalize text-foreground/85">
          {value}
        </div>
      </div>
    </div>
  );
}
