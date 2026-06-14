import { assertPublicHttpsUrl } from "./public-url.server";
import { readBoundedText } from "./upstream-response.server";

const MAX_SUBTITLE_BYTES = 2_000_000;
const SUBTITLE_TIMEOUT_MS = 8_000;

export async function fetchSubtitleText(url: string) {
  await assertPublicHttpsUrl(url);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(SUBTITLE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Subtitle request failed.");
  return readBoundedText(response, MAX_SUBTITLE_BYTES);
}
