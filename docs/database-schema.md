# Database Schema

Migrations in `migrations/` are the source of truth.

## Tables

- `media_titles`: TMDB title metadata and persisted detail payload.
- `genres`: media-type scoped genres.
- `media_title_genres`: many-to-many title/genre relationship with cascading foreign keys.
- `catalog_pages`: cached ordered result pages.
- `catalog_sync_events`: catalog refresh audit events.
- `rate_limit_buckets`: shared production rate-limit counters.
- `job_leases`: renewable locks for migration and refresh jobs.
- `tmdb_payload_cache`: persistent collection/season payloads.
- `support_tickets`: public reports and operator status.
- `analytics_events`: allowlisted first-party aggregate events.
- `admin_audit_events`: immutable operator ticket-workflow changes.
- `schema_migrations`: migration checksums and application state.

## Constraints And Indexes

Media type, catalog mode, support category/status, analytics event name, and admin audit action are
constrained. Primary keys, foreign keys, trigram title search, sort indexes, retention indexes, and
operational lookup indexes are defined in migrations.

## Access Model

The application role receives only the reads/inserts/updates needed by runtime behavior. It cannot
alter migrations, create schema objects, or delete production data. Admin migrations, cleanup, and
backup use `DATABASE_ADMIN_URL`.

## Migration Plan

Add only forward, idempotent numbered migrations. Update required-migration checks, privilege
contracts, database verification, and backup verification with each new table or permission.

## Optional Catalog Shards

`DATABASE_URL` is the control database and owns catalog page manifests and operational data. When
`CATALOG_DATABASE_SHARD_URLS` is configured, title and title-genre rows route by
`tmdb_id % shard_count`; genres are replicated to each shard. Keyed detail reads go directly to one
shard. Search and similar-title reads fan out in parallel and merge bounded results. Every
configured database receives the same forward migrations.

Changing the shard count changes modulo routing. Run `npm run db:reshard-catalog` from the existing
title store before deploying the new layout; the bounded keyset backfill copies genres, titles,
persisted details, and title-genre relationships.
