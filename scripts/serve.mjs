import { serve } from "srvx/node";
import { serveStatic } from "srvx/static";

const { default: app } = await import("../dist/server/server.js");
const staticHandler = serveStatic({ dir: "dist/client" });

const staticWithHeaders = async (request, next) => {
  const response = await staticHandler(request, next);
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/assets/") && path !== "/favicon.svg" && path !== "/site.webmanifest") {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(
    "cache-control",
    path.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=86400, stale-while-revalidate=604800",
  );
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  if (process.env.NODE_ENV === "production") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const server = serve({
  fetch: app.fetch.bind(app),
  middleware: [staticWithHeaders],
  gracefulShutdown: true,
  port: process.env.PORT || 3000,
  hostname: process.env.HOST,
  error(error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "runtime_error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response("Internal server error.", { status: 500 });
  },
});

await server.ready();
console.log(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "server_started",
    port: server.port,
  }),
);
