import { describe, expect, it } from "vitest";
import {
  audioKey,
  downloadFileName,
  findPreferredStreamIndex,
  isDirectDownload,
  normalizeCaptionCandidates,
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
  });
});
