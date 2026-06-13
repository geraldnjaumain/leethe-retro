import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_ADMIN_URL or DATABASE_URL before cleanup.");

const sql = neon(databaseUrl);
const deletedEvents = await sql.query(
  "DELETE FROM catalog_sync_events WHERE synced_at < now() - interval '30 days' RETURNING id",
);
const deletedPages = await sql.query(
  "DELETE FROM catalog_pages WHERE synced_at < now() - interval '30 days' RETURNING cache_key",
);
const deletedRateLimits = await sql.query(
  "DELETE FROM rate_limit_buckets WHERE expires_at < now() RETURNING bucket_key",
);
const deletedJobLeases = await sql.query(
  "DELETE FROM job_leases WHERE expires_at < now() RETURNING name",
);
const deletedPayloads = await sql.query(
  "DELETE FROM tmdb_payload_cache WHERE expires_at < now() - interval '30 days' RETURNING cache_key",
);
const deletedAnalytics = await sql.query(
  "DELETE FROM analytics_events WHERE occurred_at < now() - interval '90 days' RETURNING id",
);
const deletedResolvedTickets = await sql.query(
  `DELETE FROM support_tickets
   WHERE status = 'resolved' AND updated_at < now() - interval '180 days'
   RETURNING id`,
);
console.log(
  JSON.stringify({
    level: "info",
    event: "catalog_cleanup",
    deletedEvents: deletedEvents.length,
    deletedPages: deletedPages.length,
    deletedRateLimits: deletedRateLimits.length,
    deletedJobLeases: deletedJobLeases.length,
    deletedPayloads: deletedPayloads.length,
    deletedAnalytics: deletedAnalytics.length,
    deletedResolvedTickets: deletedResolvedTickets.length,
  }),
);
