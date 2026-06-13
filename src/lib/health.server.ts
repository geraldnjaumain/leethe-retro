import { checkCatalogDatabaseReadiness } from "./catalog-db.server";
import { validateProductionEnv } from "./env.server";
import { log, serializeError } from "./logger.server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export async function serveHealthCheck(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/healthz") {
    return json({ status: "ok", timestamp: new Date().toISOString() });
  }
  if (pathname !== "/readyz") return null;

  try {
    validateProductionEnv();
    await checkCatalogDatabaseReadiness();
    return json({ status: "ready", database: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    log("warn", "readiness_degraded", { error: serializeError(error) });
    return json(
      {
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      url.searchParams.get("strict") === "1" ? 503 : 200,
    );
  }
}
