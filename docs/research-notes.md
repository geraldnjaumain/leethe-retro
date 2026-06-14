# Research Notes

Mature catalog products make discovery fast, preserve the user's browsing context, provide useful
title detail, and keep playback controls subordinate to the content. Mature operations products
show trustworthy status and never present simulated actions as successful.

## Patterns To Keep

- Search, type, genre, and sort encoded in the URL.
- Clear catalog loading, empty, error, and end states.
- Title detail with collection, cast, seasons, episodes, and trailer.
- Local-only resume and playback preferences without requiring an account.
- Rights-gated playback and a public support route.
- Resilient cached catalog reads and operational health endpoints.

## Patterns To Avoid

- Fake operational controls or status.
- Browser-stored administrative credentials.
- Silent failures during preparation or download.
- Custom controls without complete keyboard and screen-reader behavior.
- Unrestricted server-side URL fetching.
- Promising direct downloads when the source is HLS-only or blocked by CORS.

## Maturity Opportunities

- Real operator authentication through a platform identity proxy or server session.
- Browser and accessibility regression tests for catalog, title, watch, download, support, and admin.
- Dynamic title sitemap entries and per-title server-rendered metadata.
- A documented rights and provider reliability review before enabling external streaming.
