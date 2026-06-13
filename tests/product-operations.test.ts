import { afterEach, describe, expect, it } from "vitest";
import { assertAdminPassword } from "../src/lib/product-data.server";
import { validateProductEventInput, validateSupportTicketInput } from "../src/lib/product";
import { getMovieBoxProviderConfig } from "../src/lib/moviebox.server";

const originalEnv = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  MOVIEBOX_API_HOSTS: process.env.MOVIEBOX_API_HOSTS,
  MOVIEBOX_H5_API_HOST: process.env.MOVIEBOX_H5_API_HOST,
  MOVIEBOX_WEB_ORIGIN: process.env.MOVIEBOX_WEB_ORIGIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("product operations validation", () => {
  it("accepts a useful support report and rejects short messages", () => {
    expect(
      validateSupportTicketInput({
        category: "subtitles",
        message: "English captions are out of sync after ten minutes.",
        email: "viewer@example.com",
        mediaType: "tv",
        tmdbId: "123",
        season: "2",
        episode: "4",
      }),
    ).toMatchObject({
      category: "subtitles",
      mediaType: "tv",
      tmdbId: 123,
      season: 2,
      episode: 4,
    });
    expect(() => validateSupportTicketInput({ category: "other", message: "Too short" })).toThrow(
      "at least 12 characters",
    );
  });

  it("limits analytics events to the supported aggregate event names", () => {
    expect(validateProductEventInput({ eventName: "download", path: "/watch/movie/1" })).toEqual({
      eventName: "download",
      path: "/watch/movie/1",
      sessionId: undefined,
      mediaType: undefined,
      tmdbId: undefined,
      season: undefined,
      episode: undefined,
    });
    expect(() => validateProductEventInput({ eventName: "password_captured" })).toThrow(
      "Invalid product event",
    );
  });

  it("protects admin reads with the configured password", () => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    expect(() => assertAdminPassword("correct horse battery staple")).not.toThrow();
    expect(() => assertAdminPassword("wrong")).toThrow("Invalid admin password");
  });

  it("allows provider domains to change without a code edit", () => {
    process.env.MOVIEBOX_API_HOSTS = "https://one.example/path, https://two.example";
    process.env.MOVIEBOX_H5_API_HOST = "https://h5.example/api";
    process.env.MOVIEBOX_WEB_ORIGIN = "https://watch.example/anything";
    expect(getMovieBoxProviderConfig()).toEqual({
      apiHosts: ["https://one.example", "https://two.example"],
      h5ApiHost: "https://h5.example",
      webOrigin: "https://watch.example",
    });
  });
});
