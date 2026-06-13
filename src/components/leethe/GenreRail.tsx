import { useQuery } from "@tanstack/react-query";
import { useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { fetchGenres, type MediaType } from "@/lib/tmdb";

export function GenreRail({
  type,
  active,
  onChange,
}: {
  type: MediaType;
  active: number | undefined;
  onChange: (g: number | undefined) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const { data: genres = [] } = useQuery({
    queryKey: ["genres", type],
    queryFn: () => fetchGenres(type),
    staleTime: 1000 * 60 * 60,
  });

  const activeGenre = genres.find((g) => g.id === active);
  const activeLabel = activeGenre?.name ?? (active ? "Selected genre" : "All");
  const scroll = (dir: -1 | 1) =>
    scroller.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  return (
    <div className="brushed sticky top-[108px] z-40 animate-fade-in border-b border-[var(--aluminum-line)] bg-gradient-to-b from-[oklch(0.22_0.006_250)] to-[oklch(0.16_0.006_250)] shadow-[0_4px_12px_oklch(0_0_0/0.35)] sm:top-[38.667px]">
      <div className="mx-auto flex h-[52px] max-w-[1200px] items-center gap-2 px-2 sm:h-10 sm:px-3">
        <RailBtn onClick={() => scroll(-1)} aria-label="Scroll genres left">
          <Chevron dir="left" />
        </RailBtn>

        <div
          ref={scroller}
          className="scrollbar-none flex flex-1 items-center gap-1.5 overflow-x-auto scroll-smooth"
        >
          <Chip active={active === undefined} onClick={() => onChange(undefined)}>
            All
          </Chip>
          {genres.map((g, i) => (
            <Chip
              key={g.id}
              active={active === g.id}
              onClick={() => onChange(active === g.id ? undefined : g.id)}
              style={{ animationDelay: `${i * 18}ms` }}
            >
              {g.name}
            </Chip>
          ))}
        </div>

        <RailBtn onClick={() => scroll(1)} aria-label="Scroll genres right">
          <Chevron dir="right" />
        </RailBtn>

        <div aria-live="polite" className="sr-only">
          Showing {activeLabel}
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={style}
      className={[
        "chip-pill chip-pill-interactive animate-fade-up inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-[13px] font-medium sm:h-auto sm:px-2.5 sm:py-0.5 sm:text-[11px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--aluminum-line)]",
        active ? "chip-pill-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {active && <CheckGlyph className="h-3 w-3 text-primary sm:h-2.5 sm:w-2.5" />}
      <span>{children}</span>
    </button>
  );
}

function RailBtn({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="hidden h-10 w-10 shrink-0 place-items-center rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.32_0.008_250)] to-[oklch(0.2_0.008_250)] text-foreground/80 shadow-[0_1px_0_oklch(1_0_0/0.12)_inset,0_1px_1px_oklch(0_0_0/0.5)] transition-all duration-200 hover:text-foreground hover:from-[oklch(0.36_0.008_250)] hover:to-[oklch(0.24_0.008_250)] active:translate-y-px active:shadow-[0_2px_4px_oklch(0_0_0/0.5)_inset] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] md:grid md:h-6 md:w-6"
    >
      {children}
    </button>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-4 w-4 sm:h-2.5 sm:w-2.5"
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
