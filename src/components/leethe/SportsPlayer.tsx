import { useEffect, useMemo, useRef, useState } from "react";
import type HlsType from "hls.js";
import { sportsPlaybackType } from "@/lib/sports-data";

export function SportsPlayer({
  url,
  title = "Sports stream",
  onClose,
}: {
  url: string;
  title?: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackType = useMemo(() => sportsPlaybackType(url), [url]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const player = videoRef.current;
    if (!player) return;
    let hls: HlsType | undefined;
    let cancelled = false;

    setLoading(true);
    setError("");

    const markReady = () => {
      if (!cancelled) setLoading(false);
    };
    const markFailed = () => {
      if (!cancelled) {
        setLoading(false);
        setError("This live source is temporarily unavailable.");
      }
    };
    player.addEventListener("loadeddata", markReady);
    player.addEventListener("error", markFailed);

    async function init(video: HTMLVideoElement) {
      if (!playbackType) {
        markFailed();
        return;
      }
      if (playbackType === "mp4" || video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.load();
        await video.play().catch(() => undefined);
        return;
      }

      const { default: Hls } = await import("hls.js");
      if (cancelled || !Hls.isSupported()) {
        markFailed();
        return;
      }
      hls = new Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        markReady();
        void video.play().catch(() => undefined);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) markFailed();
      });
    }

    void init(player).catch(markFailed);
    return () => {
      cancelled = true;
      player.removeEventListener("loadeddata", markReady);
      player.removeEventListener("error", markFailed);
      hls?.destroy();
      player.removeAttribute("src");
      player.load();
    };
  }, [playbackType, url]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/90 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="poster-card relative w-full max-w-5xl overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/10 animate-fade-up">
        <div className="nav-aluminum flex h-11 items-center justify-between border-b border-white/10 px-3">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-white/90">{title}</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/45">Live player</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sports player"
            className="chip-pill chip-pill-interactive grid h-7 w-7 place-items-center rounded-full text-white/80"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="relative aspect-video bg-black">
          <video ref={videoRef} controls className="h-full w-full bg-black" playsInline />
          {loading && !error ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/65">
              <div className="text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                <div className="mt-3 text-[12px] text-white/70">Connecting to live source...</div>
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="absolute inset-0 grid place-items-center bg-black/80 px-6 text-center">
              <div>
                <div className="text-[14px] font-semibold text-white">Stream unavailable</div>
                <p className="mt-1 text-[12px] text-white/60">{error}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
