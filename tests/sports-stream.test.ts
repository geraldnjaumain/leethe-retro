import { afterEach, describe, expect, it } from "vitest";
import {
  createSportsStreamProxyUrl,
  validateSportsStreamProxyRequest,
} from "../src/lib/sports-stream.server";

const previousSecret = process.env.SPORTS_STREAM_PROXY_SECRET;
const previousMovieBoxSecret = process.env.MOVIEBOX_SECRET_KEY_DEFAULT;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SPORTS_STREAM_PROXY_SECRET;
  else process.env.SPORTS_STREAM_PROXY_SECRET = previousSecret;
  if (previousMovieBoxSecret === undefined) delete process.env.MOVIEBOX_SECRET_KEY_DEFAULT;
  else process.env.MOVIEBOX_SECRET_KEY_DEFAULT = previousMovieBoxSecret;
});

describe("signed sports streams", () => {
  it("accepts generated URLs and rejects tampered destinations", () => {
    process.env.SPORTS_STREAM_PROXY_SECRET = "test-sports-stream-secret";
    const source = "https://cdn.example.com/live/master.m3u8?token=one";
    const proxy = createSportsStreamProxyUrl(source, true);
    expect(proxy).toContain("/api/sports-stream?");

    const params = new URL(proxy!, "https://leethe.example").searchParams;
    expect(validateSportsStreamProxyRequest(params.get("url"), params.get("sig"))).toBe(source);
    expect(
      validateSportsStreamProxyRequest(
        "https://cdn.example.com/private/file.ts",
        params.get("sig"),
      ),
    ).toBeUndefined();
  });

  it("rejects unsigned requests and non-media initial sources", () => {
    process.env.SPORTS_STREAM_PROXY_SECRET = "test-sports-stream-secret";
    expect(createSportsStreamProxyUrl("https://example.com/watch.html", true)).toBeUndefined();
    expect(
      validateSportsStreamProxyRequest("https://cdn.example.com/live.m3u8", undefined),
    ).toBeUndefined();
  });
});
