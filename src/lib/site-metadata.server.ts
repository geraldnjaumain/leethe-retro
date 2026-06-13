import { getServerConfig } from "./config.server";

function siteOrigin(request: Request) {
  const configured = getServerConfig().siteUrl;
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function routeUrl(origin: string, path: string) {
  return escapeXml(`${origin}${path}`);
}

export function renderRobotsTxt(request: Request) {
  const origin = siteOrigin(request);
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /watch/",
      "Disallow: /admin",
      "",
      `Sitemap: ${origin}/sitemap.xml`,
      "",
    ].join("\n"),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

export function renderSitemapXml(request: Request) {
  const origin = siteOrigin(request);
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    { path: "/", changefreq: "hourly", priority: "1.0" },
    { path: "/?type=movie", changefreq: "hourly", priority: "0.9" },
    { path: "/?type=tv", changefreq: "hourly", priority: "0.9" },
    { path: "/?type=movie&sort=new", changefreq: "hourly", priority: "0.8" },
    { path: "/?type=tv&sort=new", changefreq: "hourly", priority: "0.8" },
    { path: "/?type=movie&sort=rated", changefreq: "daily", priority: "0.7" },
    { path: "/?type=tv&sort=rated", changefreq: "daily", priority: "0.7" },
    { path: "/support", changefreq: "monthly", priority: "0.4" },
  ];
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${routeUrl(origin, entry.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
    {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

export function serveSiteMetadata(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/robots.txt") return renderRobotsTxt(request);
  if (pathname === "/sitemap.xml") return renderSitemapXml(request);
  return null;
}
