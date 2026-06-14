# Product Brief

## Product

Leethe is a responsive movie and television discovery experience with optional rights-gated
playback and direct-download tools. It uses TMDB for catalog metadata, Neon Postgres for resilient
catalog and operations data, and a small first-party operations dashboard.

## Users And Jobs

- Viewers discover titles by media type, genre, popularity, release date, rating, or search.
- Viewers inspect title, collection, cast, season, and episode details.
- Viewers follow live sports scores, schedules, results, news, and available direct streams.
- Viewers resume playback locally and select available streams, audio, subtitles, and downloads.
- Viewers control persisted autoplay-next, autoplay-video, and playback-speed preferences.
- Viewers report catalog, playback, subtitle, audio, download, legal, or other issues.
- Operators use a command center to triage threshold-based production alerts and outcomes.
- Operators inspect audience/playback paths, reliability, catalog freshness/coverage, and support
  backlog aging before resolving, filtering, or exporting tickets.

## Roles And Permissions

- Public viewer: catalog reads, playback resolution when enabled, local preferences, support writes.
- Operator: password-protected dashboard reads and support ticket status updates.
- Application database role: least-privileged reads and approved inserts/updates.
- Database administrator: migrations, privileges, cleanup, backup, restore, and recovery only.

## Core Data

TMDB titles, genres, catalog pages, cached payloads, support tickets, aggregate product events,
rate-limit buckets, job leases, and schema migration records.

## Success Metrics

- Catalog and title pages remain usable during a single upstream or database outage.
- Playback and download controls report availability honestly.
- Support reports reach operators with useful context.
- Production releases pass lint, typecheck, tests, workflow validation, build, and smoke checks.
- No client-visible secrets, open server-side fetch proxy, or unauthenticated private write.

## Non-Goals

- User accounts, social features, payments, recommendations based on personal viewing history, or
  ownership of third-party media.
- Enabling external playback without documented distribution rights.

## Current Audit Priorities

1. Replace the invalid TMDB credential and rotate every credential exposed during audit.
2. Add a visible continue-watching/watchlist surface and profiles only with a defined sync model.
3. Replace password-only operator access with identity-backed authenticated sessions.
4. Validate rights-approved playback end to end before enabling the resolver.
