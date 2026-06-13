import { createFileRoute } from "@tanstack/react-router";
import { renderRobotsTxt } from "@/lib/site-metadata.server";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => renderRobotsTxt(request),
    },
  },
});
