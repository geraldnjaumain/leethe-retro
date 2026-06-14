# QA Checklist

## Release Gate

- [x] Lint
- [x] Typecheck
- [x] Unit/integration tests
- [x] Workflow validation
- [x] Production build
- [x] Production smoke test with required environment/database
- [x] Browser smoke test

## Verified 2026-06-14

- Neon app/admin roles, 6 migrations, 12 tables, least-privilege permissions, and 582-title catalog.
- Cached catalog, title detail, TV seasons, legal contact, admin dashboard, and disabled resolver UI.
- Reversible support submission persisted successfully and its test record was removed afterward.
- Desktop and mobile accessibility-tree smoke checks completed without new browser console errors
  after the playback-preference hydration fix.
- Playback preference toggles remain interactive and persisted values restore after reload.
- Production smoke passed 10 checks; production build output is approximately 1.1 MB.
- Movie and series resolver checks return playable source lists after the provider page-limit fix.
- Sports center browser smoke verified normalized matches/news, no duplicate live fixture, filters,
  and dedicated player launch.
- Series download browser smoke verified early folder capability guidance, explicit folder selection,
  queue summary, and the one-file-per-click fallback.
- Supplied TMDB token rejected by TMDB with status code 7; replace it before catalog refreshes.
- Supplied admin password is below the production minimum; replace it with a unique 16+ character
  secret before launch.

## Functional

- [ ] Catalog: movie/TV, all sorts, genre, search, pagination, empty and failed upstream.
- [ ] Title: movie/TV, missing artwork, collection, seasons, similar, trailer close/keyboard.
- [ ] Watch: disabled resolver, direct MP4, HLS, captions, skip markers, errors, next episode.
- [ ] Sports: partial upstream failure, duplicate feeds, filters, score refresh, signed HLS/MP4,
      player failure, close/keyboard, and unsigned proxy rejection.
- [ ] Download: non-season-one show, select all, prepare failure, unavailable source, quality/audio,
      folder unsupported, cancel, partial failure, correct episode filename.
- [ ] Support: valid/invalid email, short/long message, success, database failure, rate limit.
- [ ] Admin: invalid password, refresh, empty data, ticket update failure, bulk update, pagination,
      audit history, and lock.
- [ ] Admin: ticket search/status/category filters, CSV export, shard-aware catalog data, and live
      diagnostics.
- [ ] Admin: command/audience/reliability/support/catalog tab switching, alert routing, chart metric
      switching, top paths, support aging, and empty analytics states.
- [ ] Health, robots, sitemap, image proxy, 404, and catastrophic SSR error.

## Quality Matrix

- [ ] Desktop, tablet, mobile, Chromium, Firefox, and Safari.
- [ ] Keyboard only, screen reader basics, 200% zoom, reduced motion, and contrast.
- [ ] Slow network, failed network, partial data, many records, long text, and empty data.
- [ ] Unauthenticated/unauthorized behavior, request limits, SSRF attempts, and secret scan.
- [ ] Autoplay-video, autoplay-next countdown/cancel, playback speed persistence, and focused-control
      keyboard behavior with rights-approved streams.
