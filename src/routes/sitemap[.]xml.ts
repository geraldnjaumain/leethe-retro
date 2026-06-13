import { createFileRoute } from "@tanstack/react-router";
import { renderSitemapXml } from "@/lib/site-metadata.server";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => renderSitemapXml(request),
    },
  },
});
