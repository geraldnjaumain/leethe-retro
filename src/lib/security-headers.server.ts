import { isProduction } from "./env.server";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https: blob:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' data: https:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
].join("; ");

export function applySecurityHeaders(response: Response, id: string) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-request-id", id);

  if (isProduction()) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  const type = headers.get("content-type") ?? "";
  if (
    !headers.has("cache-control") &&
    (type.includes("text/html") || type.includes("application/json"))
  ) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
