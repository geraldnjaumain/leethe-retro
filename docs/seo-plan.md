# SEO Plan

## Existing

- Root and page descriptions, Open Graph/Twitter baseline, manifest, robots route, and sitemap route.
- Watch and admin routes are disallowed in robots.
- Public content is server rendered.

## Gaps

- Title pages set their final title only on the client and lack title-specific server-rendered
  descriptions, canonical URLs, Open Graph images, and structured data.
- The sitemap contains only static catalog/filter/support routes and omits title pages and legal.
- Canonical URLs are not emitted.

## Plan

1. Add server-loaded title metadata and canonical URLs.
2. Generate a bounded dynamic sitemap from persisted popular/current titles.
3. Add `Movie` / `TVSeries` structured data only after validating the available fields.
4. Keep watch, download, admin, health, image, and server-function routes out of search.
