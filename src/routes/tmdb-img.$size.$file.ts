import { createFileRoute } from "@tanstack/react-router";
import { serveCachedTmdbImage } from "@/lib/tmdb-cache.server";

export const Route = createFileRoute("/tmdb-img/$size/$file")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await serveCachedTmdbImage(request)) ??
        new Response("TMDB image route not found.", { status: 404 }),
    },
  },
});
