import { validateProductionEnv } from "./lib/env.server";
import { serveCachedTmdbImage } from "./lib/tmdb-cache.server";
import { renderErrorPage } from "./lib/error-page";
import { serveHealthCheck } from "./lib/health.server";
import { log, requestId, serializeError } from "./lib/logger.server";
import { enforceRequestBodyLimit } from "./lib/request-body.server";
import { applySecurityHeaders } from "./lib/security-headers.server";
import { serveSiteMetadata } from "./lib/site-metadata.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  log("error", "ssr_error_swallowed", { body: body.slice(0, 500) });
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const id = requestId(request);
    const startedAt = performance.now();
    let response: Response | undefined;
    try {
      const boundedRequest = await enforceRequestBodyLimit(request);
      if (boundedRequest instanceof Response) response = boundedRequest;
      else request = boundedRequest;

      const healthResponse = await serveHealthCheck(request);
      if (!response && healthResponse) response = healthResponse;

      if (!response) validateProductionEnv();

      const metadataResponse = serveSiteMetadata(request);
      if (!response && metadataResponse) response = metadataResponse;

      if (!response) {
        const imageResponse = await serveCachedTmdbImage(request);
        if (imageResponse) response = imageResponse;
      }

      if (!response) {
        const handler = await getServerEntry();
        response = await normalizeCatastrophicSsrResponse(await handler.fetch(request, env, ctx));
      }
    } catch (error) {
      log("error", "request_failed", { requestId: id, error: serializeError(error) });
      response = new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const secured = applySecurityHeaders(response, id);
    log("info", "request_complete", {
      requestId: id,
      method: request.method,
      path: new URL(request.url).pathname,
      status: secured.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return secured;
  },
};
