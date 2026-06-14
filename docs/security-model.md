# Security Model

## Trust Boundaries

Public browser input is untrusted. TMDB, stream providers, caption providers, and IntroDB are
untrusted upstreams. `DATABASE_URL`, admin credentials, TMDB credentials, and provider signing keys
are server-only.

## Controls

- CSRF middleware on server functions.
- Boundary validation and request-body limits.
- Shared production rate limiting with a trusted-proxy contract.
- Least-privileged application database role and migrations.
- Security headers, no-store dynamic responses, structured server logging, and secret-safe errors.
- Rights gate for the external stream resolver in every environment.
- Signed, rate-limited, public-network-only sports playlist/segment proxy requests.
- Production validation rejects configured admin passwords shorter than 16 characters.
- Provider URL cleaning and response size/time limits.

## Critical Audit Findings

- A TMDB API key was hard-coded in `src/lib/stream.ts`; remove it and use server environment
  credentials through the TMDB client. Rotate/revoke the exposed key outside this repository.
- The subtitle proxy accepted arbitrary HTTP URLs, creating an SSRF surface. Restrict it to HTTPS
  public-network destinations with time and size limits.
- The admin password was persisted in `sessionStorage`. Do not persist administrative credentials
  in browser storage; production should additionally place `/admin` behind an identity proxy.
- Fake admin actions claimed success without authorization or backend work. Remove them.

## Remaining Risks

- The CSP permits inline scripts/styles and broad HTTPS media/connect sources for the current SSR and
  external playback architecture.
- DNS rebinding cannot be fully eliminated by hostname checks alone; platform egress controls are
  recommended for the subtitle proxy.
- Password-only admin access is weaker than identity-based authentication and audited sessions.
- Distribution rights and upstream provider authorization require non-technical review.
