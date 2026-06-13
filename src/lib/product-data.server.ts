import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { envFlag, envValue } from "./env.server";

type SqlClient = NeonQueryFunction<false, false>;

export type SupportCategory =
  | "playback"
  | "subtitles"
  | "audio"
  | "downloads"
  | "catalog"
  | "legal"
  | "other";

export type TicketStatus = "open" | "in_progress" | "resolved";

export type ProductEventName =
  | "page_view"
  | "playback_start"
  | "playback_error"
  | "download"
  | "support_submitted";

export type ProductEventInput = {
  eventName: ProductEventName;
  sessionId?: string;
  path?: string;
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
};

export type SupportTicketInput = {
  category: SupportCategory;
  email?: string;
  message: string;
  path?: string;
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
};

export type AdminDashboard = {
  totals: {
    pageViews: number;
    playbackStarts: number;
    downloads: number;
    openTickets: number;
  };
  previousTotals: {
    pageViews: number;
    playbackStarts: number;
    downloads: number;
    openTickets: number;
  };
  daily: Array<{
    date: string;
    pageViews: number;
    playbackStarts: number;
    downloads: number;
  }>;
  eventTotals: Array<{ name: ProductEventName; count: number }>;
  tickets: Array<{
    id: string;
    category: SupportCategory;
    email: string | null;
    message: string;
    path: string | null;
    mediaType: "movie" | "tv" | null;
    tmdbId: number | null;
    season: number | null;
    episode: number | null;
    status: TicketStatus;
    createdAt: string;
    updatedAt: string;
  }>;
  system: {
    database: "healthy";
    analytics: "enabled" | "disabled";
    streamResolver: "enabled" | "disabled";
  };
  popularTitles: Array<{
    rank: number;
    title: string;
    mediaType: "movie" | "tv";
    popularity: number;
  }>;
};

let cachedSql: SqlClient | undefined;
let cachedUrl = "";

function sql() {
  const url = envValue("DATABASE_URL") || envValue("NEON_DATABASE_URL") || envValue("POSTGRES_URL");
  if (!url) throw new Error("Product operations require DATABASE_URL.");
  if (!cachedSql || cachedUrl !== url) {
    cachedSql = neon(url);
    cachedUrl = url;
  }
  return cachedSql;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

export function assertAdminPassword(password: string) {
  const configured = envValue("ADMIN_PASSWORD");
  if (!configured) throw new Error("Admin access is not configured.");
  if (!timingSafeEqual(hash(password), hash(configured))) {
    throw new Error("Invalid admin password.");
  }
}

export function productAnalyticsEnabled() {
  return envFlag("ENABLE_PRODUCT_ANALYTICS");
}

export async function createSupportTicket(input: SupportTicketInput) {
  const id = `TKT-${randomUUID().slice(0, 8).toUpperCase()}`;
  await sql().query(
    `INSERT INTO support_tickets (
      id, category, email, message, path, media_type, tmdb_id, season, episode
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.category,
      input.email || null,
      input.message,
      input.path || null,
      input.mediaType || null,
      input.tmdbId || null,
      input.season || null,
      input.episode || null,
    ],
  );
  return id;
}

export async function recordProductEvent(input: ProductEventInput) {
  if (!productAnalyticsEnabled()) return false;
  await sql().query(
    `INSERT INTO analytics_events (
      event_name, session_id, path, media_type, tmdb_id, season, episode
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.eventName,
      input.sessionId || null,
      input.path || null,
      input.mediaType || null,
      input.tmdbId || null,
      input.season || null,
      input.episode || null,
    ],
  );
  return true;
}

function dateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function asCount(value: unknown) {
  return Number(value ?? 0);
}

export async function readAdminDashboard(): Promise<AdminDashboard> {
  const db = sql();
  const [eventRows, ticketRows, dailyRows, ticketSummaryRows, popularRows] = await Promise.all([
    db.query(
      `SELECT
        event_name,
        count(*) FILTER (WHERE occurred_at >= now() - interval '14 days')::integer AS current_count,
        count(*) FILTER (
          WHERE occurred_at >= now() - interval '28 days'
            AND occurred_at < now() - interval '14 days'
        )::integer AS previous_count
       FROM analytics_events
       GROUP BY event_name`,
    ),
    db.query(
      `SELECT
        id, category, email, message, path, media_type, tmdb_id, season, episode, status,
        created_at, updated_at
       FROM support_tickets
       ORDER BY updated_at DESC
       LIMIT 30`,
    ),
    db.query(
      `SELECT
        date_trunc('day', occurred_at)::date AS day,
        count(*) FILTER (WHERE event_name = 'page_view')::integer AS page_views,
        count(*) FILTER (WHERE event_name = 'playback_start')::integer AS playback_starts,
        count(*) FILTER (WHERE event_name = 'download')::integer AS downloads
       FROM analytics_events
       WHERE occurred_at >= date_trunc('day', now()) - interval '13 days'
       GROUP BY day
       ORDER BY day`,
    ),
    db.query(
      `SELECT
        count(*) FILTER (WHERE status <> 'resolved')::integer AS open_count,
        count(*) FILTER (
          WHERE status <> 'resolved' AND created_at < now() - interval '14 days'
        )::integer AS previous_open_count
       FROM support_tickets`,
    ),
    db.query(
      `SELECT title, media_type, popularity
       FROM media_titles
       ORDER BY popularity::numeric DESC
       LIMIT 10`,
    ),
  ]);

  const eventMap = new Map(
    eventRows.map((row) => [
      String(row.event_name) as ProductEventName,
      { current: asCount(row.current_count), previous: asCount(row.previous_count) },
    ]),
  );
  const openTickets = asCount(ticketSummaryRows[0]?.open_count);
  const previousOpenTickets = asCount(ticketSummaryRows[0]?.previous_open_count);

  const byDate = new Map(
    dailyRows.map((row) => [
      dateKey(row.day),
      {
        pageViews: asCount(row.page_views),
        playbackStarts: asCount(row.playback_starts),
        downloads: asCount(row.downloads),
      },
    ]),
  );
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, ...(byDate.get(key) ?? { pageViews: 0, playbackStarts: 0, downloads: 0 }) };
  });

  const count = (name: ProductEventName, period: "current" | "previous") =>
    eventMap.get(name)?.[period] ?? 0;

  return {
    totals: {
      pageViews: count("page_view", "current"),
      playbackStarts: count("playback_start", "current"),
      downloads: count("download", "current"),
      openTickets,
    },
    previousTotals: {
      pageViews: count("page_view", "previous"),
      playbackStarts: count("playback_start", "previous"),
      downloads: count("download", "previous"),
      openTickets: previousOpenTickets,
    },
    daily,
    eventTotals: (
      [
        "page_view",
        "playback_start",
        "download",
        "playback_error",
        "support_submitted",
      ] as ProductEventName[]
    ).map((name) => ({ name, count: count(name, "current") })),
    tickets: ticketRows.map((row) => ({
      id: String(row.id),
      category: row.category as SupportCategory,
      email: row.email ? String(row.email) : null,
      message: String(row.message),
      path: row.path ? String(row.path) : null,
      mediaType: row.media_type as "movie" | "tv" | null,
      tmdbId: row.tmdb_id ? Number(row.tmdb_id) : null,
      season: row.season ? Number(row.season) : null,
      episode: row.episode ? Number(row.episode) : null,
      status: row.status as TicketStatus,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
    system: {
      database: "healthy",
      analytics: productAnalyticsEnabled() ? "enabled" : "disabled",
      streamResolver:
        envFlag("ENABLE_EXTERNAL_STREAM_RESOLVER") && envFlag("STREAMING_RIGHTS_CONFIRMED")
          ? "enabled"
          : "disabled",
    },
    popularTitles: popularRows.map((row, index) => ({
      rank: index + 1,
      title: String(row.title),
      mediaType: row.media_type as "movie" | "tv",
      popularity: Number(row.popularity) || 0,
    })),
  };
}

export async function setSupportTicketStatus(id: string, status: TicketStatus) {
  const rows = await sql().query(
    `UPDATE support_tickets
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, status],
  );
  if (!rows.length) throw new Error("Support ticket not found.");
}
