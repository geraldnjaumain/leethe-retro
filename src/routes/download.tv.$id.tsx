import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { TopBar } from "@/components/leethe/Nav"; // Suppose I need to import TopBar, or I'll just write an inline header
import { fetchDetail, fetchSeason, title as titleOf, year as yearOf, still } from "@/lib/tmdb";
import {
  resolveEpisodeDownloads,
  resolveWatchStreams,
} from "@/lib/stream";
import { LogoDot } from "@/components/leethe/Nav";
import { SelectMenu } from "@/components/leethe/SelectMenu";

export const Route = createFileRoute("/download/tv/$id")({
  head: () => ({ meta: [{ title: "Leethe - Download Series" }] }),
  component: DownloadTvPage,
});

function DownloadTvPage() {
  const { id } = useParams({ from: "/download/tv/$id" });
  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["detail", "tv", id],
    queryFn: () => fetchDetail("tv", id),
  });

  const seasons = (detail?.seasons ?? []).filter((s) => s.season_number > 0);
  const [activeSeason, setActiveSeason] = useState<number>(1);

  // Try to set first available season when data loads
  if (seasons.length > 0 && activeSeason === 1 && seasons[0].season_number !== 1) {
    setActiveSeason(seasons[0].season_number);
  }

  const { data: seasonData, isLoading: isLoadingSeason } = useQuery({
    queryKey: ["season", id, activeSeason],
    enabled: Boolean(activeSeason),
    queryFn: () => fetchSeason(id, activeSeason),
  });

  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set());
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparedData, setPreparedData] = useState<Record<string, unknown>[]>([]);
  const [preferredQuality, setPreferredQuality] = useState<string>("1080p");
  const [preferredAudio, setPreferredAudio] = useState<string>("Any");
  
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { bytes: number, total: number, status: 'pending' | 'downloading' | 'completed' | 'error', error?: string }>>({});
  const [isDownloadingFolder, setIsDownloadingFolder] = useState(false);

  const episodes = seasonData?.episodes ?? [];

  const availableAudios = useMemo(() => {
    const audios = new Set<string>();
    for (const ep of preparedData) {
      if (!ep.options) continue;
      for (const opt of ep.options as any[]) {
        if (opt.audioLabel) audios.add(opt.audioLabel);
      }
    }
    return ["Any", ...Array.from(audios).filter(a => a !== "Default")];
  }, [preparedData]);

  const downloadLinks = useMemo(() => {
    return preparedData.map((ep: any) => {
      if (!ep.success || !ep.options?.length) return null;
      let opts = ep.options;
      if (preferredAudio !== "Any") {
        const filtered = opts.filter((o: any) => o.audioLabel === preferredAudio || (preferredAudio === "Default" && !o.audioLabel));
        if (filtered.length > 0) opts = filtered;
      }
      const match = opts.find((o: any) => o.quality === preferredQuality) || opts[0];
      return { 
        label: ep.label, 
        url: match.url, 
        audioLabel: match.audioLabel || "Default", 
        quality: match.quality, 
        size: match.size 
      };
    }).filter(Boolean);
  }, [preparedData, preferredQuality, preferredAudio]);

  const toggleEpisode = (ep: number) => {
    const next = new Set(selectedEpisodes);
    if (next.has(ep)) next.delete(ep);
    else next.add(ep);
    setSelectedEpisodes(next);
  };

  const selectAll = () => {
    if (selectedEpisodes.size === episodes.length) {
      setSelectedEpisodes(new Set());
    } else {
      setSelectedEpisodes(new Set(episodes.map((e) => e.episode_number)));
    }
  };

  const handlePrepare = async () => {
    if (!detail || selectedEpisodes.size === 0) return;
    setIsPreparing(true);
    setPreparedData([]);
    try {
      // Fetch the exact provider subjectId using the first selected episode
      // This mirrors the watch page's behavior and prevents search misses
      const firstEp = Array.from(selectedEpisodes)[0];
      const watchResult = await resolveWatchStreams({
        data: {
          title: titleOf(detail),
          type: "tv",
          tmdbId: id,
          year: yearOf(detail)?.toString(),
          season: activeSeason,
          episode: firstEp,
          runtimeMinutes: detail.runtime ?? detail.episode_run_time?.[0],
          seasonCount: detail.number_of_seasons,
        }
      }).catch(() => null);

      const result = await resolveEpisodeDownloads({
        data: {
          title: titleOf(detail),
          type: "tv",
          tmdbId: id,
          year: yearOf(detail)?.toString(),
          runtimeMinutes: detail.runtime ?? detail.episode_run_time?.[0],
          seasonCount: detail.number_of_seasons,
          subjectId: watchResult?.subjectId,
          episodes: Array.from(selectedEpisodes).map((ep) => ({
            season: activeSeason,
            episode: ep,
          })),
        },
      });
      setPreparedData(result.downloads);
    } catch (err) {
      console.error(err);
    } finally {
      setIsPreparing(false);
    }
  };

  const handleDownloadAll = () => {
    if (downloadLinks.length === 0) return;
    downloadLinks.forEach((link, index) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = link.url;
        a.target = "_blank";
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 800);
    });
  };

  const handleDownloadFolder = async () => {
    try {
      console.log("Download folder button clicked!");
      if (!('showDirectoryPicker' in window)) {
        alert("Your browser does not support Native Folder Downloads. Please use a Chromium-based browser (Chrome, Edge, Brave).");
        return;
      }

      if (downloadLinks.length === 0) {
        alert("No links ready to download!");
        return;
      }

      const safeTitle = (t || "Series").replace(/[^a-zA-Z0-9 ]/g, '');
      const folderName = `${safeTitle} Season ${activeSeason}`.trim();

      const dirHandle = await (window as any).showDirectoryPicker();
      const seriesDirHandle = await dirHandle.getDirectoryHandle(folderName, { create: true });

      setIsDownloadingFolder(true);
      
      const initialProgress: Record<string, any> = {};
      downloadLinks.forEach(link => {
        initialProgress[link.url] = { bytes: 0, total: link.size || 0, status: 'pending' };
      });
      setDownloadProgress(initialProgress);

      for (let i = 0; i < downloadLinks.length; i++) {
        const link = downloadLinks[i];
        const epNum = String(i + 1).padStart(2, '0');
        const safeLabel = (link.label || "").replace(/[^a-zA-Z0-9 -]/g, '').trim();
        const filename = `${epNum} - ${safeLabel} [${link.quality}].mp4`;

        setDownloadProgress(prev => ({ ...prev, [link.url]: { ...prev[link.url], status: 'downloading' } }));

        try {
          const fileHandle = await seriesDirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();

          const response = await fetch(link.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const contentLength = response.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : link.size || 0;
          
          if (!response.body) throw new Error("No response body");

          const reader = response.body.getReader();
          let bytesLoaded = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            bytesLoaded += value.length;
            
            if (bytesLoaded % (1024 * 1024) < value.length || bytesLoaded === total) {
              setDownloadProgress(prev => ({
                ...prev,
                [link.url]: { ...prev[link.url], bytes: bytesLoaded, total: total || bytesLoaded }
              }));
            }
          }

          await writable.close();
          setDownloadProgress(prev => ({ ...prev, [link.url]: { ...prev[link.url], status: 'completed' } }));

        } catch (err: any) {
          console.error("Error downloading", link.url, err);
          let errorMessage = err.message;
          if (err.name === 'TypeError' && err.message.includes('fetch')) {
             errorMessage = "CORS blocked direct download.";
          }
          setDownloadProgress(prev => ({ ...prev, [link.url]: { ...prev[link.url], status: 'error', error: errorMessage } }));
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        alert("Action failed: " + err.message + "\nStack: " + err.stack);
        console.error(err);
      }
    } finally {
      setIsDownloadingFolder(false);
    }
  };

  if (isLoadingDetail) {
    return <div className="min-h-screen text-center p-10 text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return (
      <div className="min-h-screen text-center p-10 text-muted-foreground">Series not found</div>
    );
  }

  const t = titleOf(detail);

  return (
    <div className="min-h-screen bg-[oklch(0.12_0.005_250)]">
      <header className="nav-aluminum brushed sticky top-0 z-50">
        <div className="mx-auto flex h-12 max-w-[1280px] items-center gap-3 px-3 sm:px-4">
          <Link
            to="/title/$type/$id"
            params={{ type: "tv", id }}
            className="chip-pill chip-pill-interactive inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px]"
          >
            Back to Title
          </Link>
          <div className="ml-1 flex items-center gap-1.5">
            <LogoDot />
            <span className="text-[14px] font-semibold text-foreground/95">Download Center</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-4 py-8 animate-fade-in">
        <h1 className="text-[24px] font-semibold text-foreground tracking-tight">{t}</h1>
        <p className="text-[12px] text-muted-foreground mt-1 mb-6">
          Select episodes to mass download.
        </p>

        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <section>
            <div className="flex gap-2 flex-wrap mb-4">
              {seasons.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveSeason(s.season_number);
                    setSelectedEpisodes(new Set());
                    setPreparedData([]);
                  }}
                  className={`chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[11px] ${
                    activeSeason === s.season_number ? "chip-pill-active" : ""
                  }`}
                >
                  Season {s.season_number}
                </button>
              ))}
            </div>

            <div className="panel-aluminum rounded-md p-4">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--aluminum-line)]">
                <h2 className="text-[14px] font-medium text-foreground">Episodes</h2>
                <button
                  onClick={selectAll}
                  className="text-[11px] text-primary/80 hover:text-primary transition-colors"
                >
                  {selectedEpisodes.size === episodes.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              {isLoadingSeason ? (
                <div className="text-center py-6 text-[12px] text-muted-foreground">
                  Loading season...
                </div>
              ) : (
                <ul className="space-y-1">
                  {episodes.map((ep) => (
                    <li key={ep.id}>
                      <label className="flex items-center gap-3 p-2 rounded hover:bg-white/5 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedEpisodes.has(ep.episode_number)}
                          onChange={() => toggleEpisode(ep.episode_number)}
                          className="w-4 h-4 rounded border-[oklch(0.2_0.005_250)] text-primary focus:ring-primary/50 bg-black/20"
                        />
                        <div className="text-[12px] font-medium text-foreground/90">
                          {ep.episode_number}. {ep.name}
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="panel-aluminum rounded-md p-4 sticky top-16">
              <h2 className="text-[13px] font-medium text-foreground mb-1">Download Selected</h2>
              <p className="text-[11px] text-muted-foreground mb-4">
                {selectedEpisodes.size} episode{selectedEpisodes.size === 1 ? "" : "s"} selected
              </p>

              {preparedData.length === 0 ? (
                <button
                  onClick={handlePrepare}
                  disabled={selectedEpisodes.size === 0 || isPreparing}
                  className="w-full btn-aqua btn-aqua-interactive rounded-md py-2 text-[12px] font-medium disabled:opacity-50"
                >
                  {isPreparing ? "Preparing Links..." : "Prepare Links"}
                </button>
              ) : (
                <div className="space-y-4 animate-fade-in">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">
                        Preferred Quality
                      </label>
                      <SelectMenu
                        label=""
                        value={preferredQuality}
                        onChange={setPreferredQuality}
                        direction="down"
                        options={[
                          { value: "2160p", label: "4K" },
                          { value: "1080p", label: "1080p" },
                          { value: "720p", label: "720p" },
                          { value: "480p", label: "480p" },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">
                        Preferred Audio
                      </label>
                      <SelectMenu
                        label=""
                        value={preferredAudio}
                        onChange={setPreferredAudio}
                        direction="down"
                        options={availableAudios.map(a => ({ value: a, label: a }))}
                      />
                    </div>
                  </div>
                  
                  {downloadLinks.length > 0 ? (
                    <div className="flex gap-2">
                      <button
                        onClick={handleDownloadFolder}
                        disabled={isDownloadingFolder}
                        className="flex-1 btn-aqua btn-aqua-interactive rounded-md py-2 text-[12px] font-medium disabled:opacity-50"
                        title="Download the selected episodes as an organized folder"
                      >
                        {isDownloadingFolder ? "Downloading..." : "Download as Folder"}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] p-3 rounded-md text-center">
                      <p className="font-semibold mb-1">No direct downloads available.</p>
                      <p className="text-muted-foreground">These episodes use chunked streaming (HLS/m3u8), which can be played in the browser but cannot be downloaded as a single MP4 file.</p>
                    </div>
                  )}

                  <button
                    onClick={() => setPreparedData([])}
                    className="w-full chip-pill chip-pill-interactive rounded-md py-1.5 text-[11px] font-medium"
                  >
                    Reset
                  </button>

                  <div className="mt-4 pt-4 border-t border-[var(--aluminum-line)]">
                    <h3 className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                      Ready Links ({downloadLinks.length})
                    </h3>
                    <ul className="space-y-1.5 overflow-y-auto max-h-[40vh] pr-2 scrollbar-thin">
                      {downloadLinks.map((d: any, i: number) => (
                        <li key={i}>
                          <a 
                            href={d.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between px-2 py-1.5 rounded bg-black/20 hover:bg-black/40 border border-[oklch(0.2_0.005_250)] transition-colors group"
                          >
                            <div className="flex flex-col">
                              <span className="text-[11px] font-medium text-foreground/90">{d.label}</span>
                              <span className="text-[9px] text-muted-foreground">{d.audioLabel}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] text-primary group-hover:text-aqua transition-colors">{d.quality}</span>
                              {d.size && <span className="text-[9px] text-muted-foreground">{(d.size / (1024 * 1024)).toFixed(1)} MB</span>}
                            </div>
                          </a>
                          {downloadProgress[d.url] ? (
                            <div className="mt-1">
                              <div className="flex justify-between text-[8px] text-muted-foreground mb-0.5">
                                <span>
                                  {downloadProgress[d.url].status === 'error' ? downloadProgress[d.url].error :
                                   downloadProgress[d.url].status === 'completed' ? 'Done' :
                                   downloadProgress[d.url].status === 'downloading' ? `${(downloadProgress[d.url].bytes / (1024 * 1024)).toFixed(1)} MB` : 'Pending...'}
                                </span>
                                <span>
                                  {downloadProgress[d.url].total ? `${Math.round((downloadProgress[d.url].bytes / downloadProgress[d.url].total) * 100)}%` : ''}
                                </span>
                              </div>
                              <div className="w-full bg-black/40 rounded-full h-1 overflow-hidden">
                                <div 
                                  className={`h-full ${downloadProgress[d.url].status === 'error' ? 'bg-red-500' : downloadProgress[d.url].status === 'completed' ? 'bg-green-500' : 'bg-primary'} transition-all duration-300`}
                                  style={{ width: `${downloadProgress[d.url].total ? (downloadProgress[d.url].bytes / downloadProgress[d.url].total) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                      {preparedData.length > downloadLinks.length && (
                        <li className="px-2 py-1 text-[10px] text-red-400">
                          {preparedData.length - downloadLinks.length} episodes unavailable
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
