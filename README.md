# Leethe

Leethe is a TanStack Start movie and series catalog backed by Neon Postgres and TMDB. The supported
production runtime is Node 22 in the included Docker image.

## Local setup

1. Install Node 22 and run `npm ci`.
2. Copy the variable names from `.env.example` into a local `.env`.
3. Run `npm run db:migrate`, then `npm run db:provision-app-role`.
4. Run `npm run db:verify`, then `npm run dev`.

The `.env` file is ignored. Use `DATABASE_ADMIN_URL` only for migration, privilege reconciliation,
backup, cleanup, and recovery. The application must use the restricted `DATABASE_URL`.

## Production

Run the complete release gate:

```sh
npm run check
docker build -t leethe .
docker run --env-file .env -p 3000:3000 leethe
```

Configure the GitHub `production` environment with these secrets:

- `DATABASE_ADMIN_URL`
- `DATABASE_URL`
- `TMDB_READ_ACCESS_TOKEN`

Configure the `PRODUCTION_URL` GitHub environment variable. Configure optional production
environment secrets `DEPLOY_HOOK_URL`, `ROLLBACK_HOOK_URL`, and `ALERT_WEBHOOK_URL` for automated
deployment, rollback, and failure alerts. Scheduled workflows then handle uptime checks, migrations,
catalog refresh, retention cleanup, security audits, dependency updates, and database snapshots.

Successful `main` builds publish `ghcr.io/<owner>/<repository>:latest` and preserve the prior image
as `:previous`. The release workflow smoke-tests the exact image, applies migrations, publishes it,
triggers deployment, verifies `PRODUCTION_URL`, and can invoke a rollback hook if readiness fails.

Run `npm run smoke:production` after a production build to verify liveness, database readiness,
rendering, metadata routes, immutable asset caching, security headers, and request-size limits.
Catalog reads fall back to stale Neon data during TMDB outages, while scheduled refreshes use a
renewable database lease, retry transient failures, preserve partial progress, and report failures.
Collection and TV-season payloads are also persisted in Neon so supporting title and episode data
survives process restarts and upstream outages.
During a Neon outage, normal readiness remains HTTP 200 so upstream TMDB traffic can still be
served; operational checks use `/readyz?strict=1` to alert until Neon recovers.

External playback is disabled in production unless both `ENABLE_EXTERNAL_STREAM_RESOLVER=true` and
`STREAMING_RIGHTS_CONFIRMED=true` are configured. Do not enable it without documented distribution
rights.

The public support form stores tickets in Postgres. Set `ADMIN_PASSWORD` to enable the `/admin`
operations dashboard, and set `ENABLE_PRODUCT_ANALYTICS=true` to collect minimal first-party product
events for its charts. Daily cleanup retains analytics for 90 days and removes resolved support
tickets after 180 days. Stream provider endpoints can be changed with `MOVIEBOX_API_HOSTS`,
`MOVIEBOX_H5_API_HOST`, and `MOVIEBOX_WEB_ORIGIN` without rebuilding the app. TMDB API and image
origins can be overridden with `TMDB_API_BASE_URL` and `TMDB_IMAGE_BASE_URL`.

See [OPERATIONS.md](./OPERATIONS.md) for release, monitoring, restore, and incident procedures.
