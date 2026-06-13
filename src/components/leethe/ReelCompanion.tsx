import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { title, year, type MediaType, type TmdbItem } from "@/lib/tmdb";

const QUOTES = [
  "Build the thing you wish already existed.",
  "Good stories make time disappear.",
  "Curiosity is a better remote control.",
  "One clear next step beats ten perfect plans.",
  "The right movie can reset an entire evening.",
];

type SpriteState = "idle" | "waving" | "waiting" | "running" | "review";

function nextIndex(current: number, length: number) {
  if (length < 2) return 0;
  const next = Math.floor(Math.random() * (length - 1));
  return next >= current ? next + 1 : next;
}

export function ReelCompanion({ items, type }: { items: TmdbItem[]; type: MediaType }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<Date>();
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [spriteState, setSpriteState] = useState<SpriteState>("idle");
  const animationTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (animationTimer.current) window.clearTimeout(animationTimer.current);
    },
    [],
  );

  const animate = (state: SpriteState) => {
    if (animationTimer.current) window.clearTimeout(animationTimer.current);
    setSpriteState(state);
    animationTimer.current = window.setTimeout(() => setSpriteState("idle"), 1800);
  };

  const togglePanel = () => {
    setOpen((current) => !current);
    animate("waving");
  };

  const suggestion = items[suggestionIndex % Math.max(items.length, 1)];
  const date = now?.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const time = now?.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <aside className="reel-companion" aria-label="Reel movie companion">
      {open ? (
        <div
          className="reel-companion-panel panel-aluminum brushed"
          role="dialog"
          aria-label="Reel utilities"
        >
          <div className="reel-companion-titlebar nav-aluminum">
            <div>
              <div className="text-[12px] font-semibold text-foreground">Reel</div>
              <div className="text-[9px] text-muted-foreground">
                movie companion / local utility
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="chip-pill chip-pill-interactive h-6 rounded-full px-2 text-[10px]"
              aria-label="Close Reel"
            >
              close
            </button>
          </div>

          <div className="space-y-2.5 p-3">
            <div className="reel-readout">
              <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                local time
              </div>
              <div className="mt-1 font-mono text-[22px] leading-none text-[oklch(0.84_0.14_210)]">
                {time ?? "--:--:--"}
              </div>
              <div className="mt-1 text-[10px] text-foreground/65">
                {date ?? "Checking clock..."}
              </div>
            </div>

            <div className="reel-readout">
              <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                signal
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">
                &quot;{QUOTES[quoteIndex]}&quot;
              </p>
            </div>

            {suggestion ? (
              <div className="reel-readout">
                <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  Reel&apos;s pick
                </div>
                <Link
                  to="/title/$type/$id"
                  params={{ type, id: String(suggestion.id) }}
                  className="mt-1 block text-[12px] font-semibold text-[oklch(0.84_0.14_210)] hover:text-white"
                  onClick={() => animate("review")}
                >
                  {title(suggestion)}
                  {year(suggestion) ? ` (${year(suggestion)})` : ""}
                </Link>
                <div className="mt-0.5 text-[9px] text-muted-foreground">
                  {suggestion.vote_average
                    ? `${suggestion.vote_average.toFixed(1)} rating from this shelf`
                    : "picked from this shelf"}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuoteIndex((current) => nextIndex(current, QUOTES.length));
                  animate("waiting");
                }}
                className="chip-pill chip-pill-interactive rounded-full px-3 py-1.5 text-[10px]"
              >
                New quote
              </button>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => {
                  setSuggestionIndex((current) => nextIndex(current, items.length));
                  animate("review");
                }}
                className="btn-aqua btn-aqua-interactive rounded-full px-3 py-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Suggest a title
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="reel-companion-launcher">
        <button
          type="button"
          onClick={togglePanel}
          className="reel-companion-button focus-ring focus-ring-visible"
          aria-label={`${open ? "Close" : "Open"} Reel utilities`}
          aria-expanded={open}
          title={`${open ? "Close" : "Open"} Reel`}
        >
          <span className={`reel-sprite reel-sprite-${spriteState}`} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
