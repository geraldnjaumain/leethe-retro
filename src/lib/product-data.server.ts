import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { catalogShards } from "./catalog-shards.server";
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
    playbackErrors: number;
    downloads: number;
    supportSubmitted: number;
  }>;
  eventTotals: Array<{ name: ProductEventName; count: number }>;
  uniqueSessions: number;
  topPaths: Array<{
    path: string;
    pageViews: number;
    playbackStarts: number;
    playbackErrors: number;
    downloads: number;
  }>;
  mediaTypes: Array<{
    mediaType: "movie" | "tv";
    pageViews: number;
    playbackStarts: number;
    playbackErrors: number;
    downloads: number;
  }>;
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
  ticketTotal: number;
  system: {
    database: "healthy";
    analytics: "enabled" | "disabled";
    streamResolver: "enabled" | "disabled";
    dashboardQueryMs: number;
    catalogTitles: number;
    catalogDetails: number;
    catalogShards: number;
    catalogPages: number;
    staleCatalogPages: number;
    recentSyncFailures: number;
    activeRateLimitBuckets: number;
    schemaMigrations: number;
    lastCatalogSync: string | null;
    lastAnalyticsEvent: string | null;
    oldestOpenTicket: string | null;
    resolvedLast14Days: number;
    ticketsOlderThan24Hours: number;
    ticketsOlderThan7Days: number;
    tickets: {
      open: number;
      inProgress: number;
      resolved: number;
    };
  };
  popularTitles: Array<{
    rank: number;
    title: string;
    mediaType: "movie" | "tv";
    popularity: number;
  }>;
  catalogBreakdown: Array<{
    mediaType: "movie" | "tv";
    titles: number;
    details: number;
  }>;
  shardStats: Array<{
    shard: number;
    titles: number;
    details: number;
  }>;
  supportCategories: Array<{
    category: SupportCategory;
    open: number;
    inProgress: number;
    resolved: number;
    total: number;
  }>;
  recentSyncEvents: Array<{
    source: string;
    mediaType: "movie" | "tv" | null;
    page: number | null;
    itemCount: number;
    syncedAt: string;
    failed: boolean;
  }>;
  auditEvents: Array<{
    id: number;
    action: string;
    targetId: string | null;
    affectedCount: number;
    status: TicketStatus | null;
    occurredAt: string;
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

export async function readAdminDashboard(ticketOffset = 0): Promise<AdminDashboard> {
  const db = sql();
  const startedAt = Date.now();
  const shards = catalogShards();
  const [controlRows, shardRows] = await Promise.all([
    Promise.all([
      db.query(
        `SELECT
        event_name,
        count(*) FILTER (WHERE occurred_at >= now() - interval '14 days')::integer AS current_count,
        count(*) FILTER (
          WHERE occurred_at >= now() - interval '28 days'
            AND occurred_at < now() - interval '14 days'
        )::integer AS previous_count
       FROM analytics_events
       WHERE occurred_at >= now() - interval '28 days'
       GROUP BY event_name`,
      ),
      db.query(
        `SELECT
        id, category, email, message, path, media_type, tmdb_id, season, episode, status,
        created_at, updated_at
       FROM support_tickets
       ORDER BY updated_at DESC
       LIMIT 100 OFFSET $1`,
        [ticketOffset],
      ),
      db.query(
        `SELECT
        date_trunc('day', occurred_at)::date AS day,
        count(*) FILTER (WHERE event_name = 'page_view')::integer AS page_views,
        count(*) FILTER (WHERE event_name = 'playback_start')::integer AS playback_starts,
        count(*) FILTER (WHERE event_name = 'playback_error')::integer AS playback_errors,
        count(*) FILTER (WHERE event_name = 'download')::integer AS downloads,
        count(*) FILTER (WHERE event_name = 'support_submitted')::integer AS support_submitted
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
        )::integer AS previous_open_count,
        count(*)::integer AS total_count
       FROM support_tickets`,
      ),
      db.query(
        `SELECT
        (SELECT count(*)::integer FROM catalog_pages) AS catalog_pages,
        (SELECT count(*)::integer
          FROM catalog_pages
          WHERE synced_at < now() - interval '24 hours') AS stale_catalog_pages,
        (SELECT max(synced_at) FROM catalog_sync_events) AS last_catalog_sync,
        (SELECT count(*)::integer
          FROM catalog_sync_events
          WHERE source LIKE 'failed:%' AND synced_at >= now() - interval '24 hours'
        ) AS recent_sync_failures,
        (SELECT count(*)::integer
          FROM rate_limit_buckets
          WHERE expires_at > now()) AS active_rate_limit_buckets,
        (SELECT count(*)::integer FROM schema_migrations) AS schema_migrations,
        (SELECT max(occurred_at) FROM analytics_events) AS last_analytics_event,
        min(created_at) FILTER (WHERE status <> 'resolved') AS oldest_open_ticket,
        count(*) FILTER (
          WHERE status = 'resolved' AND updated_at >= now() - interval '14 days'
        )::integer AS resolved_last_14_days,
        count(*) FILTER (
          WHERE status <> 'resolved' AND created_at < now() - interval '24 hours'
        )::integer AS tickets_older_than_24_hours,
        count(*) FILTER (
          WHERE status <> 'resolved' AND created_at < now() - interval '7 days'
        )::integer AS tickets_older_than_7_days,
        count(*) FILTER (WHERE status = 'open')::integer AS open_tickets,
        count(*) FILTER (WHERE status = 'in_progress')::integer AS in_progress_tickets,
        count(*) FILTER (WHERE status = 'resolved')::integer AS resolved_tickets
       FROM support_tickets`,
      ),
      db.query(
        `SELECT media_type, source, page, item_count, synced_at
         FROM catalog_sync_events
         ORDER BY synced_at DESC
         LIMIT 12`,
      ),
      db.query(
        `SELECT id, action, target_id, metadata, occurred_at
         FROM admin_audit_events
         ORDER BY occurred_at DESC
         LIMIT 20`,
      ),
      db.query(
        `SELECT
          coalesce(path, 'Unknown path') AS path,
          count(*) FILTER (WHERE event_name = 'page_view')::integer AS page_views,
          count(*) FILTER (WHERE event_name = 'playback_start')::integer AS playback_starts,
          count(*) FILTER (WHERE event_name = 'playback_error')::integer AS playback_errors,
          count(*) FILTER (WHERE event_name = 'download')::integer AS downloads
         FROM analytics_events
         WHERE occurred_at >= now() - interval '14 days'
         GROUP BY path
         ORDER BY count(*) DESC
         LIMIT 12`,
      ),
      db.query(
        `SELECT
          media_type,
          count(*) FILTER (WHERE event_name = 'page_view')::integer AS page_views,
          count(*) FILTER (WHERE event_name = 'playback_start')::integer AS playback_starts,
          count(*) FILTER (WHERE event_name = 'playback_error')::integer AS playback_errors,
          count(*) FILTER (WHERE event_name = 'download')::integer AS downloads
         FROM analytics_events
         WHERE occurred_at >= now() - interval '14 days'
           AND media_type IS NOT NULL
         GROUP BY media_type`,
      ),
      db.query(
        `SELECT
          category,
          count(*) FILTER (WHERE status = 'open')::integer AS open_count,
          count(*) FILTER (WHERE status = 'in_progress')::integer AS in_progress_count,
          count(*) FILTER (WHERE status = 'resolved')::integer AS resolved_count,
          count(*)::integer AS total_count
         FROM support_tickets
         GROUP BY category
         ORDER BY count(*) FILTER (WHERE status <> 'resolved') DESC, category`,
      ),
      db.query(
        `SELECT count(DISTINCT session_id)::integer AS unique_sessions
         FROM analytics_events
         WHERE occurred_at >= now() - interval '14 days'
           AND session_id IS NOT NULL`,
      ),
    ]),
    Promise.all(
      shards.map(({ db: shard }) =>
        Promise.all([
          shard.query(
            `SELECT
              count(*)::integer AS catalog_titles,
              count(*) FILTER (WHERE detail_raw IS NOT NULL)::integer AS catalog_details,
              count(*) FILTER (WHERE media_type = 'movie')::integer AS movie_titles,
              count(*) FILTER (
                WHERE media_type = 'movie' AND detail_raw IS NOT NULL
              )::integer AS movie_details,
              count(*) FILTER (WHERE media_type = 'tv')::integer AS tv_titles,
              count(*) FILTER (
                WHERE media_type = 'tv' AND detail_raw IS NOT NULL
              )::integer AS tv_details
             FROM media_titles`,
          ),
          shard.query(
            `SELECT title, media_type, popularity
             FROM media_titles
             ORDER BY popularity::numeric DESC
             LIMIT 10`,
          ),
        ]),
      ),
    ),
  ]);
  const [
    eventRows,
    ticketRows,
    dailyRows,
    ticketSummaryRows,
    operationsRows,
    syncRows,
    auditRows,
    pathRows,
    mediaRows,
    supportCategoryRows,
    sessionRows,
  ] = controlRows;
  const catalogStats = shardRows.map(([stats]) => stats[0] ?? {});
  const popularRows = shardRows
    .flatMap(([, popular]) => popular)
    .sort((a, b) => Number(b.popularity) - Number(a.popularity))
    .slice(0, 10);

  const eventMap = new Map(
    eventRows.map((row) => [
      String(row.event_name) as ProductEventName,
      { current: asCount(row.current_count), previous: asCount(row.previous_count) },
    ]),
  );
  const openTickets = asCount(ticketSummaryRows[0]?.open_count);
  const previousOpenTickets = asCount(ticketSummaryRows[0]?.previous_open_count);
  const operations = operationsRows[0] ?? {};
  const catalogTitles = catalogStats.reduce((total, row) => total + asCount(row.catalog_titles), 0);
  const catalogDetails = catalogStats.reduce(
    (total, row) => total + asCount(row.catalog_details),
    0,
  );

  const byDate = new Map(
    dailyRows.map((row) => [
      dateKey(row.day),
      {
        pageViews: asCount(row.page_views),
        playbackStarts: asCount(row.playback_starts),
        playbackErrors: asCount(row.playback_errors),
        downloads: asCount(row.downloads),
        supportSubmitted: asCount(row.support_submitted),
      },
    ]),
  );
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      ...(byDate.get(key) ?? {
        pageViews: 0,
        playbackStarts: 0,
        playbackErrors: 0,
        downloads: 0,
        supportSubmitted: 0,
      }),
    };
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
    uniqueSessions: asCount(sessionRows[0]?.unique_sessions),
    topPaths: pathRows.map((row) => ({
      path: String(row.path),
      pageViews: asCount(row.page_views),
      playbackStarts: asCount(row.playback_starts),
      playbackErrors: asCount(row.playback_errors),
      downloads: asCount(row.downloads),
    })),
    mediaTypes: mediaRows.map((row) => ({
      mediaType: row.media_type as "movie" | "tv",
      pageViews: asCount(row.page_views),
      playbackStarts: asCount(row.playback_starts),
      playbackErrors: asCount(row.playback_errors),
      downloads: asCount(row.downloads),
    })),
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
    ticketTotal: asCount(ticketSummaryRows[0]?.total_count),
    system: {
      database: "healthy",
      analytics: productAnalyticsEnabled() ? "enabled" : "disabled",
      streamResolver:
        envFlag("ENABLE_EXTERNAL_STREAM_RESOLVER") && envFlag("STREAMING_RIGHTS_CONFIRMED")
          ? "enabled"
          : "disabled",
      dashboardQueryMs: Date.now() - startedAt,
      catalogTitles,
      catalogDetails,
      catalogShards: shards.length,
      catalogPages: asCount(operations.catalog_pages),
      staleCatalogPages: asCount(operations.stale_catalog_pages),
      recentSyncFailures: asCount(operations.recent_sync_failures),
      activeRateLimitBuckets: asCount(operations.active_rate_limit_buckets),
      schemaMigrations: asCount(operations.schema_migrations),
      lastCatalogSync: operations.last_catalog_sync
        ? new Date(operations.last_catalog_sync).toISOString()
        : null,
      lastAnalyticsEvent: operations.last_analytics_event
        ? new Date(operations.last_analytics_event).toISOString()
        : null,
      oldestOpenTicket: operations.oldest_open_ticket
        ? new Date(operations.oldest_open_ticket).toISOString()
        : null,
      resolvedLast14Days: asCount(operations.resolved_last_14_days),
      ticketsOlderThan24Hours: asCount(operations.tickets_older_than_24_hours),
      ticketsOlderThan7Days: asCount(operations.tickets_older_than_7_days),
      tickets: {
        open: asCount(operations.open_tickets),
        inProgress: asCount(operations.in_progress_tickets),
        resolved: asCount(operations.resolved_tickets),
      },
    },
    popularTitles: popularRows.map((row, index) => ({
      rank: index + 1,
      title: String(row.title),
      mediaType: row.media_type as "movie" | "tv",
      popularity: Number(row.popularity) || 0,
    })),
    catalogBreakdown: (["movie", "tv"] as const).map((mediaType) => ({
      mediaType,
      titles: catalogStats.reduce((total, row) => total + asCount(row[`${mediaType}_titles`]), 0),
      details: catalogStats.reduce((total, row) => total + asCount(row[`${mediaType}_details`]), 0),
    })),
    shardStats: catalogStats.map((row, index) => ({
      shard: index + 1,
      titles: asCount(row.catalog_titles),
      details: asCount(row.catalog_details),
    })),
    supportCategories: supportCategoryRows.map((row) => ({
      category: row.category as SupportCategory,
      open: asCount(row.open_count),
      inProgress: asCount(row.in_progress_count),
      resolved: asCount(row.resolved_count),
      total: asCount(row.total_count),
    })),
    recentSyncEvents: syncRows.map((row) => ({
      source: String(row.source),
      mediaType: row.media_type as "movie" | "tv" | null,
      page: row.page == null ? null : Number(row.page),
      itemCount: asCount(row.item_count),
      syncedAt: new Date(row.synced_at).toISOString(),
      failed: String(row.source).startsWith("failed:"),
    })),
    auditEvents: auditRows.map((row) => ({
      id: Number(row.id),
      action: String(row.action),
      targetId: row.target_id ? String(row.target_id) : null,
      affectedCount: asCount(
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>).affectedCount
          : 1,
      ),
      status:
        row.metadata &&
        typeof row.metadata === "object" &&
        ["open", "in_progress", "resolved"].includes(
          String((row.metadata as Record<string, unknown>).status),
        )
          ? ((row.metadata as Record<string, unknown>).status as TicketStatus)
          : null,
      occurredAt: new Date(row.occurred_at).toISOString(),
    })),
  };
}

export async function setSupportTicketStatus(id: string, status: TicketStatus) {
  const rows = await sql().query(
    `WITH updated AS (
      UPDATE support_tickets
      SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id
    ), audit AS (
      INSERT INTO admin_audit_events (action, target_type, target_id, metadata)
      SELECT
        'ticket_status_update',
        'support_ticket',
        id,
        jsonb_build_object('status', $2::text, 'affectedCount', 1)
      FROM updated
    )
    SELECT id FROM updated`,
    [id, status],
  );
  if (!rows.length) throw new Error("Support ticket not found.");
}

export async function setSupportTicketsStatus(ids: string[], status: TicketStatus) {
  const rows = await sql().query(
    `WITH updated AS (
      UPDATE support_tickets
      SET status = $2, updated_at = now()
      WHERE id = ANY($1::text[])
      RETURNING id
    ), summary AS (
      SELECT count(*)::integer AS affected_count FROM updated
    ), audit AS (
      INSERT INTO admin_audit_events (action, target_type, metadata)
      SELECT
        'ticket_bulk_status_update',
        'support_ticket_batch',
        jsonb_build_object(
          'status', $2::text,
          'requestedCount', cardinality($1::text[]),
          'affectedCount', affected_count,
          'ticketIds', to_jsonb($1::text[])
        )
      FROM summary
      WHERE affected_count > 0
    )
    SELECT affected_count FROM summary`,
    [ids, status],
  );
  return asCount(rows[0]?.affected_count);
}
