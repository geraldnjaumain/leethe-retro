import { createFileRoute } from "@tanstack/react-router";
import { log, serializeError } from "@/lib/logger.server";
import { assertPublicHttpsUrl } from "@/lib/public-url.server";
import { rateLimitResponse } from "@/lib/rate-limit.server";
import {
  createSportsStreamProxyUrl,
  validateSportsStreamProxyRequest,
} from "@/lib/sports-stream.server";
import { readBoundedText } from "@/lib/upstream-response.server";

const MAX_PLAYLIST_BYTES = 2_000_000;
const SPORTS_STREAM_TIMEOUT_MS = 15_000;

export const Route = createFileRoute("/api/sports-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await rateLimitResponse(request, "sports-stream", 30);
        if (limited) return limited;
        const params = new URL(request.url).searchParams;
        const url = validateSportsStreamProxyRequest(params.get("url"), params.get("sig"));
        if (!url) return new Response("Invalid stream request", { status: 403 });

        try {
          const safeUrl = await assertPublicHttpsUrl(url);
          const range = request.headers.get("range");
          const response = await fetch(safeUrl, {
            headers: {
              Referer: "https://thesports.today/",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              ...(range ? { Range: range } : {}),
            },
            redirect: "error",
            signal: AbortSignal.timeout(SPORTS_STREAM_TIMEOUT_MS),
          });

          if (!response.ok) {
            return new Response(`Upstream error: ${response.status}`, { status: response.status });
          }

          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("mpegurl") || url.includes(".m3u8")) {
            const text = await readBoundedText(response, MAX_PLAYLIST_BYTES);
            const baseUrl = safeUrl;

            const rewritten = text
              .split("\n")
              .map((line) => {
                if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-MEDIA:")) {
                  return line.replace(/URI="([^"]+)"/, (match, uri) => {
                    const absoluteUrl = new URL(uri, baseUrl).toString();
                    const proxyUrl = createSportsStreamProxyUrl(absoluteUrl);
                    return proxyUrl ? `URI="${proxyUrl}"` : match;
                  });
                }
                if (line.trim() === "" || line.startsWith("#")) return line;
                const absoluteUrl = new URL(line, baseUrl).toString();
                return createSportsStreamProxyUrl(absoluteUrl) || line;
              })
              .join("\n");

            return new Response(rewritten, {
              headers: {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
              },
            });
          }

          const headers = new Headers({
            "Content-Type": contentType || "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          });
          for (const name of ["accept-ranges", "content-length", "content-range"]) {
            const value = response.headers.get(name);
            if (value) headers.set(name, value);
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        } catch (error) {
          const invalidDestination =
            error instanceof Error && error.message === "Invalid public HTTPS destination.";
          let destination = "invalid";
          try {
            destination = new URL(url).hostname;
          } catch {
            // Keep the safe fallback.
          }
          log("warn", "sports_stream_proxy_failed", {
            destination,
            error: serializeError(error),
          });
          return new Response(invalidDestination ? "Invalid destination" : "Proxy error", {
            status: invalidDestination ? 400 : 502,
          });
        }
      },
    },
  },
});
