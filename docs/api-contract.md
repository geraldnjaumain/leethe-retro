# API Contract

TanStack server functions are POST unless noted. All inputs are validated at the server boundary
and all server functions receive CSRF middleware.

| Function / Route     | Purpose                                   | Auth              | Validation / Limits                                                                     | Cache / Exposure                                         |
| -------------------- | ----------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Catalog request      | Genres, discover, search, detail, similar | Public            | Type/action/id/page/query allowlist; catalog rate limit                                 | Browser callable; database/TMDB cache                    |
| Direct TMDB request  | Collection and TV season                  | Public            | Path and params allowlist; upstream rate limit                                          | Browser callable; persistent selected payload cache      |
| Stream resolver      | Resolve playback options                  | Public            | Bounded title/id/year/season/episode; stream rate limit; production rights gate         | Browser callable; private provider keys stay server-side |
| Episode downloads    | Resolve direct TV files                   | Public            | Up to 60 valid labeled episodes; stream rate limit; rights gate                         | Browser callable; files stream provider-to-browser       |
| Stream captions      | Resolve caption metadata                  | Public            | Bounded provider identifiers; stream rate limit; rights gate                            | Browser callable                                         |
| Subtitle proxy       | Fetch external caption text               | Public            | HTTPS URL, public-network destination, response size/type/time limit; stream rate limit | Browser callable, no cache                               |
| Skip segments        | Resolve intro/credits                     | Public            | Valid TMDB id/type/season/episode; stream rate limit                                    | Browser callable; TMDB credential server-only            |
| Support submit       | Create support ticket                     | Public            | Category, optional email, 12-4000 character message; support rate limit                 | Browser callable, private write                          |
| Product event        | Aggregate product telemetry               | Public            | Event allowlist and bounded context; analytics rate limit                               | Browser callable; disabled unless configured             |
| Admin dashboard      | Read operations data                      | Operator password | Bounded password/ticket offset; admin rate limit                                        | Browser callable private read                            |
| Ticket status update | Update support workflow                   | Operator password | Ticket id/status allowlist; admin rate limit                                            | Browser callable private write                           |
| Bulk ticket update   | Update up to 100 support tickets          | Operator password | Ticket id/status allowlist; deduplication; admin rate limit                             | Browser callable private write with audit event          |
| `/healthz` GET       | Liveness                                  | Public            | Dedicated path                                                                          | No-store                                                 |
| `/readyz` GET        | Env/database readiness                    | Public            | Optional `strict=1`                                                                     | No-store                                                 |

Errors must not include secrets, internal URLs, stack traces, or raw upstream bodies.
