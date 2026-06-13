import { trackProductEvent, type ProductEventName } from "./product";
import type { MediaType } from "./tmdb";

type EventContext = {
  path?: string;
  mediaType?: MediaType;
  tmdbId?: string | number;
  season?: number;
  episode?: number;
};

function sessionId() {
  if (typeof window === "undefined") return undefined;
  const key = "leethe:analytics-session";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = window.crypto.randomUUID();
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return undefined;
  }
}

export function recordClientEvent(eventName: ProductEventName, context: EventContext = {}) {
  if (typeof window === "undefined") return;
  void trackProductEvent({
    data: {
      eventName,
      sessionId: sessionId(),
      path: context.path ?? window.location.pathname,
      mediaType: context.mediaType,
      tmdbId: context.tmdbId ? Number(context.tmdbId) : undefined,
      season: context.season,
      episode: context.episode,
    },
  }).catch(() => undefined);
}
