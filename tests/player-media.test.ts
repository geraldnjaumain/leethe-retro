import { describe, expect, it } from "vitest";
import {
  audioKey,
  downloadFileName,
  episodeDownloadFileName,
  findPreferredStreamIndex,
  isDirectDownload,
  nextEpisodeTarget,
  normalizePlaybackPreferences,
  normalizeCaptionCandidates,
  selectPreferredDownloadOption,
  srtToVtt,
} from "../src/lib/player-media";

describe("player media helpers", () => {
  it("normalizes provider subtitle payloads and rejects unsafe URLs", () => {
    expect(
      normalizeCaptionCandidates([
        { file: "https://cdn.example.com/en.srt", language: "English", langCode: "en" },
        { resourceLink: "//cdn.example.com/fr.vtt", lanName: "French", lanCode: "fr" },
        { url: "javascript:alert(1)", label: "Unsafe" },
      ]),
    ).toEqual([
      expect.objectContaining({
        label: "English",
        lang: "en",
        url: "https://cdn.example.com/en.srt",
      }),
      expect.objectContaining({
        label: "French",
        lang: "fr",
        url: "https://cdn.example.com/fr.vtt",
      }),
    ]);
  });

  it("converts SRT timestamps into browser-compatible WebVTT", () => {
    expect(srtToVtt("1\r\n00:00:01,000 --> 00:00:03,250\r\nHello\r\n")).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.250\nHello",
    );
  });

  it("keeps quality and dub preferences together when possible", () => {
    const streams = [
      { url: "https://cdn/720.mp4", resolution: 720, quality: "720p", audioLabel: "English" },
      { url: "https://cdn/1080-hi.mp4", resolution: 1080, quality: "1080p", audioLabel: "Hindi" },
      { url: "https://cdn/1080-en.mp4", resolution: 1080, quality: "1080p", audioLabel: "English" },
    ];
    expect(
      findPreferredStreamIndex(streams, {
        resolution: 1080,
        audioKey: audioKey(streams[2]),
        updatedAt: Date.now(),
      }),
    ).toBe(2);
  });

  it("exposes direct files as downloads but not HLS playlists", () => {
    expect(isDirectDownload("https://cdn.example.com/movie.mp4")).toBe(true);
    expect(isDirectDownload("https://cdn.example.com/master.m3u8?token=1")).toBe(false);
    expect(downloadFileName("Movie: Part II", "1080p")).toBe("Movie-Part-II-1080p.mp4");
    expect(episodeDownloadFileName("Series!", 1, 2, "A New Day", "1080p")).toBe(
      "Series-S01E02-A-New-Day-1080p.mp4",
    );
  });

  it("selects the requested audio and nearest available download quality", () => {
    const options = [
      { quality: "720p", resolution: 720, audioLabel: "English" },
      { quality: "1080p", resolution: 1080, audioLabel: "Hindi" },
      { quality: "2160p", resolution: 2160, audioLabel: "English" },
    ];
    expect(selectPreferredDownloadOption(options, "1080p", "English")).toEqual(options[0]);
    expect(selectPreferredDownloadOption(options, "1080p", "Hindi")).toEqual(options[1]);
    expect(selectPreferredDownloadOption(options, "1080p", "French")).toEqual(options[1]);
  });

  it("normalizes playback preferences and rejects unsupported rates", () => {
    expect(
      normalizePlaybackPreferences({
        autoplayVideo: false,
        autoplayNext: false,
        playbackRate: 1.5,
      }),
    ).toEqual({ autoplayVideo: false, autoplayNext: false, playbackRate: 1.5 });
    expect(normalizePlaybackPreferences({ playbackRate: 99 }).playbackRate).toBe(1);
  });

  it("selects the next episode and advances to the next season", () => {
    const seasons = [{ season_number: 1 }, { season_number: 2 }];
    expect(
      nextEpisodeTarget(1, 1, [{ episode_number: 1 }, { episode_number: 2 }], seasons),
    ).toEqual({ season: 1, episode: 2 });
    expect(
      nextEpisodeTarget(1, 2, [{ episode_number: 1 }, { episode_number: 2 }], seasons),
    ).toEqual({
      season: 2,
      episode: 1,
    });
  });
});
