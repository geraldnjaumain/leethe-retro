# Change Log

## 2026-06-14 - Sports And Playback Reliability

- Rebuilt sports ingestion around normalized match/news records, bounded upstream reads, partial
  source failure handling, and accent-insensitive duplicate merging.
- Added a production sports center with live/upcoming/result totals, league/status filters,
  minute-level score refresh, retry states, team fallbacks, and a dedicated live player.
- Removed iframe/page masquerading from sports playback; only direct MP4/HLS sources receive watch
  actions.
- Signed every sports playlist, segment, and key proxy URL, added proxy rate limits and byte-range
  forwarding, and rejected arbitrary unsigned destinations.
- Fixed movie/series resolution after the provider lowered its resource-page limit, stopped
  repeating non-retryable provider requests across hosts, and deduplicated returned media sources.
- Added automatic next-source playback fallback, useful final codec/source errors, and sanitized
  provider failures.

## 2026-06-14 - Production Operations Dashboard

- Replaced the one-page anchor sidebar with five real tabbed workspaces: command center, audience,
  reliability, support, and catalog.
- Added threshold-based operational alerts and a reliability score so operators can see what needs
  attention before reading individual metrics.
- Replaced decorative charts with a selectable 14-day time series, explicit engagement ratios,
  playback-error rates, ticket workflow/category charts, catalog coverage, and shard distribution.
- Added unique-session, media-type, top-path, playback-error, support-aging, and category backlog
  queries while keeping analytics reads bounded to the latest 14 days.
- Kept the existing ticket workspace, bulk actions, pagination, audit history, readiness links, and
  production rights gates.

## 2026-06-14 - Admin And Series Download Completion

- Added real admin ticket pagination, multi-select bulk status workflows, immutable workflow audit
  events with affected ticket IDs/status, and operator-visible audit history.
- Expanded live operations diagnostics with shard/detail coverage, stale page and sync failure
  counts, rate-limit activity, migration state, analytics recency, and support aging/resolution
  signals.
- Added recent catalog-sync history and made catalog counts/popularity aggregate across configured
  shards.
- Completed the series download queue with episode labels, deterministic audio/nearest-quality
  selection, safe descriptive filenames, cancellation, failed-download retry, unavailable-source
  retry, and detailed per-episode progress/errors.
- Kept downloads rights-gated and provider-to-browser; the application does not proxy media files.
- Added migration `006_admin_audit.sql` and focused validation/helper tests.
- Replaced the root `styles.css?url` link with a side-effect stylesheet import to prevent a Vite 8
  client/server asset-hash mismatch from shipping a production CSS 404.

## 2026-06-14 - Full Product And Engineering Audit

### Checked

Repository structure, public and operator routes, server functions, environment handling, security
headers, rate limiting, request limits, catalog/database resilience, migrations, operations scripts,
CI/release workflows, test coverage, design consistency, accessibility, performance, and SEO.

### Verified Findings

- Critical: source-exposed TMDB API key and open subtitle SSRF proxy.
- Critical: series download route imports a nonexistent component and updates state during render.
- High: download preparation failures are silent and filenames can use the wrong episode number.
- High: admin password persists in browser storage and system action buttons are simulated.
- Medium: shared custom select lacks complete keyboard/listbox semantics.
- Medium: title SEO, dialog focus management, and browser test coverage are incomplete.
- High: development ignored the external-stream rights flags, and production accepted weak configured
  admin passwords.

### Planned Implementation

Remove exposed credential use, harden stream helper inputs and subtitle fetching, repair the download
route, make operational UI honest, stop persisting the admin password, improve shared selector
semantics, add focused tests, and run the available release gate.

### Implemented

- Replaced the hard-coded TMDB external-id request with the server-configured TMDB cache client.
- Added stream rate limits, strict skip/caption validation, and bounded public-network-only subtitle
  proxying.
- Rebuilt the TV download route to compile cleanly, avoid render-time state updates and duplicate
  resolution, show failures, preserve actual episode numbers, and abort failed writes.
- Removed simulated admin actions and stopped persisting the admin password in browser storage.
- Replaced the incomplete custom select behavior with a native accessible select.
- Restored accessible names for the mobile Movies/Series controls and labeled the media-type group.
- Required both external-stream and distribution-rights flags in development as well as production.
- Added production validation that rejects configured admin passwords shorter than 16 characters.
- Added bounded streaming reads before buffering upstream TMDB/provider JSON and images.
- Removed unused mobile/class-name helpers and a root-level provider debug script.
- Moved subtitle DNS/private-network checks behind a server-only module boundary.
- Upgraded Vite and its React plugin to resolve the high-severity esbuild audit finding, then removed
  the obsolete tsconfig-paths plugin in favor of Vite's native support.

## 2026-06-14 - UX, Missing Features, And Performance Follow-Up

### Implemented

- Removed adjacent focus shadows that made inputs/selects look double-bordered and standardized
  separated focus outlines.
- Made sort controls available on mobile and kept primary episode watch actions visible.
- Added persisted autoplay-video, autoplay-next with a cancelable countdown, playback-speed controls,
  and a direct next-episode action.
- Made playback preference hydration deterministic, then restored persisted preferences after mount
  so toggles remain interactive and no longer produce server/client attribute mismatches.
- Prevented player shortcuts from hijacking focused controls and kept controls visible during
  keyboard interaction.
- Replaced static dashboard status with real diagnostics, ticket filters/status updates, and CSV
  export.
- Debounced search/autocomplete, stabilized virtualized catalog cards, lazy-decoded list imagery,
  bounded in-memory TMDB caching, deduplicated background refreshes, and used indexed fuzzy search.
- Returned stale catalog/detail data immediately while refreshing, reduced analytics dashboard scan
  scope, and prevented download selection races while preparation/download is active.
- Removed the unrelated animated catalog companion and approximately 3 MB of unused public assets.

### Verification

- Typecheck, 37 tests, workflow validation, production build, 10-check production smoke, and Neon
  database verification passed.
- Fresh browser verification produced no new console errors after the hydration fix.
- Production client output is approximately 1.1 MB, down from approximately 5.1 MB before cleanup;
  HLS remains a 509 KB minified on-demand chunk.
- Lint has no errors and retains 57 Fast Refresh code-organization warnings.

### Remaining Product Work

- Add a visible continue-watching/watchlist experience with a deliberate local/cloud sync model.
- Add profiles/accounts only with identity, privacy, recovery, and authorization requirements.
- Replace password-only admin access with authenticated sessions and audit logs.
- Complete title-specific server metadata, canonical URLs, structured data, and dynamic sitemap.

## 2026-06-14 - Brand And Artwork Fallback Pass

- Replaced the glossy circular play logo with a simpler rounded-square abstract lens/play mark
  without a letterform.
- Made the homepage navigation and footer wordmark-only with a metallic text treatment.
- Added an opaque maskable app icon and dedicated Apple touch icon asset.
- Replaced brand-logo misuse in cast, poster, player, trailer, playback, title, and download
  contexts with person or media-specific visuals.
- Added crop-safe person silhouettes for missing cast photos, including image-load failures.
- Reduced title-detail latency with one stale/fresh database read, bounded hot-detail caching,
  poster hover/focus prefetching, and removal of migration validation from the request hot path.
- Added optional deterministic catalog sharding across Neon databases, parallel shard search and
  similar-title reads, sharded refresh/migration/verification tooling, one-query catalog page
  reads, a bounded keyset reshard backfill command, minimal card payloads, and bounded hot
  page/genre caches.
- Removed remote shared-rate-limit writes from the untrusted-proxy global circuit-breaker path and
  added intent route preloading for faster catalog-to-detail navigation.

## 2026-06-14 - Series Download Folder Repair

- Split folder selection from queue start, kept the selected root folder visible across seasons,
  and created a clearly named season folder only when a queue starts.
- Added early browser capability guidance, secure-context messaging, permission rechecks, estimated
  queue size, clearer queue progress, and actionable provider/CORS failure messages.
- Added a one-file-per-click direct-download fallback and explicit per-episode download actions for
  browsers or providers that cannot stream files into a selected folder.
- Throttled streamed-file progress updates so large episodes do not trigger thousands of React
  renders while writing to disk.
- Added focused tests for folder capability detection, download size summaries, and blocked-provider
  error handling.
