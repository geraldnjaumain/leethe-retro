# Page Map

| Route                   | Purpose                      | Data                                            | States                                              | Permission                                        |
| ----------------------- | ---------------------------- | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| `/`                     | Discover/search catalog      | Genres and catalog pages                        | Skeleton, empty, retry, end                         | Public                                            |
| `/title/:type/:id`      | Title detail                 | Detail, collection, season, similar             | Skeleton, retry, unavailable                        | Public                                            |
| `/watch/:type/:id`      | Playback                     | Detail, stream, captions, skip markers          | Restore, resolving, unavailable, playback error     | Public; resolver rights-gated                     |
| `/sports`               | Sports center                | Scores, schedules, playable streams, news       | Loading, partial sources, retry, empty, live player | Public, upstream rate-limited                     |
| `/download/tv/:id`      | Prepare TV episode downloads | Detail, season, direct stream options           | Loading, prepare error, no direct source, progress  | Public; resolver rights-gated                     |
| `/support`              | Submit report                | Support ticket write                            | Validation, submitting, success, error              | Public, rate-limited                              |
| `/legal`                | Terms/privacy/takedown       | Public legal contact                            | Rendered content                                    | Public                                            |
| `/admin`                | Production operations        | Alerts, audience, reliability, support, catalog | Locked, loading, tabbed workspaces, empty states    | Operator password plus recommended identity proxy |
| `/healthz`              | Liveness                     | Runtime                                         | OK                                                  | Public operations                                 |
| `/readyz`               | Readiness                    | Env and database                                | Ready/degraded/strict failure                       | Public operations                                 |
| `/robots.txt`           | Crawler policy               | Site origin                                     | Text                                                | Public                                            |
| `/sitemap.xml`          | Static route sitemap         | Site origin                                     | XML                                                 | Public                                            |
| `/tmdb-img/:size/:file` | Image proxy/cache            | TMDB image                                      | Image, invalid, upstream failure                    | Public                                            |
| `/api/sports-stream`    | Signed sports media delivery | HLS playlists, segments, keys, direct MP4       | Media, upstream failure, invalid signature          | Public; signed and rate-limited                   |
