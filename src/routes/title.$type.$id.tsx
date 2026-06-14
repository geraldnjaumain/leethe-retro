import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  backdrop,
  fetchCollection,
  fetchDetail,
  fetchSeason,
  fetchSimilar,
  poster,
  selectYoutubeTrailer,
  still,
  TmdbConfigError,
  title as titleOf,
  year as yearOf,
  type MediaType,
} from "@/lib/tmdb";
import { PosterCard, StarGlyph } from "@/components/leethe/PosterCard";
import {
  BrandMark,
  MediaGlyph,
  MediaPlaceholder,
  PersonPlaceholder,
} from "@/components/leethe/VisualAssets";

export const Route = createFileRoute("/title/$type/$id")({
  head: () => ({ meta: [{ title: "Leethe - Title" }] }),
  component: TitlePage,
});

/* ── Retro SVG icon set ───────────────────────────────────────── */

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

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <polygon points="2.5,1.5 10.5,6 2.5,10.5" />
    </svg>
  );
}

function ClockGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5 L6 6 L8 7.5" />
    </svg>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="9" height="8" rx="1" />
      <path d="M1.5 5h9" />
      <path d="M4 1.5 L4 3.5" />
      <path d="M8 1.5 L8 3.5" />
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

function XGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 2.5 L9.5 9.5" />
      <path d="M9.5 2.5 L2.5 9.5" />
    </svg>
  );
}

/* ── Page component ───────────────────────────────────────────── */

function TitlePage() {
  const { type, id } = useParams({ from: "/title/$type/$id" });
  const mediaType: MediaType = type === "tv" ? "tv" : "movie";
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["detail", mediaType, id],
    queryFn: () => fetchDetail(mediaType, id),
    staleTime: 1000 * 60 * 10,
  });
  const [trailerOpen, setTrailerOpen] = useState(false);
  const castRailRef = useRef<HTMLDivElement>(null);
  const scrollCastRail = (dir: -1 | 1) =>
    castRailRef.current?.scrollBy({ left: dir * 420, behavior: "smooth" });

  useEffect(() => {
    if (!data) return;
    const title = titleOf(data);
    const releaseYear = yearOf(data);
    document.title = `${title}${releaseYear ? ` (${releaseYear})` : ""} - Leethe`;
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <div className="mx-auto max-w-[1200px] px-4 py-6 space-y-4">
          <div className="skeleton h-[340px] w-full rounded-md" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[2/3] rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <div className="mx-auto max-w-[1200px] px-4 py-12 text-center">
          <div className="text-[13px] text-foreground/80">
            {error instanceof TmdbConfigError
              ? "TMDB access token is missing."
              : "Couldn't load that title."}
          </div>
          <button
            onClick={() => refetch()}
            className="btn-aqua btn-aqua-interactive mt-3 rounded-full px-4 py-1.5 text-[12px] font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const t = titleOf(data);
  const y = yearOf(data);
  const bg = backdrop(data.backdrop_path, "w1280");
  const ps = poster(data.poster_path, "w500");
  const runtime = data.runtime ?? data.episode_run_time?.[0];
  const trailer = selectYoutubeTrailer(data.videos?.results);

  return (
    <div className="min-h-screen">
      <TopBar />

      {/* Hero - Aperture/iTunes inspector panel */}
      <div className="mx-auto max-w-[1200px] px-3 pt-5 sm:px-4 sm:pt-6 animate-fade-in">
        <div className="brushed relative overflow-hidden rounded-md border border-[var(--aluminum-line)] shadow-[var(--shadow-card)]">
          {/* Faint backdrop wash */}
          {bg && (
            <div
              className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.18]"
              style={{ backgroundImage: `url(${bg})` }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[oklch(0.22_0.008_250)]/85 via-[oklch(0.2_0.008_250)]/95 to-[oklch(0.18_0.008_250)]" />

          <div className="relative flex flex-col gap-5 p-4 sm:flex-row sm:p-5">
            {/* Poster - heavy aluminum frame */}
            {ps && (
              <div className="animate-scale-in shrink-0 self-center sm:self-start">
                <div className="rounded-[6px] border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.34_0.008_250)] to-[oklch(0.22_0.008_250)] p-[3px] shadow-[0_1px_0_oklch(1_0_0/0.12)_inset,0_10px_22px_-10px_oklch(0_0_0/0.8)]">
                  <img
                    src={ps}
                    alt={t}
                    decoding="async"
                    className="block h-[260px] w-[174px] rounded-[3px] object-cover sm:h-[330px] sm:w-[220px]"
                  />
                </div>
              </div>
            )}

            {/* Info column */}
            <div className="flex min-w-0 max-w-[640px] flex-col gap-3 animate-fade-up">
              <div className="text-[10px] text-muted-foreground">
                {mediaType === "movie" ? "Feature film" : "Television series"}
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[32px]">
                {t}
                {y && <span className="ml-2 text-foreground/45 font-light">({y})</span>}
              </h1>

              {data.tagline && (
                <div className="text-[12px] italic text-muted-foreground border-l-2 border-[oklch(0.55_0.14_245)]/60 pl-2">
                  "{data.tagline}"
                </div>
              )}

              {/* Inspector metadata grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[5px] border border-[oklch(0.08_0.005_250)] bg-[oklch(0.16_0.008_250)] px-3 py-2 text-[11px] shadow-[0_1px_0_oklch(1_0_0/0.04)_inset]">
                <Meta label="Rating">
                  <StarGlyph className="h-2.5 w-2.5" />
                  {data.vote_average?.toFixed(1)} / 10
                </Meta>
                {y && (
                  <Meta label="Released">
                    <CalendarGlyph className="h-2.5 w-2.5" />
                    {y}
                  </Meta>
                )}
                {runtime ? (
                  <Meta label="Runtime">
                    <ClockGlyph className="h-2.5 w-2.5" />
                    {runtime}m
                  </Meta>
                ) : null}
                {data.number_of_seasons ? (
                  <Meta label="Seasons">
                    {data.number_of_seasons} seasons, {data.number_of_episodes ?? "-"} eps
                  </Meta>
                ) : null}
                {data.status ? <Meta label="Status">{data.status}</Meta> : null}
              </dl>

              {/* Genre chips */}
              <div className="flex flex-wrap gap-1.5">
                {data.genres.map((g) => (
                  <Link
                    key={g.id}
                    to="/"
                    search={{ type: mediaType, genre: g.id } as never}
                    className="chip-pill chip-pill-interactive rounded-full px-2 py-0.5 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                  >
                    {g.name}
                  </Link>
                ))}
              </div>

              {data.overview ? (
                <p className="max-w-[620px] rounded-[5px] border border-[oklch(0.1_0.005_250)] bg-black/18 px-3 py-2 text-[13px] leading-relaxed text-foreground/88 shadow-[0_1px_0_oklch(1_0_0/0.04)_inset]">
                  {data.overview}
                </p>
              ) : (
                <p className="max-w-[620px] rounded-[5px] border border-[oklch(0.1_0.005_250)] bg-black/18 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
                  No description is available yet.
                </p>
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                <Link
                  to="/watch/$type/$id"
                  params={{ type: mediaType, id }}
                  className="btn-aqua btn-aqua-interactive inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                >
                  <PlayGlyph className="h-3 w-3" />
                  Watch
                </Link>
                {mediaType === "tv" && (
                  <Link
                    to="/download/tv/$id"
                    params={{ id }}
                    className="chip-pill chip-pill-interactive inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                    Download Series
                  </Link>
                )}
                {trailer && (
                  <button
                    onClick={() => setTrailerOpen(true)}
                    className="chip-pill chip-pill-interactive inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                  >
                    <PlayGlyph className="h-3 w-3" />
                    Trailer
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collection banner */}
      {data.belongs_to_collection ? (
        <CollectionBanner
          collection={data.belongs_to_collection}
          currentId={data.id}
          type={mediaType}
        />
      ) : null}

      {/* Seasons & Episodes (TV only) */}
      {mediaType === "tv" && data.seasons?.length ? (
        <SeasonsSection id={id} seasons={data.seasons.filter((s) => s.season_number > 0)} />
      ) : null}

      {/* Cast */}
      {data.credits?.cast?.length ? (
        <section className="mx-auto max-w-[1200px] px-4 py-6 animate-fade-up">
          <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--aluminum-line)] pb-1.5">
            <h2 className="text-[12px] font-semibold tracking-tight text-foreground/90">Cast</h2>
            <div className="hidden gap-1 md:flex">
              <RailArrowButton aria-label="Scroll cast left" onClick={() => scrollCastRail(-1)}>
                <ChevronGlyph dir="left" />
              </RailArrowButton>
              <RailArrowButton aria-label="Scroll cast right" onClick={() => scrollCastRail(1)}>
                <ChevronGlyph dir="right" />
              </RailArrowButton>
            </div>
          </div>
          <div
            ref={castRailRef}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") scrollCastRail(-1);
              if (event.key === "ArrowRight") scrollCastRail(1);
            }}
            className="scrollbar-none flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2 outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.6)]"
          >
            {data.credits.cast.slice(0, 16).map((c, i) => {
              const img = poster(c.profile_path, "w342");
              return (
                <div
                  key={c.id}
                  className={`group w-[92px] shrink-0 snap-start ${i < 8 ? "animate-fade-up" : ""} text-center transition-transform duration-300 hover:-translate-y-[2px] sm:w-[112px]`}
                  style={i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
                >
                  <div className="poster-card mx-auto grid aspect-square w-full place-items-center overflow-hidden rounded-full bg-[oklch(0.16_0.008_250)] p-[3px]">
                    <div className="h-full w-full overflow-hidden rounded-full bg-[radial-gradient(circle_at_50%_32%,oklch(0.28_0.008_250),oklch(0.13_0.006_250))]">
                      <CastPortrait src={img} name={c.name} />
                    </div>
                  </div>
                  <div className="mt-1.5 px-1">
                    <div className="line-clamp-1 text-[11px] font-medium text-foreground/90">
                      {c.name}
                    </div>
                    <div className="line-clamp-1 text-[10px] text-muted-foreground">
                      {c.character}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* More like this */}
      <SimilarSection type={mediaType} id={id} />

      {/* Trailer modal */}
      {trailer && trailerOpen && (
        <TrailerModal videoKey={trailer.key} title={t} onClose={() => setTrailerOpen(false)} />
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function CollectionBanner({
  collection,
  currentId,
  type,
}: {
  collection: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  };
  currentId: number;
  type: MediaType;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const scrollRail = (dir: -1 | 1) =>
    railRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  const { data } = useQuery({
    queryKey: ["collection", collection.id],
    queryFn: () => fetchCollection(collection.id),
  });
  const bg = backdrop(collection.backdrop_path ?? data?.backdrop_path ?? null, "w1280");
  const parts = (data?.parts ?? []).slice(0, 10);

  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-6 animate-fade-up">
      <div className="brushed relative overflow-hidden rounded-md border border-[var(--aluminum-line)] shadow-[0_12px_30px_-18px_oklch(0_0_0/0.9)]">
        {bg && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-35"
            style={{ backgroundImage: `url(${bg})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <div className="text-[10px] text-primary/80">Part of</div>
            <h3 className="text-[18px] font-semibold tracking-tight text-foreground">
              {collection.name}
            </h3>
            <div className="text-[11px] text-muted-foreground">
              {data ? `${data.parts.length} titles in this collection` : "Loading collection..."}
            </div>
          </div>
          {parts.length > 0 && (
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-center gap-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
              <RailArrowButton aria-label="Scroll collection left" onClick={() => scrollRail(-1)}>
                <ChevronGlyph dir="left" />
              </RailArrowButton>
              <div
                ref={railRef}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") scrollRail(-1);
                  if (event.key === "ArrowRight") scrollRail(1);
                }}
                className="scrollbar-none flex min-w-0 snap-x gap-3 overflow-x-auto scroll-smooth pb-1 outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.6)]"
              >
                {parts.map((p, i) => {
                  const ps = poster(p.poster_path, "w342");
                  const label = titleOf(p);
                  const releaseYear = yearOf(p);
                  const isCurrent = p.id === currentId;
                  return (
                    <Link
                      key={p.id}
                      to="/title/$type/$id"
                      params={{ type, id: String(p.id) }}
                      style={{ animationDelay: `${i * 30}ms` }}
                      className={`poster-card animate-fade-up group/c w-[116px] shrink-0 snap-start overflow-hidden rounded-[5px] transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] ${
                        isCurrent
                          ? "border border-foreground/30 opacity-90 cursor-default pointer-events-none"
                          : "hover:-translate-y-[3px]"
                      }`}
                    >
                      <div className="aspect-[2/3] bg-[oklch(0.16_0.008_250)] relative">
                        {ps ? (
                          <img
                            src={ps}
                            alt={label}
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full object-cover transition-transform duration-[500ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                              !isCurrent && "group-hover/c:scale-[1.05]"
                            }`}
                          />
                        ) : (
                          <MediaPlaceholder label="Poster unavailable" />
                        )}
                        {isCurrent && (
                          <div className="absolute inset-0 bg-black/40 grid place-items-center backdrop-blur-[2px]">
                            <span className="text-[10px] font-medium text-white px-2 py-1 bg-black/60 rounded-full border border-white/20">
                              Current Part
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-[oklch(0.1_0.005_250)] px-2 py-1.5">
                        <div className="text-[9px] text-primary/80 font-medium mb-0.5">
                          Part {i + 1}
                        </div>
                        <div className="line-clamp-2 min-h-[2rem] text-[10px] font-semibold leading-tight text-foreground/90">
                          {label}
                        </div>
                        {releaseYear && (
                          <div className="mt-0.5 text-[9px] text-muted-foreground">
                            {releaseYear}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
              <RailArrowButton aria-label="Scroll collection right" onClick={() => scrollRail(1)}>
                <ChevronGlyph dir="right" />
              </RailArrowButton>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SimilarSection({ type, id }: { type: MediaType; id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["similar", type, id],
    queryFn: () => fetchSimilar(type, id),
  });
  const items = (data ?? []).slice(0, 12);
  if (!isLoading && items.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-6 animate-fade-up">
      <div className="mb-2 border-b border-[var(--aluminum-line)] pb-1.5">
        <h2 className="text-[12px] font-semibold tracking-tight text-foreground/90">
          More like this
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="poster-card overflow-hidden rounded-[5px]">
                <div className="aspect-[2/3] skeleton" />
                <div className="h-5 skeleton border-t border-[oklch(0.1_0.005_250)]" />
              </div>
            ))
          : items.map((it, i) => <PosterCard key={it.id} item={it} type={type} delay={i * 25} />)}
      </div>
    </section>
  );
}

type SeasonData = {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  overview: string;
};

function CastPortrait({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <PersonPlaceholder />;

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover object-center transition-transform duration-[500ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.06]"
    />
  );
}

function SeasonsSection({ id, seasons }: { id: string; seasons: SeasonData[] }) {
  const [active, setActive] = useState<number>(seasons[0]?.season_number ?? 1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["season", id, active],
    queryFn: () => fetchSeason(id, active),
  });


  return (
    <section className="mx-auto max-w-[1200px] px-4 py-6 animate-fade-up">
      <div className="mb-2 flex items-baseline justify-between border-b border-[var(--aluminum-line)] pb-1.5">
        <h2 className="text-[12px] font-semibold tracking-tight text-foreground/90">
          Seasons &amp; Episodes
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {seasons.length} season{seasons.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Season selector chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {seasons.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.season_number)}
            aria-pressed={active === s.season_number}
            className={[
              "chip-pill chip-pill-interactive inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]",
              active === s.season_number ? "chip-pill-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {active === s.season_number && <CheckGlyph className="h-2.5 w-2.5 text-primary" />}
            {s.name}
          </button>
        ))}
      </div>


      {/* Episode list */}
      {error ? (
        <div className="panel-aluminum rounded-md px-4 py-5 text-center">
          <div className="text-[12px] text-foreground/80">Couldn't load episodes.</div>
          <button
            onClick={() => refetch()}
            className="btn-aqua btn-aqua-interactive mt-2 rounded-full px-3 py-1 text-[11px] font-medium"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[88px] rounded-md" />
          ))}
        </div>
      ) : (
        <ol className="overflow-hidden rounded-md border border-[var(--aluminum-line)] bg-[oklch(0.2_0.008_250)] divide-y divide-[var(--aluminum-line)]">
          {(data?.episodes ?? []).map((ep, i) => {
            const img = still(ep.still_path, "w300");
            return (
              <li
                key={ep.id}
                className={`group flex gap-3 px-3 py-2.5 transition-colors duration-200 hover:bg-[oklch(0.24_0.008_250)] ${i < 8 ? "animate-fade-up" : ""}`}
                style={i < 8 ? { animationDelay: `${i * 20}ms` } : undefined}
              >
                {/* Episode number badge */}
                <div className="grid h-6 w-6 shrink-0 place-items-center self-start rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.32_0.008_250)] to-[oklch(0.2_0.008_250)] text-[10px] font-semibold text-foreground/85 shadow-[0_1px_0_oklch(1_0_0/0.1)_inset]">
                  {ep.episode_number}
                </div>

                {/* Still image */}
                {img && (
                  <div className="hidden sm:block shrink-0 overflow-hidden rounded-[4px] border border-[oklch(0.08_0.005_250)]">
                    <img
                      src={img}
                      alt={ep.name}
                      loading="lazy"
                      decoding="async"
                      className="h-[68px] w-[120px] object-cover transition-transform duration-[500ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.04]"
                    />
                  </div>
                )}

                {/* Episode info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[12px] font-semibold text-foreground/95 leading-tight">
                      {ep.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {ep.air_date && <span>{ep.air_date}</span>}
                      {ep.runtime ? <span>{ep.runtime}m</span> : null}
                      {ep.vote_average ? (
                        <span className="flex items-center gap-0.5">
                          <StarGlyph className="h-2 w-2" />
                          {ep.vote_average.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {ep.overview && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-foreground/70">
                      {ep.overview}
                    </p>
                  )}
                  <Link
                    to="/watch/$type/$id"
                    params={{ type: "tv", id }}
                    search={{ s: active, e: ep.episode_number }}
                    className="chip-pill chip-pill-interactive mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium opacity-90 transition-all duration-200 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
                  >
                    <PlayGlyph className="h-2.5 w-2.5" />
                    Watch
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TrailerModal({
  videoKey,
  title,
  onClose,
}: {
  videoKey: string;
  title: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(
      () => dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus(),
      0,
    );
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/80 px-4 py-6 backdrop-blur-md animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="brushed relative w-full max-w-[960px] overflow-hidden rounded-md border border-[var(--aluminum-line)] shadow-[0_30px_80px_-20px_oklch(0_0_0/0.9),0_0_0_1px_oklch(1_0_0/0.05)_inset] animate-scale-in"
      >
        {/* Modal title bar */}
        <div className="nav-aluminum flex items-center justify-between px-3 py-2 border-b border-[var(--aluminum-line)]">
          <div className="flex items-center gap-1.5">
            <MediaGlyph className="h-5 w-5 text-primary/80" />
            <span
              id={titleId}
              className="text-[11px] font-semibold tracking-tight text-foreground/90 line-clamp-1"
            >
              {title} - Trailer
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close trailer"
            className="grid h-6 w-6 place-items-center rounded-full border border-[oklch(0.08_0.005_250)] bg-gradient-to-b from-[oklch(0.32_0.008_250)] to-[oklch(0.2_0.008_250)] text-foreground/80 shadow-[0_1px_0_oklch(1_0_0/0.12)_inset,0_1px_1px_oklch(0_0_0/0.5)] transition-all duration-200 hover:text-foreground hover:from-[oklch(0.36_0.008_250)] hover:to-[oklch(0.24_0.008_250)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
          >
            <XGlyph className="h-3 w-3" />
          </button>
        </div>

        <div className="aspect-video w-full bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${videoKey}?autoplay=1&rel=0`}
            title={`${title} trailer`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[oklch(0.1_0.005_250)]/60 py-0.5 last:border-0">
      <dt className="text-[9px] text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-[11px] font-medium text-foreground/90">
        {children}
      </dd>
    </div>
  );
}

function TopBar() {
  return (
    <header className="nav-aluminum brushed sticky top-0 z-50 animate-fade-in">
      <div className="mx-auto flex h-12 max-w-[1280px] items-center gap-3 px-3 sm:px-4">
        <Link
          to="/"
          className="chip-pill chip-pill-interactive inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)]"
        >
          <ArrowLeftGlyph className="h-3 w-3" />
          Back
        </Link>
        <Link to="/" className="ml-1 flex items-center gap-1.5 group">
          <BrandMark className="transition-transform duration-300 group-hover:scale-[1.06]" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground/95">
            leethe
          </span>
        </Link>
      </div>
    </header>
  );
}
