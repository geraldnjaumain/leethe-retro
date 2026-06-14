# Performance Plan

## Existing Controls

- Route/code splitting through TanStack Start and Vite.
- Catalog and episode virtualization.
- Lazy poster loading and stable image aspect ratios.
- TMDB response, payload, image, and database caching.
- Immutable built-asset caching and optional CDN-friendly image route.
- Bounded upstream retries, timeouts, response sizes, and paginated catalog reads.
- Database indexes for search, sort, relations, retention, and operations.
- Database-first stale-while-revalidate catalog/detail reads.
- Single-read detail freshness checks, bounded hot-detail caching, and poster-intent prefetching.
- Single-query catalog page/card reads on the default deployment, minimal card-column payloads,
  one-read freshness checks, and bounded hot page/genre caches.
- Optional deterministic title sharding with direct keyed reads and parallel bounded fan-out.
- Debounced catalog search and autocomplete.
- Bounded process-level TMDB response cache.
- Failed background-refresh cooldowns to keep broken upstream credentials from consuming request
  capacity repeatedly.
- Local bounded global rate limiting when `TRUST_PROXY=false`, avoiding a remote database write on
  every public read while retaining shared per-client limits behind a trusted production proxy.

## Audit Actions

- Avoid duplicate stream resolution in the TV download flow.
- Keep subtitle proxy responses bounded.
- Avoid state updates during render.
- Preserve reduced-motion behavior and minimize unnecessary window listeners.
- Avoid duplicated fresh/stale catalog reads and deduplicate background refreshes.
- Remove the unused animated catalog companion and its 3 MB of deployment assets.

## Remaining Checks

- Measure bundle size and Core Web Vitals in a production deployment.
- Verify catalog window virtualization after real page scrolling on mobile and desktop.
- Split or replace the 509 KB minified HLS runtime if a materially smaller compatible player is
  validated; it is already loaded only on demand.
- Put `/tmdb-img/*` behind a CDN in production.
- Keep the application runtime and Neon primary region colocated; the current `us-west-2` database
  adds significant cold-detail latency for users and development sessions far from that region.
- Prefer Neon read replicas for CPU-bound read scaling before physical catalog shards. Physical
  shards add fan-out and operational cost and should be enabled only after load tests show the
  single control database and one-query page path are saturated.
- Load-test stream, support, analytics, and admin rate limits behind the actual trusted proxy.
