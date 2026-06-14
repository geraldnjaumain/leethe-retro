# Production operations

## Release gate

1. Confirm content distribution rights and have `/legal` reviewed for the launch jurisdiction.
2. Configure the required environment variables from `.env.example` in the platform secret store.
3. Keep `ENABLE_EXTERNAL_STREAM_RESOLVER=false` until rights are documented and approved.
4. Run `npm run db:migrate` with `DATABASE_ADMIN_URL`.
5. Deploy the container and require `/readyz` to return HTTP 200 before routing traffic.
6. Run `npm run check`, `npm run smoke:production`, and a browser smoke test against the deployed
   URL.

## Database

- `DATABASE_ADMIN_URL` is only for migration and cleanup workflows.
- `DATABASE_URL` must use the least-privileged `leethe_app` role.
- Optional `CATALOG_DATABASE_SHARD_URLS` values hold deterministically routed title and
  title-genre rows. Configure matching `CATALOG_DATABASE_SHARD_ADMIN_URLS` before running
  migrations or role reconciliation. Keep every shard in the same low-latency region as the app.
- Keep `DATABASE_URL` as the control database. Catalog page manifests and operational tables stay
  there so homepage reads do not need a scatter-gather query.
- Before deploying a changed shard count, run migrations and role provisioning for every shard,
  set `CATALOG_RESHARD_SOURCE_URL` to the existing title store, run
  `npm run db:reshard-catalog`, and finish with `npm run db:verify`. Changing the shard count changes
  modulo routing and therefore always requires this backfill.
- CI applies every migration twice against disposable PostgreSQL to catch invalid or non-idempotent
  SQL before release.
- Migration runs acquire a database lease and reject overlapping manual or automated migrations.
- Releases, maintenance, and manual migrations run `npm run db:verify` to prove required
  migrations, tables, catalog data, least-privilege separation, and application-role writes.
- `npm run db:apply-app-privileges` reconciles explicit table permissions after every migration;
  the application role cannot alter migrations, delete catalog data, or create schema objects.
- Run `npm run db:rotate-admin-password` after suspected exposure and update the platform secret.
- Create a Neon branch for staging and run migrations there before production.
- Test point-in-time restore quarterly and before destructive migrations.
- A verified compressed Postgres backup is retained as a GitHub Actions artifact for 14 days.
  Every backup is restored into an isolated PostgreSQL service before being retained. Point-in-time
  recovery should still be exercised quarterly against a separate Neon branch.

## Runtime

- The supported runtime is the Docker image using Node 22 and `srvx`.
- Terminate TLS at the load balancer and set `TRUST_PROXY=true` only when forwarded headers are
  overwritten by that trusted proxy.
- Filesystem caching is disabled in production unless `LOCAL_CACHE_DIR` is explicitly configured.
  Put `/tmdb-img/*` behind a CDN rather than relying on local instance storage.
- Collection and TV-season payloads are persisted in Neon and retained for 30 days after expiry so
  those views can use stale data during an upstream outage.
- Configure platform-level rate limiting in addition to the application limits.
- Set `TRUST_PROXY=true` only when the hosting proxy overwrites client IP headers. Without it, the
  application limiter acts as a generous global circuit breaker.
- Store a unique 16+ character `ADMIN_PASSWORD` in the platform secret store to enable `/admin`, rotate it after suspected
  exposure, and place the route behind the platform identity proxy for production teams.
- Set `ENABLE_PRODUCT_ANALYTICS=true` only after the privacy notice and retention policy are
  approved. The daily cleanup removes analytics after 90 days and resolved support tickets after
  180 days.
- Override stream or catalog provider origins with `MOVIEBOX_API_HOSTS`, `MOVIEBOX_H5_API_HOST`,
  `MOVIEBOX_WEB_ORIGIN`, `TMDB_API_BASE_URL`, and `TMDB_IMAGE_BASE_URL` when providers move.

## Monitoring

- Scrape `/healthz` for liveness and `/readyz?strict=1` for dependency readiness. The normal
  `/readyz` endpoint remains HTTP 200 with a degraded payload during a Neon outage so the runtime
  can continue serving through TMDB rather than being restarted out of rotation.
- Ingest the JSON request logs and alert on elevated 5xx responses, 429 responses, latency, Neon
  errors, and upstream errors.
- Run the catalog cleanup workflow daily.
- The maintenance workflow refreshes ranked catalog pages every six hours, applies migrations,
  enforces retention, and verifies readiness. Refreshes use a renewable database lease, retry
  transient TMDB errors, preserve successful pages, and fail visibly when any operations remain
  unsuccessful.
- Successful `main` builds smoke-test the exact release image, serialize database writes, apply
  migrations, preserve the previous image, publish to GHCR, trigger an optional platform deploy
  hook, and verify readiness. Configure `ROLLBACK_HOOK_URL` to automatically redeploy the
  `:previous` image after failed readiness.
- The uptime workflow checks liveness and readiness every 15 minutes. Configure the production
  environment variable `PRODUCTION_URL` in GitHub before launch.
- Configure the production environment secret `ALERT_WEBHOOK_URL` to send structured JSON alerts
  for failed release, backup, maintenance, uptime, migration, cleanup, and security workflows.
- Dependabot opens weekly dependency updates. Patch and minor updates merge only after required
  branch checks pass; major updates require review.

## Incident response

1. Disable external streaming immediately if content rights or upstream authorization is disputed.
2. Preserve relevant request logs and rotate affected credentials.
3. Restore Neon from a known point or create a recovery branch if data is corrupted.
4. Document impact, timeline, remediation, and follow-up controls.
