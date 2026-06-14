import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MediaGlyph } from "@/components/leethe/VisualAssets";
import { SelectMenu } from "@/components/leethe/SelectMenu";
import {
  folderDownloadCapability,
  folderDownloadErrorMessage,
  formatDownloadBytes,
  totalDownloadBytes,
  type FolderDownloadCapability,
} from "@/lib/download-folder";
import { episodeDownloadFileName, selectPreferredDownloadOption } from "@/lib/player-media";
import { recordClientEvent } from "@/lib/product-telemetry";
import { resolveEpisodeDownloads } from "@/lib/stream";
import { fetchDetail, fetchSeason, title as titleOf, year as yearOf } from "@/lib/tmdb";

type DownloadOption = {
  url: string;
  quality: string;
  resolution: number;
  audioLabel?: string;
  size?: number;
};

type PreparedDownload = {
  season: number;
  episode: number;
  label: string;
  success: boolean;
  options: DownloadOption[];
  error?: string;
};

type DownloadLink = DownloadOption & {
  season: number;
  episode: number;
  label: string;
  audioLabel: string;
  key: string;
};

type DownloadProgress = {
  bytes: number;
  total: number;
  status: "pending" | "downloading" | "completed" | "cancelled" | "error";
  error?: string;
};

type WritableHandle = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};

type DirectoryHandle = {
  name: string;
  getDirectoryHandle: (name: string, options: { create: boolean }) => Promise<DirectoryHandle>;
  getFileHandle: (
    name: string,
    options: { create: boolean },
  ) => Promise<{ createWritable: () => Promise<WritableHandle> }>;
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "readwrite" }) => Promise<DirectoryHandle>;
};

export const Route = createFileRoute("/download/tv/$id")({
  head: () => ({ meta: [{ title: "Leethe - Download Series" }] }),
  component: DownloadTvPage,
});

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DownloadTvPage() {
  const { id } = useParams({ from: "/download/tv/$id" });
  const detailQuery = useQuery({
    queryKey: ["detail", "tv", id],
    queryFn: () => fetchDetail("tv", id),
  });
  const detail = detailQuery.data;
  const seasons = useMemo(
    () => (detail?.seasons ?? []).filter((season) => season.season_number > 0),
    [detail?.seasons],
  );
  const [activeSeason, setActiveSeason] = useState(1);

  useEffect(() => {
    if (seasons.length && !seasons.some((season) => season.season_number === activeSeason)) {
      setActiveSeason(seasons[0].season_number);
    }
  }, [activeSeason, seasons]);

  const seasonQuery = useQuery({
    queryKey: ["season", id, activeSeason],
    enabled: Boolean(detail && activeSeason),
    queryFn: () => fetchSeason(id, activeSeason),
  });
  const episodes = seasonQuery.data?.episodes ?? [];

  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set());
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparedData, setPreparedData] = useState<PreparedDownload[]>([]);
  const [preferredQuality, setPreferredQuality] = useState("1080p");
  const [preferredAudio, setPreferredAudio] = useState("Any");
  const [preparationError, setPreparationError] = useState("");
  const [folderError, setFolderError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [isDownloadingFolder, setIsDownloadingFolder] = useState(false);
  const [folderCapability, setFolderCapability] = useState<FolderDownloadCapability | "checking">(
    "checking",
  );
  const [folderName, setFolderName] = useState("");
  const [manualDownloadIndex, setManualDownloadIndex] = useState(0);
  const directoryRef = useRef<DirectoryHandle | undefined>(undefined);
  const activeDownloadAbortRef = useRef<AbortController | undefined>(undefined);
  const cancelRequestedRef = useRef(false);
  const subjectIdRef = useRef<string | undefined>(undefined);
  const busy = isPreparing || isDownloadingFolder;

  useEffect(() => {
    setFolderCapability(
      folderDownloadCapability(
        window.isSecureContext,
        typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function",
      ),
    );
  }, []);

  const availableAudios = useMemo(() => {
    const audios = new Set<string>();
    for (const prepared of preparedData) {
      for (const option of prepared.options) audios.add(option.audioLabel?.trim() || "Default");
    }
    return ["Any", ...Array.from(audios).sort()];
  }, [preparedData]);

  const downloadLinks = useMemo(
    () =>
      preparedData.flatMap<DownloadLink>((prepared) => {
        if (!prepared.success || !prepared.options.length) return [];
        const match = selectPreferredDownloadOption(
          prepared.options,
          preferredQuality,
          preferredAudio,
        );
        if (!match) return [];
        return [
          {
            ...match,
            season: prepared.season,
            episode: prepared.episode,
            label: prepared.label,
            audioLabel: match.audioLabel?.trim() || "Default",
            key: `${prepared.season}:${prepared.episode}:${match.url}`,
          },
        ];
      }),
    [preparedData, preferredAudio, preferredQuality],
  );
  const unavailableDownloads = useMemo(
    () => preparedData.filter((prepared) => !prepared.success || !prepared.options.length),
    [preparedData],
  );
  const failedFolderDownloads = useMemo(
    () =>
      downloadLinks.filter((link) => {
        const status = downloadProgress[link.key]?.status;
        return status === "error" || status === "cancelled";
      }),
    [downloadLinks, downloadProgress],
  );
  const queueSummary = useMemo(
    () =>
      Object.values(downloadProgress).reduce(
        (summary, progress) => {
          summary[progress.status] += 1;
          return summary;
        },
        { pending: 0, downloading: 0, completed: 0, cancelled: 0, error: 0 },
      ),
    [downloadProgress],
  );
  const downloadSize = useMemo(() => totalDownloadBytes(downloadLinks), [downloadLinks]);
  const seasonFolderName = useMemo(
    () =>
      `${
        detail
          ? titleOf(detail)
              .replace(/[^a-zA-Z0-9 -]/g, "")
              .trim() || "Series"
          : "Series"
      } Season ${activeSeason}`,
    [activeSeason, detail],
  );
  const nextManualDownload = downloadLinks[manualDownloadIndex];

  useEffect(() => {
    setManualDownloadIndex(0);
  }, [preferredAudio, preferredQuality, preparedData]);

  const toggleEpisode = (episode: number) => {
    const next = new Set(selectedEpisodes);
    if (next.has(episode)) next.delete(episode);
    else next.add(episode);
    setSelectedEpisodes(next);
    setPreparedData([]);
    subjectIdRef.current = undefined;
    setPreparationError("");
  };

  const selectAll = () => {
    setSelectedEpisodes(
      selectedEpisodes.size === episodes.length
        ? new Set()
        : new Set(episodes.map((episode) => episode.episode_number)),
    );
    setPreparedData([]);
    subjectIdRef.current = undefined;
    setPreparationError("");
  };

  const changeSeason = (season: number) => {
    setActiveSeason(season);
    setSelectedEpisodes(new Set());
    setPreparedData([]);
    subjectIdRef.current = undefined;
    setPreparationError("");
    setFolderError("");
    setDownloadProgress({});
  };

  const prepareEpisodes = async (episodeNumbers: number[], replace: boolean) => {
    if (!detail || episodeNumbers.length === 0) return;
    setIsPreparing(true);
    if (replace) setPreparedData([]);
    setPreparationError("");
    setFolderError("");
    if (replace) setDownloadProgress({});
    try {
      const episodeLabels = new Map(
        episodes.map((episode) => [
          episode.episode_number,
          episode.name || `Episode ${episode.episode_number}`,
        ]),
      );
      const result = await resolveEpisodeDownloads({
        data: {
          title: titleOf(detail),
          type: "tv",
          tmdbId: id,
          year: yearOf(detail) || undefined,
          runtimeMinutes: detail.runtime ?? detail.episode_run_time?.[0],
          seasonCount: detail.number_of_seasons,
          subjectId: subjectIdRef.current,
          episodes: episodeNumbers
            .sort((a, b) => a - b)
            .map((episode) => ({
              season: activeSeason,
              episode,
              label: episodeLabels.get(episode),
            })),
        },
      });
      subjectIdRef.current = result.subjectId;
      setPreparedData((current) => {
        if (replace) return result.downloads;
        const updates = new Map(result.downloads.map((download) => [download.episode, download]));
        return current.map((download) => updates.get(download.episode) ?? download);
      });
    } catch (error) {
      setPreparationError(messageFrom(error, "Download links could not be prepared."));
    } finally {
      setIsPreparing(false);
    }
  };

  const handlePrepare = () => prepareEpisodes(Array.from(selectedEpisodes), true);

  const chooseDownloadFolder = async () => {
    setFolderError("");
    const pickerWindow = window as DirectoryPickerWindow;
    const picker = pickerWindow.showDirectoryPicker;
    if (!picker) {
      setFolderCapability(
        folderDownloadCapability(window.isSecureContext, typeof picker === "function"),
      );
      return;
    }

    try {
      const root = await pickerWindow.showDirectoryPicker?.({
        id: "leethe-series-downloads",
        mode: "readwrite",
      });
      if (!root) throw new Error("The download folder could not be opened.");
      directoryRef.current = root;
      setFolderName(root.name || "Selected folder");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const message = messageFrom(error, "Folder access could not be opened.");
      setFolderError(
        /gesture|security|not allowed/i.test(message)
          ? "The browser could not open folder access. Try Chrome or Edge over HTTPS, or use the individual downloads below."
          : message,
      );
    }
  };

  const handleDownloadFolder = async (retryFailed = false) => {
    setFolderError("");
    if (!detail) return;
    const root = directoryRef.current;
    if (!root) {
      setFolderError("Choose a download folder before starting the queue.");
      return;
    }
    const queuedLinks = retryFailed ? failedFolderDownloads : downloadLinks;
    if (!queuedLinks.length) {
      setFolderError("Prepare at least one direct download before starting the queue.");
      return;
    }

    let failedCount = 0;
    try {
      const currentPermission = await root.queryPermission?.({ mode: "readwrite" });
      if (currentPermission && currentPermission !== "granted") {
        const requestedPermission = await root.requestPermission?.({ mode: "readwrite" });
        if (requestedPermission !== "granted") {
          throw new Error("Folder access was not granted.");
        }
      }
      const directory = await root.getDirectoryHandle(seasonFolderName, { create: true });
      cancelRequestedRef.current = false;
      setIsDownloadingFolder(true);
      setDownloadProgress((current) => ({
        ...current,
        ...Object.fromEntries(
          queuedLinks.map((link) => [
            link.key,
            { bytes: 0, total: link.size || 0, status: "pending" as const },
          ]),
        ),
      }));

      for (const link of queuedLinks) {
        if (cancelRequestedRef.current) {
          setDownloadProgress((current) => ({
            ...current,
            [link.key]: { ...current[link.key], status: "cancelled" },
          }));
          continue;
        }
        let writable: WritableHandle | undefined;
        const controller = new AbortController();
        activeDownloadAbortRef.current = controller;
        setDownloadProgress((current) => ({
          ...current,
          [link.key]: { ...current[link.key], status: "downloading" },
        }));
        try {
          const filename = episodeDownloadFileName(
            titleOf(detail),
            link.season,
            link.episode,
            link.label,
            link.quality,
          );
          const file = await directory.getFileHandle(filename, { create: true });
          writable = await file.createWritable();
          const response = await fetch(link.url, { signal: controller.signal });
          if (!response.ok) throw new Error(`Download returned HTTP ${response.status}.`);
          if (!response.body) throw new Error("The download response had no body.");
          const contentLength = Number(response.headers.get("content-length") || link.size || 0);
          const reader = response.body.getReader();
          let bytes = 0;
          let lastProgressUpdate = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            bytes += value.byteLength;
            const now = Date.now();
            if (now - lastProgressUpdate >= 250) {
              lastProgressUpdate = now;
              setDownloadProgress((current) => ({
                ...current,
                [link.key]: {
                  ...current[link.key],
                  bytes,
                  total: contentLength || bytes,
                  status: "downloading",
                },
              }));
            }
          }
          await writable.close();
          recordClientEvent("download", {
            mediaType: "tv",
            tmdbId: id,
            season: link.season,
            episode: link.episode,
          });
          setDownloadProgress((current) => ({
            ...current,
            [link.key]: {
              ...current[link.key],
              bytes,
              total: contentLength || bytes,
              status: "completed",
            },
          }));
        } catch (error) {
          await writable?.abort?.().catch(() => undefined);
          const errorMessage = folderDownloadErrorMessage(error);
          const cancelled =
            cancelRequestedRef.current || (error instanceof Error && error.name === "AbortError");
          if (!cancelled) failedCount += 1;
          setDownloadProgress((current) => ({
            ...current,
            [link.key]: {
              ...current[link.key],
              status: cancelled ? "cancelled" : "error",
              error: cancelled ? "Cancelled" : errorMessage,
            },
          }));
        } finally {
          activeDownloadAbortRef.current = undefined;
        }
      }
      if (failedCount) {
        setFolderError(
          `${failedCount} episode${failedCount === 1 ? "" : "s"} could not be streamed into the folder. Use the individual download buttons below for those files.`,
        );
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setFolderError(messageFrom(error, "Folder download could not start."));
      }
    } finally {
      setIsDownloadingFolder(false);
    }
  };

  const cancelFolderDownload = () => {
    cancelRequestedRef.current = true;
    activeDownloadAbortRef.current?.abort();
  };

  const recordDirectDownload = (download: DownloadLink) => {
    recordClientEvent("download", {
      mediaType: "tv",
      tmdbId: id,
      season: download.season,
      episode: download.episode,
    });
  };

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen p-10 text-center text-muted-foreground">Loading series...</div>
    );
  }

  if (detailQuery.error || !detail) {
    return (
      <div className="min-h-screen p-10 text-center text-muted-foreground">
        <p>Series details could not be loaded.</p>
        <button
          type="button"
          onClick={() => detailQuery.refetch()}
          className="btn-aqua btn-aqua-interactive mt-3 rounded-full px-4 py-1.5 text-[11px]"
        >
          Retry
        </button>
      </div>
    );
  }

  const title = titleOf(detail);

  return (
    <div className="min-h-screen bg-[oklch(0.12_0.005_250)]">
      <header className="nav-aluminum brushed sticky top-0 z-50">
        <div className="mx-auto flex h-12 max-w-[1280px] items-center gap-3 px-3 sm:px-4">
          <Link
            to="/title/$type/$id"
            params={{ type: "tv", id }}
            className="chip-pill chip-pill-interactive inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px]"
          >
            Back to title
          </Link>
          <div className="ml-1 flex items-center gap-1.5">
            <MediaGlyph className="h-5 w-5 text-primary/80" />
            <span className="text-[14px] font-semibold text-foreground/95">Download center</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] animate-fade-in px-4 py-8">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mb-6 mt-1 text-[12px] text-muted-foreground">
          Select episodes, prepare direct files, then choose a folder or download episodes one at a
          time. HLS-only episodes cannot be saved as MP4 files.
        </p>

        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <section>
            <div className="mb-4 flex flex-wrap gap-2">
              {seasons.map((season) => (
                <button
                  type="button"
                  key={season.id}
                  onClick={() => changeSeason(season.season_number)}
                  disabled={busy}
                  aria-pressed={activeSeason === season.season_number}
                  className={`chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[11px] disabled:cursor-wait disabled:opacity-50 ${
                    activeSeason === season.season_number ? "chip-pill-active" : ""
                  }`}
                >
                  {season.name}
                </button>
              ))}
            </div>

            <div className="panel-aluminum rounded-md p-4">
              <div className="mb-4 flex items-center justify-between border-b border-[var(--aluminum-line)] pb-3">
                <h2 className="text-[14px] font-medium text-foreground">Episodes</h2>
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={!episodes.length || busy}
                  className="text-[11px] text-primary/80 transition-colors hover:text-primary disabled:opacity-40"
                >
                  {selectedEpisodes.size === episodes.length && episodes.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>

              {seasonQuery.error ? (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  <p>Episodes could not be loaded.</p>
                  <button
                    type="button"
                    onClick={() => seasonQuery.refetch()}
                    className="btn-aqua btn-aqua-interactive mt-3 rounded-full px-3 py-1 text-[11px]"
                  >
                    Retry
                  </button>
                </div>
              ) : seasonQuery.isLoading ? (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  Loading season...
                </div>
              ) : episodes.length ? (
                <ul className="space-y-1">
                  {episodes.map((episode) => (
                    <li key={episode.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded p-2 transition-colors hover:bg-white/5">
                        <input
                          type="checkbox"
                          checked={selectedEpisodes.has(episode.episode_number)}
                          onChange={() => toggleEpisode(episode.episode_number)}
                          disabled={busy}
                          className="h-4 w-4 rounded border border-[oklch(0.2_0.005_250)] bg-black/20 text-primary focus:ring-primary/50 disabled:cursor-wait disabled:opacity-50"
                        />
                        <span className="text-[12px] font-medium text-foreground/90">
                          {episode.episode_number}.{" "}
                          {episode.name || `Episode ${episode.episode_number}`}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  No episodes are available for this season.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="panel-aluminum sticky top-16 rounded-md p-4">
              <h2 className="mb-1 text-[13px] font-medium text-foreground">Download selected</h2>
              <p className="mb-4 text-[11px] text-muted-foreground">
                {selectedEpisodes.size} episode{selectedEpisodes.size === 1 ? "" : "s"} selected
              </p>

              <div className="mb-4 rounded-md border border-[var(--aluminum-line)] bg-black/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-medium text-foreground/90">Folder downloads</h3>
                  <span
                    className={`text-[9px] font-medium uppercase tracking-wide ${
                      folderCapability === "available" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {folderCapability === "checking"
                      ? "Checking"
                      : folderCapability === "available"
                        ? "Available"
                        : "Individual only"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  {folderCapability === "available"
                    ? "Choose a root folder after preparing links. Leethe creates a season folder inside it."
                    : folderCapability === "insecure"
                      ? "Folder access requires HTTPS. Individual episode downloads still work."
                      : folderCapability === "unsupported"
                        ? "This browser does not offer folder access. Use the individual episode downloads."
                        : "Checking whether this browser supports folder access..."}
                </p>
              </div>

              {!preparedData.length ? (
                <button
                  type="button"
                  onClick={handlePrepare}
                  disabled={selectedEpisodes.size === 0 || isPreparing}
                  className="btn-aqua btn-aqua-interactive w-full rounded-md py-2 text-[12px] font-medium disabled:opacity-50"
                >
                  {isPreparing ? "Preparing links..." : "Prepare links"}
                </button>
              ) : (
                <div className="animate-fade-in space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[10px] text-muted-foreground">
                        Preferred quality
                      </div>
                      <SelectMenu
                        label=""
                        ariaLabel="Preferred download quality"
                        value={preferredQuality}
                        onChange={setPreferredQuality}
                        options={[
                          { value: "2160p", label: "4K" },
                          { value: "1080p", label: "1080p" },
                          { value: "720p", label: "720p" },
                          { value: "480p", label: "480p" },
                        ]}
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] text-muted-foreground">Preferred audio</div>
                      <SelectMenu
                        label=""
                        ariaLabel="Preferred download audio"
                        value={preferredAudio}
                        onChange={setPreferredAudio}
                        options={availableAudios.map((audio) => ({ value: audio, label: audio }))}
                      />
                    </div>
                  </div>

                  {downloadLinks.length ? (
                    <div className="space-y-3">
                      <div className="rounded-md border border-[var(--aluminum-line)] bg-black/15 p-3">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="font-medium text-foreground/90">
                            {downloadLinks.length} ready file
                            {downloadLinks.length === 1 ? "" : "s"}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDownloadBytes(downloadSize)}
                          </span>
                        </div>
                        {folderCapability === "available" ? (
                          <div className="mt-3 space-y-2">
                            {folderName ? (
                              <div className="rounded border border-primary/25 bg-primary/5 px-2.5 py-2">
                                <div className="text-[9px] uppercase tracking-wide text-primary/80">
                                  Destination
                                </div>
                                <div className="mt-0.5 break-words text-[10px] font-medium text-foreground/90">
                                  {folderName} / {seasonFolderName}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] leading-relaxed text-muted-foreground">
                                Choose where the new {seasonFolderName} folder should be created.
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={chooseDownloadFolder}
                              disabled={isDownloadingFolder}
                              className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[11px] font-medium disabled:opacity-50"
                            >
                              {folderName ? "Change folder" : "Choose download folder"}
                            </button>
                            {folderName ? (
                              <button
                                type="button"
                                onClick={() => handleDownloadFolder()}
                                disabled={isDownloadingFolder}
                                className="btn-aqua btn-aqua-interactive w-full rounded-md py-2 text-[12px] font-medium disabled:opacity-50"
                              >
                                {isDownloadingFolder
                                  ? "Downloading queue..."
                                  : `Download ${downloadLinks.length} to folder`}
                              </button>
                            ) : null}
                            {isDownloadingFolder ? (
                              <button
                                type="button"
                                onClick={cancelFolderDownload}
                                className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[11px] font-medium"
                              >
                                Cancel queue
                              </button>
                            ) : failedFolderDownloads.length ? (
                              <button
                                type="button"
                                onClick={() => handleDownloadFolder(true)}
                                className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[11px] font-medium"
                              >
                                Retry {failedFolderDownloads.length} failed or cancelled
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                            Folder access is unavailable here. Download one episode per click below;
                            your browser will handle each direct provider file separately.
                          </p>
                        )}
                      </div>

                      {nextManualDownload ? (
                        <div>
                          <a
                            href={nextManualDownload.url}
                            target="_blank"
                            rel="noreferrer"
                            download={episodeDownloadFileName(
                              title,
                              nextManualDownload.season,
                              nextManualDownload.episode,
                              nextManualDownload.label,
                              nextManualDownload.quality,
                            )}
                            onClick={() => {
                              recordDirectDownload(nextManualDownload);
                              setManualDownloadIndex((current) => current + 1);
                            }}
                            className="chip-pill chip-pill-interactive flex w-full items-center justify-center rounded-md py-2 text-[11px] font-medium"
                          >
                            Download next: {nextManualDownload.label}
                          </a>
                          <p className="mt-1 text-center text-[9px] text-muted-foreground">
                            File {manualDownloadIndex + 1} of {downloadLinks.length}. One click
                            avoids browser multi-download blocks.
                          </p>
                        </div>
                      ) : downloadLinks.length ? (
                        <p className="text-center text-[10px] text-muted-foreground">
                          All direct download links were opened. Use an episode button below to
                          retry a file.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-center text-[11px]">
                      No direct MP4 downloads are available for these episodes.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setPreparedData([]);
                      setDownloadProgress({});
                      setFolderError("");
                      subjectIdRef.current = undefined;
                    }}
                    disabled={busy}
                    className="chip-pill chip-pill-interactive w-full rounded-md py-1.5 text-[11px] font-medium disabled:cursor-wait disabled:opacity-50"
                  >
                    Clear prepared links
                  </button>

                  <div className="border-t border-[var(--aluminum-line)] pt-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Ready links ({downloadLinks.length})
                      </h3>
                      {Object.keys(downloadProgress).length ? (
                        <span aria-live="polite" className="text-[9px] text-muted-foreground">
                          {queueSummary.completed} done · {queueSummary.error} failed ·{" "}
                          {queueSummary.cancelled} cancelled
                        </span>
                      ) : null}
                    </div>
                    <ul className="max-h-[40vh] space-y-1.5 overflow-y-auto pr-2">
                      {downloadLinks.map((download) => {
                        const progress = downloadProgress[download.key];
                        const percent =
                          progress?.status === "completed"
                            ? 100
                            : progress?.total
                              ? Math.min(100, (progress.bytes / progress.total) * 100)
                              : 0;
                        return (
                          <li key={download.key}>
                            <a
                              href={download.url}
                              target="_blank"
                              rel="noreferrer"
                              download={episodeDownloadFileName(
                                title,
                                download.season,
                                download.episode,
                                download.label,
                                download.quality,
                              )}
                              onClick={() => recordDirectDownload(download)}
                              className="group flex items-center justify-between rounded border border-[oklch(0.2_0.005_250)] bg-black/20 px-2 py-1.5 transition-colors hover:bg-black/40"
                            >
                              <span className="flex flex-col">
                                <span className="text-[11px] font-medium text-foreground/90">
                                  {download.label}
                                </span>
                                <span className="text-[9px] text-muted-foreground">
                                  {download.audioLabel}
                                </span>
                              </span>
                              <span className="flex flex-col items-end">
                                <span className="text-[10px] font-medium text-primary">
                                  Download
                                </span>
                                <span className="text-[9px] text-muted-foreground">
                                  {download.quality}
                                </span>
                                {download.size ? (
                                  <span className="text-[9px] text-muted-foreground">
                                    {formatDownloadBytes(download.size)}
                                  </span>
                                ) : null}
                              </span>
                            </a>
                            {progress ? (
                              <div className="mt-1">
                                <div className="mb-0.5 flex justify-between text-[8px] text-muted-foreground">
                                  <span>
                                    {progress.status === "error"
                                      ? progress.error
                                      : progress.status === "cancelled"
                                        ? "Cancelled"
                                        : progress.status === "completed"
                                          ? "Done"
                                          : progress.status === "downloading"
                                            ? `${(progress.bytes / (1024 * 1024)).toFixed(1)} MB`
                                            : "Pending..."}
                                  </span>
                                  <span>{progress.total ? `${Math.round(percent)}%` : ""}</span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-black/40">
                                  <div
                                    className={`h-full transition-all duration-300 ${
                                      progress.status === "error"
                                        ? "bg-destructive"
                                        : progress.status === "cancelled"
                                          ? "bg-muted-foreground"
                                          : progress.status === "completed"
                                            ? "bg-[oklch(0.65_0.14_145)]"
                                            : "bg-primary"
                                    }`}
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {unavailableDownloads.length ? (
                    <div className="border-t border-[var(--aluminum-line)] pt-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-[10px] uppercase tracking-wider text-destructive">
                          Unavailable ({unavailableDownloads.length})
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            prepareEpisodes(
                              unavailableDownloads.map((download) => download.episode),
                              false,
                            )
                          }
                          disabled={isPreparing}
                          className="text-[10px] text-primary hover:text-primary/80 disabled:opacity-50"
                        >
                          {isPreparing ? "Retrying..." : "Retry unavailable"}
                        </button>
                      </div>
                      <ul className="max-h-32 space-y-1 overflow-y-auto text-[9px] text-muted-foreground">
                        {unavailableDownloads.map((download) => (
                          <li
                            key={`${download.season}:${download.episode}`}
                            className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5"
                          >
                            <span className="font-medium text-foreground/80">{download.label}</span>
                            <span className="ml-1">
                              · {download.error || "No direct MP4 source"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}

              {preparationError ? (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px]"
                >
                  {preparationError}
                </div>
              ) : null}
              {folderError ? (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px]"
                >
                  {folderError}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
