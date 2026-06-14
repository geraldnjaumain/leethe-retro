import { createServerFn } from "@tanstack/react-start";
import { upstreamRateLimitMiddleware } from "./rate-limit";
import type { SportsMatch, SportsNews } from "./sports-data";

export type { SportsMatch, SportsNews };

export const getSportsData = createServerFn({ method: "GET" })
  .middleware([upstreamRateLimitMiddleware])
  .handler(async () => {
    const { fetchSportsData } = await import("./sports-fetcher.server");
    return await fetchSportsData();
  });

export const getSportsNews = createServerFn({ method: "GET" })
  .middleware([upstreamRateLimitMiddleware])
  .handler(async () => {
    const { fetchSportsNews } = await import("./sports-fetcher.server");
    return await fetchSportsNews();
  });
