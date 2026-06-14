# Missing Features And UX Audit

## Implemented In This Audit

- Real operations diagnostics, ticket filtering/status workflow, and CSV export.
- Admin ticket pagination, bulk workflows, workflow audit history, shard-aware metrics, and catalog
  sync history.
- Series download cancellation/retry, nearest-quality and audio selection, descriptive filenames,
  per-episode unavailable reasons, and direct-link fallback.
- User-visible autoplay-video, autoplay-next, next-episode countdown/cancel, and playback speed.
- Consistent single-border form styling and separated keyboard focus outlines.
- Mobile sort controls, visible episode watch actions, safer player keyboard behavior, and focused
  dialog actions.
- Database-first stale-while-revalidate reads, debounced search, indexed fuzzy search, bounded
  process cache, lazy list images, reduced-motion coverage, and removal of unused heavy assets.
- Deterministic playback-preference hydration so persisted settings no longer create a React
  mismatch or leave controls visually stuck.

## Priority Product Gaps

1. **Continue watching and watchlist:** playback progress exists locally, but there is no catalog
   surface to resume or save titles. Define local-only versus account sync before implementation.
2. **Profiles and identity:** needed for cross-device progress, preferences, watchlists, and real
   operator authorization. Requires privacy, recovery, session, and authorization design.
3. **Provider reliability:** actual MP4/HLS, caption, autoplay-next, skip-marker, and download flows
   cannot be launch-certified until a rights-approved resolver is enabled and tested.
4. **Title SEO:** public title pages still need server-rendered title-specific metadata, canonical
   URLs, structured data, and dynamic sitemap entries.
5. **Operator security:** workflow changes now have audit history, but password-only access should
   become identity-backed sessions with attributable operator identities before multiple operators
   use the dashboard.

## UX Risks To Validate

- Small desktop typography contrast and readability at 200% zoom.
- Player controls on the narrowest supported mobile widths.
- Large season/episode lists, long titles, missing artwork, and partial metadata.
- Browser differences for direct downloads and folder access.

## Performance Follow-Up

- Put `/tmdb-img/*` behind a CDN and measure production Core Web Vitals.
- Load-test database reads, analytics writes, and shared rate limits behind the real trusted proxy.
- Keep HLS as an on-demand chunk; replace it only after compatibility testing proves a smaller
  runtime is reliable.
- Split route helpers from route component modules to clear the remaining 57 Fast Refresh warnings.
