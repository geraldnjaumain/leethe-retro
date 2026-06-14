import { createHmac, timingSafeEqual } from "node:crypto";
import { envValue } from "./env.server";
import { sportsMediaUrl } from "./sports-data";

function proxySecret() {
  return envValue("SPORTS_STREAM_PROXY_SECRET") || envValue("MOVIEBOX_SECRET_KEY_DEFAULT");
}

function signature(url: string) {
  const secret = proxySecret();
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(url).digest("hex");
}

export function createSportsStreamProxyUrl(value: unknown, requireMediaHint = false) {
  const url = sportsMediaUrl(value, requireMediaHint);
  if (!url) return undefined;
  const sig = signature(url);
  if (!sig) return undefined;
  return `/api/sports-stream?url=${encodeURIComponent(url)}&sig=${sig}`;
}

export function validateSportsStreamProxyRequest(value: unknown, suppliedSignature: unknown) {
  const url = sportsMediaUrl(value, false);
  if (!url || typeof suppliedSignature !== "string" || !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    return undefined;
  }
  const expected = signature(url);
  if (!expected) return undefined;
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(suppliedSignature, "hex");
  return timingSafeEqual(expectedBytes, suppliedBytes) ? url : undefined;
}
