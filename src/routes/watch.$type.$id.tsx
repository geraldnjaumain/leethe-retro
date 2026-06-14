import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { MediaGlyph, MediaPlaceholder } from "@/components/leethe/VisualAssets";
import { SelectMenu } from "@/components/leethe/SelectMenu";
import { StarGlyph } from "@/components/leethe/PosterCard";
import { recordClientEvent } from "@/lib/product-telemetry";
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  audioKey,
  downloadFileName,
  findPreferredStreamIndex,
  isDirectDownload,
  looksLikeSrt,
  nextEpisodeTarget,
  normalizePlaybackPreferences,
  normalizeCaptionCandidates,
  srtToVtt,
  type CaptionCandidate,
  type PlaybackPreferences,
} from "@/lib/player-media";
import {
  proxySubtitle,
  resolveEpisodeDownloads,
  resolveSkipSegments,
  resolveStreamCaptions,
  resolveWatchStreams,
  type ResolveEpisodeDownloadsInput,
  type ResolveWatchStreamsInput,
} from "@/lib/stream";
import {
  backdrop,
  fetchDetail,
  fetchSeason,
  poster,
  still,
  title as titleOf,
  year as yearOf,
  type MediaType,
} from "@/lib/tmdb";

type WatchSearch = {
  s?: number;
  e?: number;
};

const PLAYBACK_PREFERENCES_KEY = "leethe:playback-preferences";

type StreamLink = {
  url: string;
  resolution: number;
  quality: string;
  size?: number;
  codecName?: string;
  duration?: number;
  season?: number;
  episode?: number;
  title?: string;
  sourceName?: string;
  audioLabel?: string;
  languageCode?: string;
  resourceId?: string;
  extCaptions?: unknown[];
};

type EpisodeDownloadOption = {
  url: string;
  quality: string;
  resolution: number;
  audioLabel?: string;
  size?: number;
};

type StoredWatchMemory = {
  season: number;
  episode: number;
  updatedAt: number;
};

type StoredStreamPreference = {
  url?: string;
  resourceId?: string;
  resolution?: number;
  audioKey?: string;
  updatedAt: number;
};

type StoredProgress = {
  time: number;
  duration?: number;
  updatedAt: number;
};

type ResolvedCaptionTrack = CaptionCandidate & {
  src: string;
  objectUrl?: string;
};

type HlsLevel = {
  height?: number;
  bitrate?: number;
  name?: string;
};

type HlsAudioTrack = {
  id?: number;
  name?: string;
  lang?: string;
  language?: string;
};

type HlsSubtitleTrack = {
  id?: number;
  name?: string;
  lang?: string;
  language?: string;
};

type PlayerTrackOption = {
  value: string;
  label: string;
};

type HlsTrackOptions = {
  levels: PlayerTrackOption[];
  audioTracks: PlayerTrackOption[];
  subtitles: PlayerTrackOption[];
};

type HlsInstance = {
  loadSource: (src: string) => void;
  attachMedia: (video: HTMLVideoElement) => void;
  destroy: () => void;
  levels?: HlsLevel[];
  currentLevel?: number;
  audioTracks?: HlsAudioTrack[];
  audioTrack?: number;
  subtitleTracks?: HlsSubtitleTrack[];
  subtitleTrack?: number;
  on?: (event: string, callback: (event: string, data: unknown) => void) => void;
  off?: (event: string, callback: (event: string, data: unknown) => void) => void;
};

export const Route = createFileRoute("/watch/$type/$id")({
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    s: positiveInt(search.s),
    e: positiveInt(search.e),
  }),
  head: () => ({ meta: [{ title: "Leethe - Watch" }] }),
  component: WatchPage,
});

function positiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function canUseStorage() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function readJson<T>(key: string): T | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is opportunistic; playback should keep working without it.
  }
}

function watchMemoryKey(type: MediaType, id: string) {
  return `leethe:watch:${type}:${id}`;
}

function progressMemoryKey(type: MediaType, id: string, season?: number, episode?: number) {
  return type === "tv" && season && episode
    ? `leethe:progress:${type}:${id}:s${season}:e${episode}`
    : `leethe:progress:${type}:${id}`;
}

function streamPreferenceKey(progressKey: string) {
  return `${progressKey}:stream`;
}

function subtitlePreferenceKey(progressKey: string) {
  return `${progressKey}:subtitle`;
}

function rememberEpisode(type: MediaType, id: string, season: number, episode: number) {
  writeJson(watchMemoryKey(type, id), { season, episode, updatedAt: Date.now() });
}

function readRememberedEpisode(type: MediaType, id: string) {
  const saved = readJson<StoredWatchMemory>(watchMemoryKey(type, id));
  return saved?.season && saved?.episode ? saved : null;
}

function saveProgress(progressKey: string, video: HTMLVideoElement) {
  if (!Number.isFinite(video.currentTime) || video.currentTime <= 0) return;
  const duration = Number.isFinite(video.duration) ? video.duration : undefined;
  const nearEnd = duration ? video.currentTime >= Math.max(0, duration - 8) : false;
  writeJson(progressKey, {
    time: nearEnd ? 0 : Math.max(0, video.currentTime),
    duration,
    updatedAt: Date.now(),
  } satisfies StoredProgress);
}

function restoreProgress(progressKey: string, video: HTMLVideoElement) {
  const saved = readJson<StoredProgress>(progressKey);
  if (!saved?.time || saved.time < 5) return;
  const duration = Number.isFinite(video.duration) ? video.duration : undefined;
  if (duration && saved.time >= Math.max(0, duration - 10)) return;
  video.currentTime = saved.time;
}

function inferSourceType(url: string) {
  return /\.m3u8(?:[?#]|$)/i.test(url) ? "application/x-mpegURL" : "video/mp4";
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor(value / 60) % 60;
  const hours = Math.floor(value / 3600);
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function audioLabel(stream: StreamLink | undefined) {
  if (!stream) return "Default";
  return stream.audioLabel?.trim() || stream.languageCode?.trim().toUpperCase() || "Default";
}

function streamLabel(stream: StreamLink, index: number) {
  const quality = stream.quality || (stream.resolution ? `${stream.resolution}p` : "Auto");
  const audio = audioLabel(stream);
  const source = stream.sourceName ? ` - ${stream.sourceName}` : "";
  return `Server ${index + 1} - ${quality}${audio !== "Default" ? ` - ${audio}` : ""}${source}`;
}

export type SkipMarker = { type: "intro" | "credits"; start: number; end: number };

function useSkipMarkers(mediaType: MediaType, id: string, season?: number, episode?: number) {
  return useQuery<SkipMarker[]>({
    queryKey: ["skip-markers", mediaType, id, season, episode],
    queryFn: async () => {
      try {
        const segments = await resolveSkipSegments({
          data: { tmdbId: id, mediaType, season, episode },
        });
        return segments.map((s) => ({
          type: s.type as "intro" | "credits",
          start: s.start,
          end: s.end,
        }));
      } catch {
        return [];
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 60,
  });
}

function WatchPage() {
  const { type, id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const mediaType: MediaType = type === "tv" ? "tv" : "movie";
  const activeSeason = mediaType === "tv" ? (search.s ?? 1) : undefined;
  const activeEpisode = mediaType === "tv" ? (search.e ?? 1) : undefined;
  const waitingForRememberedEpisode = mediaType === "tv" && (!search.s || !search.e);
  const progressKey = progressMemoryKey(mediaType, id, activeSeason, activeEpisode);

  const detailQuery = useQuery({
    queryKey: ["watch-detail", mediaType, id],
    queryFn: () => fetchDetail(mediaType, id),
  });

  const detail = detailQuery.data;
  const title = detail ? titleOf(detail) : "Loading";
  const year = detail ? yearOf(detail) : "";
  const posterUrl = detail ? poster(detail.poster_path, "w500") : null;
  const backdropUrl = detail ? backdrop(detail.backdrop_path, "w1280") : null;

  useEffect(() => {
    if (!detail) return;
    document.title = `Watching ${title}${year ? ` (${year})` : ""} - Leethe`;
  }, [detail, title, year]);

  const streamInput = useMemo<ResolveWatchStreamsInput | null>(() => {
    if (!detail) return null;
    return {
      title: titleOf(detail),
      type: mediaType,
      tmdbId: id,
      year: yearOf(detail) || undefined,
      runtimeMinutes: detail.runtime ?? detail.episode_run_time?.[0],
      seasonCount: detail.number_of_seasons,
      season: activeSeason,
      episode: activeEpisode,
    };
  }, [activeEpisode, activeSeason, detail, id, mediaType]);

  const streamQuery = useQuery({
    queryKey: ["watch-stream", mediaType, id, activeSeason ?? 0, activeEpisode ?? 0],
    enabled: Boolean(streamInput) && !waitingForRememberedEpisode,
    queryFn: () => resolveWatchStreams({ data: streamInput! }),
    retry: 1,
    staleTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  const seasonQuery = useQuery({
    queryKey: ["watch-season", id, activeSeason],
    enabled: mediaType === "tv" && Boolean(activeSeason) && !waitingForRememberedEpisode,
    queryFn: () => fetchSeason(id, activeSeason ?? 1),
    refetchOnWindowFocus: false,
  });

  const [sourceIndex, setSourceIndex] = useState(0);
  const streams: StreamLink[] = useMemo(
    () => streamQuery.data?.streams ?? [],
    [streamQuery.data?.streams],
  );
  const activeSource = streams[sourceIndex] ?? streams[0];
  const activeSourceUrl = activeSource?.url;

  const captionQuery = useQuery({
    queryKey: ["watch-captions", streamQuery.data?.subjectId, activeSource?.resourceId],
    enabled: Boolean(streamQuery.data?.subjectId && activeSource?.resourceId),
    queryFn: () =>
      resolveStreamCaptions({
        data: {
          subjectId: streamQuery.data!.subjectId!,
          resourceId: activeSource!.resourceId!,
        },
      }),
    refetchOnWindowFocus: false,
  });

  const activeCaptions = useMemo(() => {
    const combined = [
      ...(Array.isArray(activeSource?.extCaptions) ? activeSource.extCaptions : []),
      ...(Array.isArray(captionQuery.data) ? captionQuery.data : []),
    ];
    return normalizeCaptionCandidates(combined);
  }, [activeSource?.extCaptions, captionQuery.data]);
  const [hlsTracks, setHlsTracks] = useState<HlsTrackOptions>({
    levels: [],
    audioTracks: [],
    subtitles: [],
  });
  const [hlsQualityChoice, setHlsQualityChoice] = useState("auto");
  const [hlsAudioChoice, setHlsAudioChoice] = useState("");
  const [subtitleChoice, setSubtitleChoice] = useState("off");
  const [playbackPreferences, setPlaybackPreferences] = useState<PlaybackPreferences>(
    DEFAULT_PLAYBACK_PREFERENCES,
  );
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const resolverError =
    streamQuery.error instanceof Error
      ? streamQuery.error.message
      : streamQuery.data && !streamQuery.data.success
        ? streamQuery.data.error || "No playable stream was found."
        : "";
  const streamError = playbackError || resolverError;

  useEffect(() => {
    const stored = readJson<PlaybackPreferences>(PLAYBACK_PREFERENCES_KEY);
    if (stored) setPlaybackPreferences(normalizePlaybackPreferences(stored));
  }, []);

  useEffect(() => {
    if (mediaType !== "tv" || !waitingForRememberedEpisode) return;
    const saved = readRememberedEpisode(mediaType, id);
    const nextSeason = search.s ?? saved?.season ?? 1;
    const nextEpisode = search.e ?? saved?.episode ?? 1;
    void navigate({
      to: "/watch/$type/$id",
      params: { type: mediaType, id },
      search: { s: nextSeason, e: nextEpisode },
      replace: true,
    });
  }, [id, mediaType, navigate, search.e, search.s, waitingForRememberedEpisode]);

  useEffect(() => {
    if (mediaType !== "tv" || !activeSeason || !activeEpisode || waitingForRememberedEpisode) {
      return;
    }
    rememberEpisode(mediaType, id, activeSeason, activeEpisode);
  }, [activeEpisode, activeSeason, id, mediaType, waitingForRememberedEpisode]);

  useEffect(() => {
    if (!streams.length) return;
    const preference = readJson<StoredStreamPreference>(streamPreferenceKey(progressKey));
    setSourceIndex(findPreferredStreamIndex(streams, preference));
  }, [progressKey, streamQuery.data?.subjectId, streams]);

  useEffect(() => {
    if (!activeSource) return;
    writeJson(streamPreferenceKey(progressKey), {
      url: activeSource.url,
      resourceId: activeSource.resourceId,
      resolution: activeSource.resolution,
      audioKey: audioKey(activeSource),
      updatedAt: Date.now(),
    } satisfies StoredStreamPreference);
  }, [activeSource, progressKey]);

  useEffect(() => {
    setHlsTracks({ levels: [], audioTracks: [], subtitles: [] });
    setHlsQualityChoice("auto");
    setHlsAudioChoice("");
    setSubtitleChoice(readJson<string>(subtitlePreferenceKey(progressKey)) || "off");
    setPlaybackError("");
  }, [activeSourceUrl, progressKey]);

  useEffect(() => {
    if (hlsAudioChoice || !hlsTracks.audioTracks.length) return;
    setHlsAudioChoice(hlsTracks.audioTracks[0].value);
  }, [hlsAudioChoice, hlsTracks.audioTracks]);

  const markerQuery = useSkipMarkers(mediaType, id, activeSeason, activeEpisode);

  const nextTarget = useMemo(
    () =>
      mediaType === "tv"
        ? nextEpisodeTarget(
            activeSeason,
            activeEpisode,
            seasonQuery.data?.episodes ?? [],
            detailQuery.data?.seasons ?? [],
          )
        : null,
    [activeEpisode, activeSeason, detailQuery.data?.seasons, mediaType, seasonQuery.data?.episodes],
  );
  const nextTargetLabel = nextTarget
    ? `Season ${nextTarget.season}, Episode ${nextTarget.episode}`
    : "Next episode";

  const updatePlaybackPreferences = useCallback((patch: Partial<PlaybackPreferences>) => {
    setPlaybackPreferences((current) => {
      const next = normalizePlaybackPreferences({ ...current, ...patch });
      writeJson(PLAYBACK_PREFERENCES_KEY, next);
      return next;
    });
  }, []);

  const goToNextEpisode = useCallback(() => {
    if (!nextTarget) return;
    setNextEpisodeCountdown(null);
    void navigate({
      to: "/watch/$type/$id",
      params: { type: "tv", id },
      search: { s: nextTarget.season, e: nextTarget.episode },
    });
  }, [id, navigate, nextTarget]);

  const handleEnded = useCallback(() => {
    if (mediaType === "tv" && nextTarget && playbackPreferences.autoplayNext) {
      setNextEpisodeCountdown(8);
    }
  }, [mediaType, nextTarget, playbackPreferences.autoplayNext]);

  const handlePlaybackFailure = useCallback(() => {
    if (sourceIndex + 1 < streams.length) {
      setSourceIndex(sourceIndex + 1);
      return;
    }
    const onlyHevc = streams.every((stream) =>
      /\bhevc\b|\bh\.?265\b|\/h265\//i.test(
        [stream.codecName, stream.title, stream.url].filter(Boolean).join(" "),
      ),
    );
    setPlaybackError(
      onlyHevc
        ? "The provider returned only HEVC sources, which this browser may not support."
        : "The available playback sources could not be loaded. Try again or report the issue.",
    );
  }, [sourceIndex, streams]);

  useEffect(() => {
    setNextEpisodeCountdown(null);
  }, [activeEpisode, activeSeason]);

  useEffect(() => {
    if (nextEpisodeCountdown === null) return;
    if (nextEpisodeCountdown <= 0) {
      goToNextEpisode();
      return;
    }
    const timer = window.setTimeout(
      () => setNextEpisodeCountdown((current) => (current === null ? null : current - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [goToNextEpisode, nextEpisodeCountdown]);

  return (
    <div className="min-h-screen bg-[oklch(0.08_0.004_250)] text-foreground">
      <WatchTopBar
        type={mediaType}
        id={id}
        title={title}
        season={activeSeason}
        episode={activeEpisode}
      />

      <main className="mx-auto max-w-[1480px] px-3 pb-6 pt-3 sm:px-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 animate-fade-in">
            <div className="poster-card overflow-hidden rounded-md bg-black">
              <div className="relative aspect-video bg-black">
                {detailQuery.isLoading || waitingForRememberedEpisode || streamQuery.isLoading ? (
                  <PlayerPlaceholder backdropUrl={backdropUrl} title={title}>
                    {waitingForRememberedEpisode
                      ? "Restoring your last episode..."
                      : "Resolving stream..."}
                  </PlayerPlaceholder>
                ) : streamError || !activeSource ? (
                  <PlayerPlaceholder backdropUrl={backdropUrl} title={title}>
                    {streamError || "No playable stream was found."}
                  </PlayerPlaceholder>
                ) : (
                  <VideoPlayer
                    key={activeSource.url}
                    sourceUrl={activeSource.url}
                    sourceType={inferSourceType(activeSource.url)}
                    posterUrl={backdropUrl || posterUrl || undefined}
                    progressKey={progressKey}
                    captions={activeCaptions}
                    hlsQualityChoice={hlsQualityChoice}
                    hlsAudioChoice={hlsAudioChoice}
                    subtitleChoice={subtitleChoice}
                    onHlsTracksChange={setHlsTracks}
                    mediaType={mediaType}
                    tmdbId={id}
                    season={activeSeason}
                    episode={activeEpisode}
                    onEnded={handleEnded}
                    markers={markerQuery.data}
                    autoplayVideo={playbackPreferences.autoplayVideo}
                    playbackRate={playbackPreferences.playbackRate}
                    onPlaybackFailure={handlePlaybackFailure}
                    onPlaybackRateChange={(playbackRate) =>
                      updatePlaybackPreferences({ playbackRate })
                    }
                  />
                )}
                {nextEpisodeCountdown !== null && nextTarget ? (
                  <NextEpisodePrompt
                    label={nextTargetLabel}
                    countdown={nextEpisodeCountdown}
                    onCancel={() => setNextEpisodeCountdown(null)}
                    onPlay={goToNextEpisode}
                  />
                ) : null}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground">
                  {mediaType === "movie" ? "Feature film" : "TV Series"}
                </div>
                <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-foreground sm:text-[28px]">
                  {title}
                  {year && <span className="ml-2 font-light text-foreground/45">({year})</span>}
                </h1>
              </div>

              {streams.length > 0 && (
                <StreamControls
                  streams={streams}
                  activeIndex={sourceIndex}
                  onSelect={setSourceIndex}
                  captions={activeCaptions}
                  hlsTracks={hlsTracks}
                  hlsQualityChoice={hlsQualityChoice}
                  onHlsQualityChange={setHlsQualityChoice}
                  hlsAudioChoice={hlsAudioChoice}
                  onHlsAudioChange={setHlsAudioChoice}
                  subtitleChoice={subtitleChoice}
                  onSubtitleChange={setSubtitleChoice}
                  title={title}
                  mediaType={mediaType}
                  tmdbId={id}
                  season={activeSeason}
                  episode={activeEpisode}
                />
              )}
            </div>
          </section>

          <aside className="animate-fade-up lg:sticky lg:top-16 lg:self-start">
            <div className="brushed poster-card overflow-hidden rounded-md">
              <div className="nav-aluminum flex items-center justify-between border-b border-[var(--aluminum-line)] px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <MediaGlyph className="h-5 w-5 text-primary/80" />
                  <span className="text-[12px] font-semibold text-foreground/90">Playback</span>
                </div>
                {streamQuery.data?.subjectId && (
                  <span className="text-[9px] text-muted-foreground">
                    source {streamQuery.data.subjectId}
                  </span>
                )}
              </div>

              <div className="space-y-3 p-3">
                {mediaType === "tv" && detail?.seasons?.length ? (
                  <EpisodeNavigator
                    id={id}
                    type={mediaType}
                    seasons={detail.seasons.filter((season) => season.season_number > 0)}
                    activeSeason={activeSeason ?? 1}
                    activeEpisode={activeEpisode ?? 1}
                    episodes={seasonQuery.data?.episodes ?? []}
                    loading={seasonQuery.isLoading}
                    withDivider={false}
                    downloadInput={{
                      title,
                      type: "tv",
                      tmdbId: id,
                      year: year || undefined,
                      runtimeMinutes: detail.episode_run_time?.[0],
                      seasonCount: detail.number_of_seasons,
                      subjectId: streamQuery.data?.subjectId,
                      episodes: [],
                    }}
                  />
                ) : (
                  <SummaryBlock detail={detail} />
                )}
                <PlaybackPreferencesPanel
                  preferences={playbackPreferences}
                  onChange={updatePlaybackPreferences}
                  nextTarget={nextTarget}
                  onPlayNext={goToNextEpisode}
                />
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function WatchTopBar({
  type,
  id,
  title,
  season,
  episode,
}: {
  type: MediaType;
  id: string;
  title: string;
  season?: number;
  episode?: number;
}) {
  return (
    <header className="nav-aluminum brushed sticky top-0 z-50">
      <div className="mx-auto flex h-12 max-w-[1480px] items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/title/$type/$id"
            params={{ type, id }}
            className="chip-pill chip-pill-interactive inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
          >
            <ArrowLeftGlyph className="h-3 w-3" />
            Details
          </Link>
          <div className="flex min-w-0 items-center gap-1.5">
            <MediaGlyph className="h-5 w-5 shrink-0 text-primary/80" />
            <span className="line-clamp-1 text-[13px] font-semibold text-foreground/90">
              {title}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            to="/support"
            search={{
              category: "playback",
              path: `/watch/${type}/${id}`,
              type,
              id: Number(id),
              s: season,
              e: episode,
            }}
            className="chip-pill chip-pill-interactive rounded-full px-2.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
          >
            Report issue
          </Link>
          <Link
            to="/"
            className="chip-pill chip-pill-interactive hidden rounded-full px-2.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] sm:inline-flex"
          >
            Catalog
          </Link>
        </div>
      </div>
    </header>
  );
}

function PlayerPlaceholder({
  backdropUrl,
  title,
  children,
}: {
  backdropUrl: string | null;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-cover bg-center text-center"
      style={{
        backgroundImage: backdropUrl
          ? `linear-gradient(rgba(0,0,0,.58), rgba(0,0,0,.86)), url(${backdropUrl})`
          : "linear-gradient(to bottom, oklch(0.18 0.006 250), oklch(0.05 0.004 250))",
      }}
    >
      <div className="flex max-w-md flex-col items-center gap-3 px-5">
        <MediaPlaceholder label="" className="h-14 w-20 rounded-md border border-white/10" />
        <div>
          <div className="text-[14px] font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-foreground/70">{children}</div>
        </div>
      </div>
    </div>
  );
}

function NextEpisodePrompt({
  label,
  countdown,
  onCancel,
  onPlay,
}: {
  label: string;
  countdown: number;
  onCancel: () => void;
  onPlay: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/72 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Up next: ${label}`}
        className="panel-aluminum w-full max-w-sm rounded-md p-5 text-center"
      >
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
          Up next
        </div>
        <div className="mt-1 text-[16px] font-semibold text-foreground">{label}</div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Playing automatically in {countdown} second{countdown === 1 ? "" : "s"}.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="chip-pill chip-pill-interactive rounded-full px-4 py-1.5 text-[11px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPlay}
            className="btn-aqua btn-aqua-interactive rounded-full px-4 py-1.5 text-[11px]"
          >
            Play now
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaybackPreferencesPanel({
  preferences,
  onChange,
  nextTarget,
  onPlayNext,
}: {
  preferences: PlaybackPreferences;
  onChange: (patch: Partial<PlaybackPreferences>) => void;
  nextTarget: { season: number; episode: number } | null;
  onPlayNext: () => void;
}) {
  return (
    <section className="rounded-md border border-[var(--aluminum-line)] bg-black/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
          Preferences
        </h2>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_PLAYBACK_PREFERENCES)}
          className="text-[9px] text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>
      <div className="grid gap-2">
        <PreferenceToggle
          label="Autoplay video"
          description="Start a resolved source automatically."
          active={preferences.autoplayVideo}
          onClick={() => onChange({ autoplayVideo: !preferences.autoplayVideo })}
        />
        <PreferenceToggle
          label="Autoplay next"
          description="Continue TV episodes after a cancelable countdown."
          active={preferences.autoplayNext}
          onClick={() => onChange({ autoplayNext: !preferences.autoplayNext })}
        />

        {nextTarget ? (
          <button
            type="button"
            onClick={onPlayNext}
            className="btn-aqua btn-aqua-interactive rounded-full px-3 py-1.5 text-[10px] font-medium"
          >
            Play next: S{nextTarget.season} E{nextTarget.episode}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PreferenceToggle({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-md border border-[var(--aluminum-line)] bg-black/15 px-3 py-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span>
        <span className="block text-[10px] font-medium text-foreground/90">{label}</span>
        <span className="mt-0.5 block text-[9px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
          active ? "border-primary/70 bg-primary/70" : "border-[var(--aluminum-line)] bg-black/30"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            active ? "translate-x-[17px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function MovieDownloadMenu({
  streams,
  title,
  mediaType,
  tmdbId,
  season,
  episode,
}: {
  streams: StreamLink[];
  title: string;
  mediaType: MediaType;
  tmdbId: string;
  season?: number;
  episode?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    return streams
      .filter((s) => isDirectDownload(s.url))
      .map((s) => ({
        url: s.url,
        quality: s.quality || `${s.resolution || 720}p`,
        audioLabel: audioLabel(s),
        size: s.size,
      }));
  }, [streams]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (options.length === 0) return null;

  return (
    <div className="relative inline-flex flex-col stream-menu-container" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="btn-aqua btn-aqua-interactive inline-flex min-h-7 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-medium"
      >
        <DownloadGlyph className="h-3 w-3" />
        Download
      </button>

      {isOpen && (
        <div className="absolute z-50 bottom-full right-0 mb-1 w-max max-w-[18rem] min-w-[14rem] overflow-hidden rounded-md border border-[oklch(0.2_0.005_250)] bg-[oklch(0.18_0.008_250)] shadow-lg animate-fade-in shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          <div className="px-3 py-2 border-b border-[oklch(0.2_0.005_250)] text-[10px] font-semibold text-foreground/85">
            Select Quality
          </div>
          <ul className="max-h-64 overflow-auto py-1 overscroll-contain">
            {options.map((opt) => (
              <li key={`${opt.url}:${opt.quality}:${opt.audioLabel}`}>
                <a
                  href={opt.url}
                  download={downloadFileName(title, opt.quality, season, episode)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    setIsOpen(false);
                    recordClientEvent("download", { mediaType, tmdbId, season, episode });
                  }}
                  className="flex flex-col px-3 py-2 hover:bg-[oklch(0.24_0.008_250)] focus:bg-[oklch(0.24_0.008_250)] outline-none"
                >
                  <div className="flex justify-between gap-4">
                    <span className="text-[11px] font-medium text-foreground">{opt.quality}</span>
                    {opt.size && (
                      <span className="text-[10px] text-muted-foreground">
                        {(opt.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                  </div>
                  {opt.audioLabel && (
                    <span className="text-[9px] text-foreground/60">{opt.audioLabel}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StreamControls({
  streams,
  activeIndex,
  onSelect,
  captions,
  hlsTracks,
  hlsQualityChoice,
  onHlsQualityChange,
  hlsAudioChoice,
  onHlsAudioChange,
  subtitleChoice,
  onSubtitleChange,
  title,
  mediaType,
  tmdbId,
  season,
  episode,
}: {
  streams: StreamLink[];
  activeIndex: number;
  onSelect: (index: number) => void;
  captions: CaptionCandidate[];
  hlsTracks: HlsTrackOptions;
  hlsQualityChoice: string;
  onHlsQualityChange: (value: string) => void;
  hlsAudioChoice: string;
  onHlsAudioChange: (value: string) => void;
  subtitleChoice: string;
  onSubtitleChange: (value: string) => void;
  title: string;
  mediaType: MediaType;
  tmdbId: string;
  season?: number;
  episode?: number;
}) {
  const active = streams[activeIndex] ?? streams[0];
  const sourceQualities = Array.from(
    new Map(
      streams
        .filter((stream) => stream.resolution > 0)
        .map((stream) => [stream.resolution, stream.quality || `${stream.resolution}p`]),
    ).entries(),
  ).sort((a, b) => b[0] - a[0]);
  const audioOptions = Array.from(
    new Map(streams.map((stream) => [audioKey(stream), audioLabel(stream)])).entries(),
  );
  const subtitleOptions = [
    ...captions.map((caption) => ({ value: `external:${caption.id}`, label: caption.label })),
    ...hlsTracks.subtitles,
  ];

  const pickStream = (quality: number | undefined, audio: string | undefined) => {
    const targetQuality = quality ?? active?.resolution;
    const targetAudio = audio ?? audioKey(active);
    const exact = streams.findIndex(
      (stream) => stream.resolution === targetQuality && audioKey(stream) === targetAudio,
    );
    if (exact >= 0) return onSelect(exact);

    const byQuality = streams.findIndex((stream) => stream.resolution === targetQuality);
    if (byQuality >= 0) return onSelect(byQuality);

    const byAudio = streams.findIndex((stream) => audioKey(stream) === targetAudio);
    if (byAudio >= 0) return onSelect(byAudio);
  };

  const showSourceQuality = !hlsTracks.levels.length && sourceQualities.length > 1;
  const showHlsQuality = hlsTracks.levels.length > 0;
  const showSourceAudio = hlsTracks.audioTracks.length <= 1 && audioOptions.length > 1;
  const showHlsAudio = hlsTracks.audioTracks.length > 1;
  const activeAudioLabel = audioLabel(active);

  return (
    <div className="playback-strip">
      {showHlsQuality ? (
        <SelectMenu
          label="Quality"
          value={hlsQualityChoice}
          onChange={(value) => onHlsQualityChange(value)}
          options={[
            { value: "auto", label: "Auto" },
            ...hlsTracks.levels.map((level) => ({ value: level.value, label: level.label })),
          ]}
        />
      ) : null}

      {showSourceQuality ? (
        <SelectMenu
          label="Quality"
          value={String(active?.resolution ?? "")}
          onChange={(value) => pickStream(Number(value), undefined)}
          options={sourceQualities.map(([resolution, label]) => ({
            value: resolution,
            label,
          }))}
        />
      ) : null}

      {showHlsAudio ? (
        <SelectMenu
          label="Audio"
          value={hlsAudioChoice}
          onChange={(value) => onHlsAudioChange(value)}
          options={hlsTracks.audioTracks.map((track) => ({
            value: track.value,
            label: track.label,
          }))}
        />
      ) : null}

      {showSourceAudio ? (
        <SelectMenu
          label="Audio"
          value={audioKey(active)}
          onChange={(value) => pickStream(undefined, value)}
          options={audioOptions.map(([key, label]) => ({
            value: key,
            label,
          }))}
        />
      ) : null}

      {subtitleOptions.length > 0 && (
        <SelectMenu
          label="Subtitles"
          value={subtitleChoice}
          onChange={(value) => onSubtitleChange(value)}
          options={[
            { value: "off", label: "Off" },
            ...subtitleOptions.map((track) => ({ value: track.value, label: track.label })),
          ]}
        />
      )}

      {streams.length > 1 && (
        <SelectMenu
          label="Server"
          value={activeIndex}
          onChange={(value) => onSelect(Number(value))}
          options={streams.map((stream, index) => ({
            value: index,
            label: streamLabel(stream, index),
          }))}
        />
      )}

      <span className="stream-availability" aria-live="polite">
        {subtitleOptions.length
          ? `${subtitleOptions.length} subtitle${subtitleOptions.length === 1 ? "" : "s"}`
          : "No subtitles"}
        <span aria-hidden="true"> / </span>
        {Math.max(audioOptions.length, hlsTracks.audioTracks.length) > 1
          ? `${Math.max(audioOptions.length, hlsTracks.audioTracks.length)} audio tracks`
          : activeAudioLabel === "Default"
            ? "Default audio"
            : `${activeAudioLabel} audio`}
      </span>

      {mediaType === "movie" ? (
        <MovieDownloadMenu
          streams={streams}
          title={title}
          mediaType={mediaType}
          tmdbId={tmdbId}
          season={season}
          episode={episode}
        />
      ) : null}
    </div>
  );
}

function VideoPlayer({
  sourceUrl,
  sourceType,
  posterUrl,
  progressKey,
  captions,
  hlsQualityChoice,
  hlsAudioChoice,
  subtitleChoice,
  onHlsTracksChange,
  mediaType,
  tmdbId,
  season,
  episode,
  onEnded,
  markers,
  autoplayVideo,
  playbackRate,
  onPlaybackFailure,
  onPlaybackRateChange,
}: {
  sourceUrl: string;
  sourceType: string;
  posterUrl?: string;
  progressKey: string;
  captions: CaptionCandidate[];
  hlsQualityChoice: string;
  hlsAudioChoice: string;
  subtitleChoice: string;
  onHlsTracksChange: (options: HlsTrackOptions) => void;
  mediaType: MediaType;
  tmdbId: string;
  season?: number;
  episode?: number;
  onEnded?: () => void;
  markers?: SkipMarker[];
  autoplayVideo: boolean;
  playbackRate: number;
  onPlaybackFailure: () => void;
  onPlaybackRateChange: (playbackRate: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const startedRef = useRef(false);
  const autoplayVideoRef = useRef(autoplayVideo);
  const [hlsSubtitles, setHlsSubtitles] = useState<PlayerTrackOption[]>([]);
  const [externalTracks, setExternalTracks] = useState<ResolvedCaptionTrack[]>([]);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [isInteracting, setIsInteracting] = useState(true);

  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    autoplayVideoRef.current = autoplayVideo;
  }, [autoplayVideo]);

  useEffect(() => {
    const video = videoRef.current as HTMLVideoElement;
    if (!video) return;
    let hls: HlsInstance | null = null;
    let cancelled = false;
    let lastSavedAt = 0;
    let progressRestored = false;

    // Sync initial state with DOM in case browser auto-muted for autoplay
    setVolume(video.volume);
    setMuted(video.muted);

    const persist = () => saveProgress(progressKey, video);
    const maybeRestore = () => {
      if (progressRestored) return;
      restoreProgress(progressKey, video);
      progressRestored = true;
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (Math.abs(video.currentTime - lastSavedAt) < 5) return;
      lastSavedAt = video.currentTime;
      persist();
    };

    const handleVideoEnded = () => onEndedRef.current?.();

    const onPlay = () => {
      setPaused(false);
      if (startedRef.current) return;
      startedRef.current = true;
      recordClientEvent("playback_start", { mediaType, tmdbId, season, episode });
    };
    const onPause = () => setPaused(true);
    const onDurationChange = () => {
      maybeRestore();
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onLoadedMetadata = () => {
      maybeRestore();
    };
    const onError = () => {
      recordClientEvent("playback_error", { mediaType, tmdbId, season, episode });
      onPlaybackFailure();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("ended", handleVideoEnded);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("pause", persist);
    video.addEventListener("ended", persist);
    video.addEventListener("error", onError);
    window.addEventListener("pagehide", persist);

    function syncHlsTracks() {
      if (!hls) return;
      const nextLevels =
        hls.levels?.map((level, index) => ({
          value: String(index),
          label:
            level.name ||
            (level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)}kbps`),
        })) ?? [];
      const nextAudio =
        hls.audioTracks?.map((track, index) => ({
          value: String(index),
          label: track.name || track.lang || track.language || `Audio ${index + 1}`,
        })) ?? [];
      const nextSubtitles =
        hls.subtitleTracks?.map((track, index) => ({
          value: `hls:${index}`,
          label: track.name || track.lang || track.language || `Subtitle ${index + 1}`,
        })) ?? [];

      const levels = nextLevels.filter((level) => level.label && level.label !== "0kbps");
      setHlsSubtitles(nextSubtitles);
      onHlsTracksChange({ levels, audioTracks: nextAudio, subtitles: nextSubtitles });
    }

    async function attachSource() {
      if (sourceType === "application/x-mpegURL") {
        const { default: Hls } = await import("hls.js");
        const BundledHls = Hls as unknown as {
          new (config?: Record<string, unknown>): HlsInstance;
          isSupported: () => boolean;
          Events?: Record<string, string>;
        };

        if (!cancelled && BundledHls.isSupported()) {
          hls = new BundledHls({ enableWorker: true });
          hlsRef.current = hls;
          const events = BundledHls.Events ?? {};
          const trackedEvents = [
            events.MANIFEST_PARSED,
            events.LEVELS_UPDATED,
            events.AUDIO_TRACKS_UPDATED,
            events.SUBTITLE_TRACKS_UPDATED,
          ].filter(Boolean);
          trackedEvents.forEach((eventName) => hls?.on?.(eventName, syncHlsTracks));
          if (events.ERROR) {
            hls.on?.(events.ERROR, (_event, data) => {
              const errorData =
                data && typeof data === "object" ? (data as Record<string, unknown>) : {};
              if (errorData.fatal) onError();
            });
          }
          hls.loadSource(sourceUrl);
          hls.attachMedia(video);
          setTimeout(syncHlsTracks, 0);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = sourceUrl;
          video.load();
        }
      } else {
        video.src = sourceUrl;
        video.load();
      }
      if (autoplayVideoRef.current) video.play().catch(() => {});
    }

    attachSource().catch(() => {
      video.src = sourceUrl;
      video.load();
      if (autoplayVideoRef.current) video.play().catch(() => {});
    });

    return () => {
      cancelled = true;
      persist();
      if (hls) hls.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("ended", handleVideoEnded);
      video.removeEventListener("pause", persist);
      video.removeEventListener("ended", persist);
      video.removeEventListener("error", onError);
      window.removeEventListener("pagehide", persist);
    };
  }, [
    episode,
    mediaType,
    onHlsTracksChange,
    onPlaybackFailure,
    progressKey,
    season,
    sourceType,
    sourceUrl,
    tmdbId,
  ]);

  useEffect(() => {
    setHlsSubtitles([]);
    onHlsTracksChange({ levels: [], audioTracks: [], subtitles: [] });
  }, [onHlsTracksChange, progressKey, sourceUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    let alive = true;
    const objectUrls: string[] = [];

    async function resolveTracks() {
      const resolved = await Promise.all(
        captions.map(async (caption) => {
          try {
            const trackText = await proxySubtitle({ data: caption.url });
            if (!trackText) return { ...caption, src: caption.url };
            let converted = trackText;
            if (!converted.trimStart().startsWith("WEBVTT")) {
              converted = srtToVtt(trackText);
            }
            if (!converted.trimStart().startsWith("WEBVTT")) {
              return { ...caption, src: caption.url };
            }
            const objectUrl = URL.createObjectURL(
              new Blob([converted], { type: "text/vtt;charset=utf-8" }),
            );
            objectUrls.push(objectUrl);
            return { ...caption, src: objectUrl, objectUrl };
          } catch {
            return { ...caption, src: caption.url };
          }
        }),
      );
      if (alive) setExternalTracks(resolved);
    }

    void resolveTracks();
    return () => {
      alive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [captions]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = hlsQualityChoice === "auto" ? -1 : Number(hlsQualityChoice);
  }, [hlsQualityChoice]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || !hlsAudioChoice) return;
    hls.audioTrack = Number(hlsAudioChoice);
  }, [hlsAudioChoice]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    writeJson(subtitlePreferenceKey(progressKey), subtitleChoice);

    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = -1;
    }
    video.querySelectorAll<HTMLTrackElement>("track[data-caption-id]").forEach((trackElement) => {
      trackElement.track.mode =
        subtitleChoice === `external:${trackElement.dataset.captionId}` ? "showing" : "disabled";
    });

    if (subtitleChoice.startsWith("hls:") && hlsRef.current) {
      hlsRef.current.subtitleTrack = Number(subtitleChoice.replace("hls:", ""));
    }
  }, [externalTracks, hlsSubtitles, progressKey, subtitleChoice]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleInteract = () => {
      setIsInteracting(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsInteracting(false), 2500);
    };
    const handleMouseLeave = () => {
      clearTimeout(timeout);
      setIsInteracting(false);
    };

    handleInteract();

    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleInteract);
      container.addEventListener("touchstart", handleInteract, { passive: true });
      container.addEventListener("click", handleInteract);
      container.addEventListener("mouseleave", handleMouseLeave);
      return () => {
        clearTimeout(timeout);
        container.removeEventListener("mousemove", handleInteract);
        container.removeEventListener("touchstart", handleInteract);
        container.removeEventListener("click", handleInteract);
        container.removeEventListener("mouseleave", handleMouseLeave);
      };
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        (activeElement.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(activeElement.tagName))
      ) {
        return;
      }

      const video = videoRef.current;
      const container = containerRef.current;
      if (!video || !container) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) void video.play();
          else video.pause();
          break;
        case "arrowleft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case "arrowright": {
          e.preventDefault();
          const d = Number.isFinite(video.duration) ? video.duration : 0;
          video.currentTime = Math.min(d, video.currentTime + 10);
          break;
        }
        case "m":
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case "f":
          e.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen();
          else void container.requestFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.muted) video.muted = false;
      if (video.volume === 0) video.volume = 1;
      void video.play();
    } else {
      video.pause();
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  };

  return (
    <div
      ref={containerRef}
      className={`player-shell relative h-full w-full bg-black ${
        !paused && !isInteracting ? "cursor-none" : "controls-active"
      }`}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black"
        onClick={togglePlayback}
        playsInline
        autoPlay={autoplayVideo}
        poster={posterUrl}
        preload="metadata"
      >
        {externalTracks.map((track) => (
          <track
            key={track.id}
            data-caption-id={track.id}
            kind="subtitles"
            label={track.label}
            srcLang={track.lang}
            src={track.src}
          />
        ))}
      </video>
      {paused ? (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlayback}
          className="player-center-button"
        >
          <PlayGlyph className="h-7 w-7" />
        </button>
      ) : null}

      {markers?.map((marker) => {
        const isActive = currentTime >= marker.start && currentTime < marker.end;
        if (!isActive) return null;
        return (
          <button
            key={marker.type}
            type="button"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.currentTime = marker.end;
              }
            }}
            className="absolute bottom-16 right-4 z-30 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-[12px] font-semibold text-white backdrop-blur-md transition-[transform,background-color] hover:bg-black/80 hover:scale-105"
          >
            Skip {marker.type === "intro" ? "Intro" : "Credits"}
          </button>
        );
      })}

      <div
        className={`player-controls transition-opacity duration-300 ${
          paused || isInteracting ? "opacity-100" : "opacity-0"
        }`}
      >
        <button type="button" onClick={togglePlayback} aria-label={paused ? "Play" : "Pause"}>
          {paused ? <PlayGlyph className="h-3.5 w-3.5" /> : <PauseGlyph className="h-3.5 w-3.5" />}
        </button>
        <span className="player-time">{formatTime(currentTime)}</span>
        <input
          aria-label="Playback position"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const video = videoRef.current;
            if (video) video.currentTime = Number(event.target.value);
          }}
          className="player-range min-w-0 flex-1"
        />
        <span className="player-time">{formatTime(duration)}</span>
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (video) {
              video.muted = !video.muted;
              if (!video.muted && video.volume === 0) {
                video.volume = 1;
              }
            }
          }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <VolumeGlyph muted={muted} className="h-3.5 w-3.5" />
        </button>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(event) => {
            const video = videoRef.current;
            if (!video) return;
            video.volume = Number(event.target.value);
            video.muted = false;
          }}
          className="player-range hidden w-16 sm:block"
        />
        <select
          aria-label="Playback speed"
          value={String(playbackRate)}
          onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          className="rounded border border-white/15 bg-black/30 px-1 py-0.5 text-[10px] text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          <FullscreenGlyph active={fullscreen} className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function SummaryBlock({ detail }: { detail: Awaited<ReturnType<typeof fetchDetail>> | undefined }) {
  if (!detail) {
    return (
      <div className="space-y-2">
        <div className="skeleton h-4 w-32 rounded-full" />
        <div className="skeleton h-12 rounded-md" />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        {detail.vote_average ? (
          <span className="inline-flex items-center gap-0.5">
            <StarGlyph className="h-2.5 w-2.5" />
            {detail.vote_average.toFixed(1)}
          </span>
        ) : null}
        {yearOf(detail) && <span>{yearOf(detail)}</span>}
        {detail.runtime ? <span>{detail.runtime}m</span> : null}
      </div>
      {detail.overview && (
        <p className="text-[11px] leading-relaxed text-foreground/72">{detail.overview}</p>
      )}
    </div>
  );
}

function EpisodeNavigator({
  id,
  type,
  seasons,
  activeSeason,
  activeEpisode,
  episodes,
  loading,
  withDivider = true,
  downloadInput,
}: {
  id: string;
  type: MediaType;
  seasons: { id: number; season_number: number; name: string }[];
  activeSeason: number;
  activeEpisode: number;
  episodes: { id: number; episode_number: number; name: string; still_path: string | null }[];
  loading: boolean;
  withDivider?: boolean;
  downloadInput: ResolveEpisodeDownloadsInput;
}) {
  const [downloadMode, setDownloadMode] = useState(false);
  const [expandedEpisode, setExpandedEpisode] = useState<{
    episode: number;
    options: EpisodeDownloadOption[];
    loading: boolean;
  } | null>(null);

  const downloadEpisode = async (ep: number) => {
    if (expandedEpisode?.episode === ep) {
      setExpandedEpisode(null);
      return;
    }
    setExpandedEpisode({ episode: ep, options: [], loading: true });
    try {
      const result = await resolveEpisodeDownloads({
        data: {
          ...downloadInput,
          episodes: [{ season: activeSeason, episode: ep }],
        },
      });
      const epData = result.downloads[0];
      if (epData && epData.success && epData.options) {
        setExpandedEpisode({ episode: ep, options: epData.options, loading: false });
      } else {
        setExpandedEpisode({ episode: ep, options: [], loading: false });
      }
    } catch {
      setExpandedEpisode({ episode: ep, options: [], loading: false });
    }
  };

  const seasonRailRef = useRef<HTMLDivElement>(null);


  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: episodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 5,
  });
  const scrollSeasonRail = (dir: -1 | 1) =>
    seasonRailRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" });

  return (
    <div className={withDivider ? "border-t border-[var(--aluminum-line)] pt-3" : ""}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-semibold text-foreground/90">Episodes</h2>
        </div>

      </div>

      <div className="mb-3 grid grid-cols-[minmax(0,1fr)] items-center gap-1.5 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <RailArrowButton aria-label="Scroll seasons left" onClick={() => scrollSeasonRail(-1)}>
          <ChevronGlyph dir="left" />
        </RailArrowButton>
        <div
          ref={seasonRailRef}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") scrollSeasonRail(-1);
            if (event.key === "ArrowRight") scrollSeasonRail(1);
          }}
          className="scrollbar-none flex min-w-0 snap-x gap-1.5 overflow-x-auto scroll-smooth pb-1 outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.6)]"
        >
          {seasons.map((season) => {
            const active = season.season_number === activeSeason;
            return (
              <Link
                key={season.id}
                to="/watch/$type/$id"
                params={{ type, id }}
                search={{ s: season.season_number, e: 1 }}
                aria-current={active ? "true" : undefined}
                className={[
                  "chip-pill chip-pill-interactive inline-flex min-h-7 shrink-0 snap-start items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]",
                  active ? "chip-pill-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {active && <CheckGlyph className="h-2.5 w-2.5 text-primary" />}
                {season.name}
              </Link>
            );
          })}
        </div>
        <RailArrowButton aria-label="Scroll seasons right" onClick={() => scrollSeasonRail(1)}>
          <ChevronGlyph dir="right" />
        </RailArrowButton>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-[58px] rounded-md" />
          ))}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="space-y-1.5 overflow-visible pr-0 lg:max-h-[460px] lg:overflow-y-auto lg:pr-1"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const episode = episodes[virtualItem.index];
              const active = episode.episode_number === activeEpisode;
              const image = still(episode.still_path, "w300");
              return (
                <div
                  key={episode.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: "6px",
                  }}
                >
                  <div
                    className={[
                      "group flex items-center gap-2 rounded-[5px] border border-[oklch(0.1_0.005_250)] bg-[oklch(0.18_0.006_250)] px-2 py-1.5 transition-colors hover:bg-[oklch(0.23_0.008_250)]",
                      active
                        ? "shadow-[0_0_0_1px_oklch(0.55_0.16_245/0.35)_inset] bg-[oklch(0.14_0.008_250)]"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <Link
                      to="/watch/$type/$id"
                      params={{ type, id }}
                      search={{ s: activeSeason, e: episode.episode_number }}
                      aria-current={active ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                    >
                      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.32_0.008_250)] to-[oklch(0.18_0.008_250)] text-[10px] font-semibold">
                        {active ? (
                          <CheckGlyph className="h-3 w-3 text-primary" />
                        ) : (
                          episode.episode_number
                        )}
                      </div>
                      {image && (
                        <img
                          src={image}
                          alt=""
                          className="hidden h-10 w-[70px] shrink-0 rounded-[4px] object-cover sm:block lg:hidden xl:block"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-1 text-[11px] font-medium text-foreground/90">
                          {episode.name || `Episode ${episode.episode_number}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Episode {episode.episode_number}
                        </div>
                      </div>
                    </Link>
                    {downloadMode && (
                      <div className="pl-2 border-l border-[oklch(0.2_0.005_250)] ml-2 self-stretch flex items-center">
                        <button
                          type="button"
                          onClick={() => downloadEpisode(episode.episode_number)}
                          className="btn-aqua btn-aqua-interactive inline-flex min-h-7 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
                          disabled={
                            expandedEpisode?.episode === episode.episode_number &&
                            expandedEpisode.loading
                          }
                        >
                          <DownloadGlyph className="h-3 w-3" />
                          {expandedEpisode?.episode === episode.episode_number &&
                          expandedEpisode.loading
                            ? "Loading..."
                            : "Quality"}
                        </button>
                      </div>
                    )}
                  </div>
                  {expandedEpisode?.episode === episode.episode_number &&
                    !expandedEpisode.loading && (
                      <div className="mt-1 rounded-md border border-[oklch(0.2_0.005_250)] bg-[oklch(0.18_0.008_250)] px-3 py-2 text-[11px]">
                        {expandedEpisode.options.length > 0 ? (
                          <ul className="space-y-1">
                            {expandedEpisode.options.map((opt, i) => (
                              <li key={i}>
                                <a
                                  href={opt.url}
                                  download={downloadFileName(
                                    downloadInput.title || "video",
                                    opt.quality,
                                    activeSeason,
                                    episode.episode_number,
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex justify-between hover:bg-[oklch(0.24_0.008_250)] px-2 py-1.5 rounded"
                                >
                                  <span className="font-medium text-foreground/90">
                                    {opt.quality || `${opt.resolution}p`}
                                    {opt.audioLabel && opt.audioLabel !== "Default"
                                      ? ` • ${opt.audioLabel}`
                                      : ""}
                                  </span>
                                  {opt.size ? (
                                    <span className="text-[10px] text-muted-foreground">
                                      {(opt.size / (1024 * 1024)).toFixed(1)} MB
                                    </span>
                                  ) : null}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-muted-foreground">No downloads available.</div>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ArrowLeftGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="7.5,2.5 3.5,6 7.5,9.5" />
    </svg>
  );
}

function RailArrowButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...props}
      className="hidden h-7 w-7 shrink-0 place-items-center rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.32_0.008_250)] to-[oklch(0.18_0.008_250)] text-foreground/80 shadow-[0_1px_0_oklch(1_0_0/0.12)_inset,0_1px_1px_oklch(0_0_0/0.5)] transition-all duration-200 hover:text-foreground hover:from-[oklch(0.36_0.008_250)] hover:to-[oklch(0.22_0.008_250)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] md:grid"
    >
      {children}
    </button>
  );
}

function ChevronGlyph({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "left" ? (
        <polyline points="7.5,2.5 3.5,6 7.5,9.5" />
      ) : (
        <polyline points="4.5,2.5 8.5,6 4.5,9.5" />
      )}
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.2 6.2 4.8 8.7 9.9 3.3" />
    </svg>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3 1.7 10.2 6 3 10.3z" />
    </svg>
  );
}

function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.6" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.6" />
    </svg>
  );
}

function DownloadGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 1.5v6" />
      <path d="m3.5 5.5 2.5 2.5 2.5-2.5" />
      <path d="M2 10h8" />
    </svg>
  );
}

function VolumeGlyph({ muted, className }: { muted: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 4.5h2L6 2.3v7.4L3.5 7.5h-2z" />
      {muted ? (
        <>
          <path d="m8 4 2.5 4" />
          <path d="m10.5 4-2.5 4" />
        </>
      ) : (
        <>
          <path d="M8 4.2a2.7 2.7 0 0 1 0 3.6" />
          <path d="M9.5 2.8a4.7 4.7 0 0 1 0 6.4" />
        </>
      )}
    </svg>
  );
}

function FullscreenGlyph({ active, className }: { active: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {active ? (
        <>
          <path d="M4.8 1.7v3.1H1.7" />
          <path d="M7.2 1.7v3.1h3.1" />
          <path d="M4.8 10.3V7.2H1.7" />
          <path d="M7.2 10.3V7.2h3.1" />
        </>
      ) : (
        <>
          <path d="M4.2 1.7H1.7v2.5" />
          <path d="M7.8 1.7h2.5v2.5" />
          <path d="M4.2 10.3H1.7V7.8" />
          <path d="M7.8 10.3h2.5V7.8" />
        </>
      )}
    </svg>
  );
}
