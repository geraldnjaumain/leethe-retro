import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import {
  AdminTabNav,
  AudienceView,
  CatalogView,
  CommandCenterView,
  MobileAdminTabs,
  ReliabilityView,
  SupportSummary,
  ViewHeading,
} from "@/components/leethe/AdminDashboardViews";
import { SelectMenu } from "@/components/leethe/SelectMenu";
import { BrandMark } from "@/components/leethe/VisualAssets";
import { buildOperationalAlerts, type AdminTab } from "@/lib/admin-insights";
import {
  getAdminDashboard,
  updateSupportTicketStatus,
  updateSupportTicketsStatus,
  type AdminDashboard,
  type SupportCategory,
  type TicketStatus,
} from "@/lib/product";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Leethe - Operations" }] }),
  component: AdminPage,
});

function AdminPage() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("command");
  const [refreshedAt, setRefreshedAt] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState<"all" | TicketStatus>("all");
  const [ticketCategory, setTicketCategory] = useState<"all" | SupportCategory>("all");
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [ticketOffset, setTicketOffset] = useState(0);

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    const query = ticketSearch.trim().toLocaleLowerCase();
    return data.tickets.filter((ticket) => {
      if (ticketStatus !== "all" && ticket.status !== ticketStatus) return false;
      if (ticketCategory !== "all" && ticket.category !== ticketCategory) return false;
      if (!query) return true;
      return [
        ticket.id,
        ticket.message,
        ticket.email ?? "",
        ticket.path ?? "",
        ticket.mediaType ?? "",
        ticket.tmdbId ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [data, ticketCategory, ticketSearch, ticketStatus]);
  const allFilteredTicketsSelected =
    filteredTickets.length > 0 &&
    filteredTickets.every((ticket) => selectedTicketIds.has(ticket.id));
  const alerts = useMemo(() => (data ? buildOperationalAlerts(data) : []), [data]);

  const load = async (event?: FormEvent, nextTicketOffset = ticketOffset) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const next = await getAdminDashboard({ data: { password, ticketOffset: nextTicketOffset } });
      setData(next);
      setSelectedTicketIds(new Set());
      setTicketOffset(nextTicketOffset);
      setRefreshedAt(new Date());
    } catch (loadError) {
      if (!data) setData(null);
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

  const toggleTicket = (id: string) => {
    setSelectedTicketIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFilteredTickets = () => {
    const ids = filteredTickets.map((ticket) => ticket.id);
    setSelectedTicketIds((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const bulkUpdateTickets = async (status: TicketStatus) => {
    const ids = Array.from(selectedTicketIds);
    if (!data || !ids.length) return;
    setBulkUpdating(true);
    setError("");
    setNotice("");
    try {
      const result = await updateSupportTicketsStatus({ data: { password, ids, status } });
      setNotice(
        `${result.updated} ticket${result.updated === 1 ? "" : "s"} marked ${status.replace("_", " ")}.`,
      );
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Bulk ticket update failed.");
    } finally {
      setBulkUpdating(false);
    }
  };

  if (!data) {
    return (
      <AdminLogin
        password={password}
        loading={loading}
        error={error}
        onChange={setPassword}
        onSubmit={load}
      />
    );
  }

  const logout = () => {
    setPassword("");
    setData(null);
    setTicketOffset(0);
    setActiveTab("command");
  };

  const exportTickets = () => {
    const rows = [
      ["Ticket", "Category", "Status", "Email", "Report", "Path", "Media", "Updated"],
      ...filteredTickets.map((ticket) => [
        ticket.id,
        ticket.category,
        ticket.status,
        ticket.email ?? "",
        ticket.message,
        ticket.path ?? "",
        ticket.mediaType && ticket.tmdbId
          ? `${ticket.mediaType}:${ticket.tmdbId}:${ticket.season ?? ""}:${ticket.episode ?? ""}`
          : "",
        ticket.updatedAt,
      ]),
    ];
    downloadCsv("leethe-support-tickets.csv", rows);
  };

  return (
    <div className="min-h-screen bg-[oklch(0.12_0.005_250)]">
      <header className="nav-aluminum brushed sticky top-0 z-50">
        <div className="mx-auto flex h-12 max-w-[1680px] items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="text-[13px] font-semibold">Leethe operations</span>
            <span className="hidden rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[8px] uppercase tracking-wide text-primary sm:inline">
              Production
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px] disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh data"}
            </button>
            <button
              type="button"
              onClick={logout}
              className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
            >
              Lock
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-3 py-4 sm:px-4 xl:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="panel-aluminum sticky top-16 hidden h-[calc(100vh-5rem)] rounded-md p-2 xl:flex xl:flex-col">
          <AdminTabNav activeTab={activeTab} alerts={alerts} onChange={setActiveTab} />
          <div className="mt-auto border-t border-[var(--aluminum-line)] px-2 pt-3">
            <div className="flex items-center justify-between text-[8px] text-muted-foreground">
              <span>Catalog</span>
              <span>{data.system.catalogTitles.toLocaleString()} titles</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[8px] text-muted-foreground">
              <span>Open support</span>
              <span>{data.totals.openTickets.toLocaleString()}</span>
            </div>
            <p className="mt-3 text-[8px] leading-relaxed text-muted-foreground">
              First-party operational signals. Alerts are threshold-based and require operator
              judgment.
            </p>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <MobileAdminTabs activeTab={activeTab} onChange={setActiveTab} />
          <ViewHeading tab={activeTab} refreshedAt={refreshedAt} />
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[11px]"
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div
              role="status"
              className="rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-[11px]"
            >
              {notice}
            </div>
          ) : null}

          {activeTab === "command" ? (
            <CommandCenterView data={data} alerts={alerts} onNavigate={setActiveTab} />
          ) : null}
          {activeTab === "audience" ? <AudienceView data={data} /> : null}
          {activeTab === "reliability" ? (
            <ReliabilityView data={data} alerts={alerts} onNavigate={setActiveTab} />
          ) : null}
          {activeTab === "support" ? (
            <div className="space-y-4" role="tabpanel">
              <SupportSummary data={data} />
              <SupportTickets
                data={data}
                filteredTickets={filteredTickets}
                selectedTicketIds={selectedTicketIds}
                allFilteredTicketsSelected={allFilteredTicketsSelected}
                bulkUpdating={bulkUpdating}
                loading={loading}
                ticketSearch={ticketSearch}
                ticketStatus={ticketStatus}
                ticketCategory={ticketCategory}
                ticketOffset={ticketOffset}
                onSearchChange={setTicketSearch}
                onStatusChange={setTicketStatus}
                onCategoryChange={setTicketCategory}
                onToggleTicket={toggleTicket}
                onToggleFilteredTickets={toggleFilteredTickets}
                onClearSelection={() => setSelectedTicketIds(new Set())}
                onBulkUpdate={bulkUpdateTickets}
                onUpdateTicket={updateTicket}
                onExport={exportTickets}
                onPageChange={(offset) => load(undefined, offset)}
              />
            </div>
          ) : null}
          {activeTab === "catalog" ? <CatalogView data={data} /> : null}
        </main>
      </div>
    </div>
  );
}

function AdminLogin({
  password,
  loading,
  error,
  onChange,
  onSubmit,
}: {
  password: string;
  loading: boolean;
  error: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="panel-aluminum w-full max-w-sm rounded-md p-5">
        <div className="flex items-center gap-2 border-b border-[var(--aluminum-line)] pb-3">
          <BrandMark />
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChange(event.target.value)}
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

type Ticket = AdminDashboard["tickets"][number];

function SupportTickets({
  data,
  filteredTickets,
  selectedTicketIds,
  allFilteredTicketsSelected,
  bulkUpdating,
  loading,
  ticketSearch,
  ticketStatus,
  ticketCategory,
  ticketOffset,
  onSearchChange,
  onStatusChange,
  onCategoryChange,
  onToggleTicket,
  onToggleFilteredTickets,
  onClearSelection,
  onBulkUpdate,
  onUpdateTicket,
  onExport,
  onPageChange,
}: {
  data: AdminDashboard;
  filteredTickets: Ticket[];
  selectedTicketIds: Set<string>;
  allFilteredTicketsSelected: boolean;
  bulkUpdating: boolean;
  loading: boolean;
  ticketSearch: string;
  ticketStatus: "all" | TicketStatus;
  ticketCategory: "all" | SupportCategory;
  ticketOffset: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: "all" | TicketStatus) => void;
  onCategoryChange: (value: "all" | SupportCategory) => void;
  onToggleTicket: (id: string) => void;
  onToggleFilteredTickets: () => void;
  onClearSelection: () => void;
  onBulkUpdate: (status: TicketStatus) => void;
  onUpdateTicket: (id: string, status: TicketStatus) => void;
  onExport: () => void;
  onPageChange: (offset: number) => void;
}) {
  return (
    <section className="panel-aluminum overflow-hidden rounded-md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--aluminum-line)] px-3 py-2.5">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
            Ticket workspace
          </h2>
          <p className="text-[9px] text-muted-foreground">
            {filteredTickets.length} shown · {data.tickets.length} loaded ·{" "}
            {data.ticketTotal.toLocaleString()} total
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={!filteredTickets.length}
            className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px] disabled:opacity-50"
          >
            Export CSV
          </button>
          <Link
            to="/support"
            className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px]"
          >
            Public form
          </Link>
        </div>
      </div>
      <div className="grid gap-2 border-b border-[var(--aluminum-line)] bg-black/10 px-3 py-3 md:grid-cols-[minmax(180px,1fr)_180px_180px]">
        <label>
          <span className="sr-only">Search support tickets</span>
          <input
            type="search"
            value={ticketSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search tickets, reports, paths..."
            className="support-field py-2"
          />
        </label>
        <SelectMenu
          label="Status"
          value={ticketStatus}
          onChange={(value) => onStatusChange(value as "all" | TicketStatus)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
        <SelectMenu
          label="Category"
          value={ticketCategory}
          onChange={(value) => onCategoryChange(value as "all" | SupportCategory)}
          options={[
            { value: "all", label: "All categories" },
            { value: "playback", label: "Playback" },
            { value: "subtitles", label: "Subtitles" },
            { value: "audio", label: "Audio" },
            { value: "downloads", label: "Downloads" },
            { value: "catalog", label: "Catalog" },
            { value: "legal", label: "Legal" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      {selectedTicketIds.size ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--aluminum-line)] bg-primary/8 px-3 py-2">
          <span className="mr-auto text-[10px] font-medium">
            {selectedTicketIds.size} ticket{selectedTicketIds.size === 1 ? "" : "s"} selected
          </span>
          <BulkButton
            label="Mark open"
            disabled={bulkUpdating}
            onClick={() => onBulkUpdate("open")}
          />
          <BulkButton
            label="Mark in progress"
            disabled={bulkUpdating}
            onClick={() => onBulkUpdate("in_progress")}
          />
          <button
            type="button"
            onClick={() => onBulkUpdate("resolved")}
            disabled={bulkUpdating}
            className="btn-aqua btn-aqua-interactive rounded-full px-3 py-1 text-[10px] disabled:opacity-50"
          >
            {bulkUpdating ? "Updating..." : "Resolve selected"}
          </button>
          <BulkButton label="Clear" disabled={bulkUpdating} onClick={onClearSelection} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-[10px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-[var(--aluminum-line)]">
              <th className="w-10 px-3 py-2 font-medium">
                <input
                  type="checkbox"
                  aria-label="Select all filtered tickets"
                  checked={allFilteredTicketsSelected}
                  onChange={onToggleFilteredTickets}
                  disabled={!filteredTickets.length || bulkUpdating}
                  className="h-3.5 w-3.5 rounded border border-[oklch(0.3_0.005_250)] bg-black/20 text-primary focus:ring-primary/50"
                />
              </th>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Report</th>
              <th className="px-3 py-2 font-medium">Context</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                selected={selectedTicketIds.has(ticket.id)}
                disabled={bulkUpdating}
                onToggle={onToggleTicket}
                onUpdate={onUpdateTicket}
              />
            ))}
            {!filteredTickets.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No support tickets match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data.ticketTotal > data.tickets.length ? (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--aluminum-line)] px-3 py-2 text-[10px] text-muted-foreground">
          <span>
            Tickets {ticketOffset + 1}-
            {Math.min(ticketOffset + data.tickets.length, data.ticketTotal)} of{" "}
            {data.ticketTotal.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <BulkButton
              label="Previous"
              disabled={loading || ticketOffset === 0}
              onClick={() => onPageChange(Math.max(0, ticketOffset - 100))}
            />
            <BulkButton
              label="Next"
              disabled={loading || ticketOffset + data.tickets.length >= data.ticketTotal}
              onClick={() => onPageChange(ticketOffset + 100)}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TicketRow({
  ticket,
  selected,
  disabled,
  onToggle,
  onUpdate,
}: {
  ticket: Ticket;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onUpdate: (id: string, status: TicketStatus) => void;
}) {
  return (
    <tr className="border-b border-[var(--aluminum-line)]/70 hover:bg-white/3">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ticket ${ticket.id}`}
          checked={selected}
          onChange={() => onToggle(ticket.id)}
          disabled={disabled}
          className="h-3.5 w-3.5 rounded border border-[oklch(0.3_0.005_250)] bg-black/20 text-primary focus:ring-primary/50"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium text-primary">{ticket.id}</td>
      <td className="px-3 py-2 capitalize text-foreground/80">{ticket.category}</td>
      <td className="max-w-[380px] px-3 py-2">
        <div className="line-clamp-2 text-foreground/85">{ticket.message}</div>
        {ticket.email ? (
          <div className="mt-0.5 text-[9px] text-muted-foreground">{ticket.email}</div>
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
          ariaLabel={`Status for ticket ${ticket.id}`}
          value={ticket.status}
          onChange={(value) => onUpdate(ticket.id, value as TicketStatus)}
          options={[
            { value: "open", label: "Open" },
            { value: "in_progress", label: "In progress" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
      </td>
    </tr>
  );
}

function BulkButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[10px] disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function downloadCsv(fileName: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
