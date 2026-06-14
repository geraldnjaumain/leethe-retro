import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { searchTitles, title, type DiscoverSort, type MediaType } from "@/lib/tmdb";
import { MediaGlyph } from "@/components/leethe/VisualAssets";

const TITLE_SEEDS: Record<MediaType, string[]> = {
  movie: [
    "Avatar",
    "Avengers: Endgame",
    "Back to the Future",
    "Blade Runner 2049",
    "Dune",
    "Fight Club",
    "Inception",
    "Interstellar",
    "John Wick",
    "Jurassic Park",
    "Mad Max: Fury Road",
    "Oppenheimer",
    "Pulp Fiction",
    "Spider-Man: Across the Spider-Verse",
    "The Dark Knight",
    "The Godfather",
    "The Matrix",
    "Titanic",
    "Top Gun: Maverick",
  ],
  tv: [
    "Arcane",
    "Better Call Saul",
    "Breaking Bad",
    "Game of Thrones",
    "House of the Dragon",
    "One Piece",
    "Peaky Blinders",
    "Rick and Morty",
    "Stranger Things",
    "The Bear",
    "The Boys",
    "The Last of Us",
    "The Mandalorian",
    "The Office",
    "The Witcher",
  ],
};

export function Nav({
  type,
  onTypeChange,
  sort,
  onSortChange,
  query,
  onQueryChange,
  activeTab,
}: {
  type: MediaType;
  onTypeChange: (t: MediaType) => void;
  sort: DiscoverSort;
  onSortChange: (s: DiscoverSort) => void;
  query?: string;
  onQueryChange?: (q: string) => void;
  activeTab?: "movie" | "tv" | "sports";
}) {
  const rawQuery = query ?? "";
  const lookupQuery = rawQuery.trim();
  const [debouncedLookupQuery, setDebouncedLookupQuery] = useState(lookupQuery);
  const [dismissedCompletionFor, setDismissedCompletionFor] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedLookupQuery(lookupQuery), 250);
    return () => window.clearTimeout(timer);
  }, [lookupQuery]);
  const autocompleteQuery = useQuery({
    queryKey: ["title-autocomplete", type, debouncedLookupQuery],
    queryFn: () => searchTitles(type, debouncedLookupQuery, 1),
    enabled: debouncedLookupQuery.length >= 2,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    select: (page) => page.results.map(title),
  });
  const completion = useMemo(() => {
    const dynamicTitles = autocompleteQuery.data ?? [];
    const seen = new Set<string>();
    const suggestions = [...TITLE_SEEDS[type], ...dynamicTitles].filter((candidate) => {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (dismissedCompletionFor === rawQuery) return null;
    return getInlineCompletion(rawQuery, suggestions);
  }, [autocompleteQuery.data, dismissedCompletionFor, rawQuery, type]);

  const updateSearch = (nextQuery: string) => {
    if (dismissedCompletionFor && dismissedCompletionFor !== nextQuery) {
      setDismissedCompletionFor("");
    }
    onQueryChange?.(nextQuery);
  };

  const acceptCompletion = () => {
    if (!completion) return false;
    updateSearch(completion.value);
    return true;
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && completion) {
      setDismissedCompletionFor(rawQuery);
      return;
    }

    if (event.key === "Tab" && !event.shiftKey && acceptCompletion()) {
      event.preventDefault();
      return;
    }

    if (event.key !== "ArrowRight") return;
    const input = event.currentTarget;
    const caretAtEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if (caretAtEnd && acceptCompletion()) {
      event.preventDefault();
    }
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateSearch(event.target.value);
  };

  return (
    <header className="nav-aluminum brushed sticky top-0 z-50 animate-fade-in">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5 sm:min-h-[38px] sm:flex-nowrap sm:gap-3 sm:px-3 sm:py-0">
        <Link
          to="/"
          className="group flex h-10 shrink-0 items-center rounded-md px-1.5 outline-none transition-colors duration-200 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.55)] sm:h-auto sm:py-0.5"
        >
          <MediaGlyph className="h-6 w-6 text-primary" />
        </Link>

        <div
          className={`flex shrink-0 items-center gap-1 sm:gap-2 ${activeTab === "sports" ? "hidden" : ""}`}
          role="group"
          aria-label="Discovery mode"
        >
          <SegBtn active={sort === "popular"} onClick={() => onSortChange("popular")}>
            <SparkGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
            <span className="hidden md:inline">Popular</span>
          </SegBtn>
          <SegBtn active={sort === "new"} onClick={() => onSortChange("new")}>
            <ClockMiniGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
            <span className="hidden md:inline">New</span>
          </SegBtn>
          <SegBtn active={sort === "rated"} onClick={() => onSortChange("rated")}>
            <StarMiniGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
            <span className="hidden md:inline">Rated</span>
          </SegBtn>
        </div>

        <div
          className={`order-last flex basis-full grow-0 justify-center sm:order-none sm:basis-auto sm:flex-1 sm:grow ${activeTab === "sports" ? "hidden" : ""}`}
        >
          <label className="search-field group flex h-11 w-full items-center gap-2 px-3 transition-all duration-200 sm:h-[26px] sm:max-w-[360px] sm:gap-1.5 sm:px-2">
            <MagnifierGlyph className="h-4 w-4 text-muted-foreground transition-colors duration-200 group-focus-within:text-foreground/90 sm:h-3 sm:w-3" />
            <span className="relative min-w-0 flex-1">
              {completion ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-[14px] leading-none sm:text-[11px]"
                >
                  <span className="invisible whitespace-pre">{rawQuery}</span>
                  <span className="whitespace-pre text-muted-foreground/60">
                    {completion.suffix}
                  </span>
                </span>
              ) : null}
              <input
                type="search"
                aria-label="Search movies and series"
                placeholder="Search..."
                value={rawQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                spellCheck={false}
                className="relative z-10 w-full bg-transparent text-[14px] leading-none text-foreground caret-[oklch(0.76_0.15_235)] placeholder:text-muted-foreground/70 focus:outline-none sm:text-[11px]"
              />
            </span>
          </label>
        </div>

        <div
          className="ml-auto flex shrink-0 items-center rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.3_0.008_250)] to-[oklch(0.18_0.008_250)] p-[2px] shadow-[0_1px_0_oklch(1_0_0/0.1)_inset,0_1px_2px_oklch(0_0_0/0.5)] sm:ml-0"
          role="group"
          aria-label="Media type"
        >
          <SegBtn
            active={(activeTab || type) === "movie"}
            onClick={() => onTypeChange("movie")}
            ariaLabel="Movies"
          >
            <ReelGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
            <span className="hidden sm:inline">Movies</span>
          </SegBtn>
          <SegBtn
            active={(activeTab || type) === "tv"}
            onClick={() => onTypeChange("tv")}
            ariaLabel="Series"
          >
            <CrtGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
            <span className="hidden sm:inline">Series</span>
          </SegBtn>
          <Link to="/sports" aria-label="Sports" tabIndex={-1} className="outline-none">
            <SegBtn active={activeTab === "sports"} onClick={() => {}}>
              <SportsGlyph className="h-4 w-4 sm:h-[10px] sm:w-[10px]" />
              <span className="hidden sm:inline">Sports</span>
            </SegBtn>
          </Link>
        </div>
      </div>
    </header>
  );
}

function SegBtn({
  active,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={[
        "chip-pill-interactive flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-medium outline-none sm:h-auto sm:min-w-0 sm:justify-start sm:py-[1px]",
        "transition-all duration-200 active:translate-y-px",
        "focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.6)]",
        active
          ? "chip-pill-active"
          : "text-muted-foreground hover:text-foreground hover:bg-white/5 active:bg-white/3",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

export function MagnifierGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 L13.5 13.5" />
    </svg>
  );
}

export function ReelGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.2" />
      <rect x="3.2" y="4.2" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="3.2" y="6.4" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="3.2" y="8.6" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="3.2" y="10.8" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="11.4" y="4.2" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="11.4" y="6.4" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="11.4" y="8.6" width="1.4" height="1.4" fill="oklch(0 0 0)" />
      <rect x="11.4" y="10.8" width="1.4" height="1.4" fill="oklch(0 0 0)" />
    </svg>
  );
}

export function CrtGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="12" height="9" rx="1.5" />
      <path d="M5 2 L8 5 L11 2" strokeLinecap="round" />
      <path d="M11 8 L12 8" strokeLinecap="round" />
      <path d="M11 11 L12 11" strokeLinecap="round" />
    </svg>
  );
}

export function SportsGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M4.5 4.5 C7 7, 7 9, 4.5 11.5" />
      <path d="M11.5 4.5 C9 7, 9 9, 11.5 11.5" />
    </svg>
  );
}

function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M6 1.2 7 4.7l3.5 1.3L7 7.2 6 10.8 5 7.2 1.5 6 5 4.7z" />
    </svg>
  );
}

function ClockMiniGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.2" />
      <path d="M6 3.4v2.8l2 1.1" />
    </svg>
  );
}

function StarMiniGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <polygon points="6,1.2 7.5,4.6 11,4.9 8.3,7.2 9.2,10.6 6,8.8 2.8,10.6 3.7,7.2 1,4.9 4.5,4.6" />
    </svg>
  );
}

function getInlineCompletion(input: string, suggestions: string[]) {
  const query = input.trimStart();
  if (!query) return null;

  const leadingWhitespace = input.slice(0, input.length - query.length);
  const lowerQuery = query.toLocaleLowerCase();
  const match = suggestions.find((candidate) => {
    const cleanCandidate = candidate.trim();
    return (
      cleanCandidate.length > query.length &&
      cleanCandidate.toLocaleLowerCase().startsWith(lowerQuery)
    );
  });

  if (!match) return null;
  const value = `${leadingWhitespace}${match.trim()}`;
  return {
    value,
    suffix: value.slice(input.length),
  };
}
