import { createServerFn } from "@tanstack/react-start";
import {
  adminRateLimitMiddleware,
  analyticsRateLimitMiddleware,
  supportRateLimitMiddleware,
} from "./rate-limit";
import type {
  AdminDashboard,
  ProductEventInput,
  ProductEventName,
  SupportCategory,
  TicketStatus,
} from "./product-data.server";

const EVENT_NAMES = new Set<ProductEventName>([
  "page_view",
  "playback_start",
  "playback_error",
  "download",
  "support_submitted",
]);
const SUPPORT_CATEGORIES = new Set<SupportCategory>([
  "playback",
  "subtitles",
  "audio",
  "downloads",
  "catalog",
  "legal",
  "other",
]);
const TICKET_STATUSES = new Set<TicketStatus>(["open", "in_progress", "resolved"]);

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveInt(value: unknown, maximum = 2_147_483_647) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : undefined;
}

function mediaType(value: unknown): "movie" | "tv" | undefined {
  return value === "movie" || value === "tv" ? value : undefined;
}

export function validateSupportTicketInput(raw: unknown) {
  const value = record(raw);
  const category = cleanText(value.category, 32) as SupportCategory;
  const message = cleanText(value.message, 4_000);
  const email = cleanText(value.email, 254);
  if (!SUPPORT_CATEGORIES.has(category)) throw new Error("Choose a valid support category.");
  if (message.length < 12) throw new Error("Describe the issue in at least 12 characters.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address or leave it blank.");
  }
  return {
    category,
    message,
    email: email || undefined,
    path: cleanText(value.path, 240) || undefined,
    mediaType: mediaType(value.mediaType),
    tmdbId: positiveInt(value.tmdbId),
    season: positiveInt(value.season, 999),
    episode: positiveInt(value.episode, 10_000),
  };
}

export function validateProductEventInput(raw: unknown): ProductEventInput {
  const value = record(raw);
  const eventName = cleanText(value.eventName, 40) as ProductEventName;
  if (!EVENT_NAMES.has(eventName)) throw new Error("Invalid product event.");
  return {
    eventName,
    sessionId: cleanText(value.sessionId, 80) || undefined,
    path: cleanText(value.path, 240) || undefined,
    mediaType: mediaType(value.mediaType),
    tmdbId: positiveInt(value.tmdbId),
    season: positiveInt(value.season, 999),
    episode: positiveInt(value.episode, 10_000),
  };
}

export const submitSupportTicket = createServerFn({ method: "POST" })
  .middleware([supportRateLimitMiddleware])
  .inputValidator(validateSupportTicketInput)
  .handler(async ({ data }) => {
    const { createSupportTicket, recordProductEvent } = await import("./product-data.server");
    const ticketId = await createSupportTicket(data);
    await recordProductEvent({
      eventName: "support_submitted",
      path: data.path,
      mediaType: data.mediaType,
      tmdbId: data.tmdbId,
      season: data.season,
      episode: data.episode,
    }).catch(() => false);
    return { ticketId };
  });

export const trackProductEvent = createServerFn({ method: "POST" })
  .middleware([analyticsRateLimitMiddleware])
  .inputValidator(validateProductEventInput)
  .handler(async ({ data }) => {
    const { recordProductEvent } = await import("./product-data.server");
    return { accepted: await recordProductEvent(data) };
  });

function validateAdminInput(raw: unknown) {
  const value = record(raw);
  const password = cleanText(value.password, 300);
  const ticketOffset = Math.max(
    0,
    Math.min(Number.parseInt(String(value.ticketOffset ?? "0"), 10) || 0, 100_000),
  );
  if (!password) throw new Error("Admin password is required.");
  return { password, ticketOffset };
}

export function validateTicketUpdateInput(raw: unknown) {
  const value = record(raw);
  const password = cleanText(value.password, 300);
  const id = cleanText(value.id, 40);
  const status = cleanText(value.status, 32) as TicketStatus;
  if (!password || !id || !TICKET_STATUSES.has(status)) throw new Error("Invalid ticket update.");
  return { password, id, status };
}

export function validateBulkTicketUpdateInput(raw: unknown) {
  const value = record(raw);
  const password = cleanText(value.password, 300);
  const status = cleanText(value.status, 32) as TicketStatus;
  const ids = [
    ...new Set(
      (Array.isArray(value.ids) ? value.ids : [])
        .slice(0, 100)
        .map((id) => cleanText(id, 40))
        .filter((id) => /^TKT-[A-Z0-9]{1,32}$/.test(id)),
    ),
  ];
  if (!password || !ids.length || !TICKET_STATUSES.has(status)) {
    throw new Error("Invalid bulk ticket update.");
  }
  return { password, ids, status };
}

export const getAdminDashboard = createServerFn({ method: "POST" })
  .middleware([adminRateLimitMiddleware])
  .inputValidator(validateAdminInput)
  .handler(async ({ data }): Promise<AdminDashboard> => {
    const { assertAdminPassword, readAdminDashboard } = await import("./product-data.server");
    assertAdminPassword(data.password);
    return readAdminDashboard(data.ticketOffset);
  });

export const updateSupportTicketStatus = createServerFn({ method: "POST" })
  .middleware([adminRateLimitMiddleware])
  .inputValidator(validateTicketUpdateInput)
  .handler(async ({ data }) => {
    const { assertAdminPassword, setSupportTicketStatus } = await import("./product-data.server");
    assertAdminPassword(data.password);
    await setSupportTicketStatus(data.id, data.status);
    return { updated: true };
  });

export const updateSupportTicketsStatus = createServerFn({ method: "POST" })
  .middleware([adminRateLimitMiddleware])
  .inputValidator(validateBulkTicketUpdateInput)
  .handler(async ({ data }) => {
    const { assertAdminPassword, setSupportTicketsStatus } = await import("./product-data.server");
    assertAdminPassword(data.password);
    return { updated: await setSupportTicketsStatus(data.ids, data.status) };
  });

export type { AdminDashboard, ProductEventName, SupportCategory, TicketStatus };
