import { createMiddleware } from "@tanstack/react-start";

function createRateLimitMiddleware(scope: string, limit: number) {
  return createMiddleware().server(async ({ request, next }) => {
    const { rateLimitResponse } = await import("./rate-limit.server");
    return (await rateLimitResponse(request, scope, limit)) ?? next();
  });
}

export const catalogRateLimitMiddleware = createRateLimitMiddleware("catalog", 120);
export const upstreamRateLimitMiddleware = createRateLimitMiddleware("upstream", 60);
export const streamRateLimitMiddleware = createRateLimitMiddleware("stream", 10);
export const supportRateLimitMiddleware = createRateLimitMiddleware("support", 5);
export const analyticsRateLimitMiddleware = createRateLimitMiddleware("analytics", 180);
export const adminRateLimitMiddleware = createRateLimitMiddleware("admin", 30);
