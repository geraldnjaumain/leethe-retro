import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Nav } from "@/components/leethe/Nav";
import { MetallicWordmark } from "@/components/leethe/VisualAssets";
import { GenreRail } from "@/components/leethe/GenreRail";
import { PosterCard, PosterSkeleton } from "@/components/leethe/PosterCard";
import { useTypeAndGenre } from "@/hooks/use-type-and-genre";
import {
  discover,
  fetchGenres,
  searchTitles,
  TmdbConfigError,
  type DiscoverSort,
  type MediaType,
  type TmdbItem,
  type TmdbPage,
} from "@/lib/tmdb";

type Search = { type?: MediaType; genre?: number; q?: string; sort?: DiscoverSort };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    type: s.type === "tv" ? "tv" : s.type === "movie" ? "movie" : undefined,
    genre: s.genre ? Number(s.genre) : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
    sort: s.sort === "new" ? "new" : s.sort === "rated" ? "rated" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Leethe - Movies & Series, on the go" },
      { name: "description", content: "A clean, ad-free streaming home for movies and series." },
    ],
  }),
  component: Index,
});

function Index() {
  const { type, genre, sort, q, setType, setGenre, setSort, setQuery } = useTypeAndGenre();

  return (
    <div className="min-h-screen">
      <Nav
        type={type}
        onTypeChange={setType}
        sort={sort}
        onSortChange={setSort}
        query={q}
        onQueryChange={setQuery}
      />
      <GenreRail type={type} active={genre} onChange={setGenre} />
      <main className="mx-auto max-w-[1200px] px-3 py-5 sm:px-4 sm:py-6">
        <InfiniteFeed type={type} genre={genre} sort={sort} q={q.trim()} />
      </main>
    </div>
  );
}

const UNIFORM_ASPECT = "aspect-[2/3]";

function InfiniteFeed({
  type,
  genre,
  sort,
  q,
}: {
  type: MediaType;
  genre: number | undefined;
  sort: DiscoverSort;
  q: string;
}) {
  const isSearch = q.length > 0;
  const { data: genres = [] } = useQuery({
    queryKey: ["genres", type],
    queryFn: () => fetchGenres(type),
    staleTime: 1000 * 60 * 60,
    enabled: !isSearch && genre !== undefined,
  });
  const activeGenreName = genre ? genres.find((g) => g.id === genre)?.name : undefined;
  const mediaLabel = type === "movie" ? "movies" : "series";
  const sortLabel = sort === "new" ? "New" : sort === "rated" ? "Top rated" : "Popular";
  const label = isSearch
    ? `Results for "${q}"`
    : activeGenreName
      ? `${sortLabel} ${activeGenreName} ${mediaLabel}`
      : `${sortLabel} ${mediaLabel}`;

  const queryKey = isSearch ? ["search", type, q] : ["feed", type, genre ?? "all", sort];

  const query = useInfiniteQuery<TmdbPage<TmdbItem>>({
    queryKey,
    queryFn: ({ pageParam = 1 }) =>
      isSearch
        ? searchTitles(type, q, pageParam as number)
        : discover(type, { genre, sort, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    staleTime: 1000 * 60 * 3,
  });

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinel.current) return;
    const el = sentinel.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const [cols, setCols] = useState(6);
  useEffect(() => {
    const updateCols = () => {
      const w = window.innerWidth;
      if (w >= 1024) setCols(6);
      else if (w >= 768) setCols(5);
      else if (w >= 640) setCols(4);
      else if (w >= 560) setCols(3);
      else setCols(2);
    };
    updateCols();
    window.addEventListener("resize", updateCols);
    return () => window.removeEventListener("resize", updateCols);
  }, []);

  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < items.length; i += cols) {
      result.push(items.slice(i, i + cols));
    }
    return result;
  }, [items, cols]);

  const virtualizer = useWindowVirtualizer({
    count: query.isLoading ? 3 : rows.length + (query.isFetchingNextPage ? 1 : 0),
    estimateSize: () => (cols <= 2 ? 250 : cols === 3 ? 300 : 350),
    overscan: 2,
  });

  return (
    <section className="animate-fade-in">
      <div className="mb-3 border-b border-[var(--aluminum-line)] pb-1.5">
        <h2 className="flex items-baseline gap-2 text-[12px] font-semibold tracking-tight text-foreground/90">
          {label}
        </h2>
      </div>

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const isLoaderRow = !query.isLoading && virtualRow.index === rows.length;
              const isLoadingRow = query.isLoading;
              const rowItems = rows[virtualRow.index] || [];

              return (
                <div
                  key={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: "12px", // acts as gap
                  }}
                  className={`grid gap-3 grid-cols-2 min-[560px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                >
                  {isLoadingRow || isLoaderRow
                    ? Array.from({ length: cols }).map((_, i) => (
                        <PosterSkeleton
                          key={`skel-${virtualRow.index}-${i}`}
                          aspect={UNIFORM_ASPECT}
                        />
                      ))
                    : rowItems.map((it, i) => (
                        <PosterCard
                          key={it.id}
                          item={it}
                          type={type}
                          delay={((virtualRow.index * cols + i) % 12) * 40}
                          aspect={UNIFORM_ASPECT}
                        />
                      ))}
                </div>
              );
            })}
          </div>

          {!query.isLoading && items.length === 0 && (
            <div className="panel-aluminum rounded-md px-4 py-8 text-center text-[12px] text-muted-foreground">
              No titles found.
            </div>
          )}

          <div ref={sentinel} className="h-12" />

          {!query.hasNextPage && items.length > 0 && (
            <div className="py-6 text-center text-[10px] text-muted-foreground/70">
              End of catalog
            </div>
          )}
        </div>
      )}

      <Footer />
    </section>
  );
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const isConfigError = error instanceof TmdbConfigError;

  return (
    <div className="panel-aluminum rounded-md px-4 py-6 text-center">
      <div className="text-[12px] text-foreground/80">
        {isConfigError ? "TMDB access token is missing." : "Couldn't reach the catalog."}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {isConfigError
          ? "Set TMDB_READ_ACCESS_TOKEN in your server environment."
          : "Check your connection and try again."}
      </div>
      <button
        onClick={onRetry}
        className="btn-aqua btn-aqua-interactive mt-3 rounded-full px-3 py-1 text-[11px] font-medium"
      >
        Retry
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="nav-aluminum brushed mt-8 overflow-hidden rounded-md border border-[var(--aluminum-line)]">
      <div className="flex flex-col items-center gap-2 px-4 py-3 sm:flex-row sm:justify-between">
        <MetallicWordmark className="text-[14px]" />
        <div className="text-[10px] text-muted-foreground">Curated movie and series discovery</div>
        <div className="text-[10px] text-muted-foreground">
          (c) {new Date().getFullYear()} Leethe. Data by TMDB.
        </div>
        <Link to="/legal" className="text-[10px] text-muted-foreground hover:text-foreground">
          Legal & privacy
        </Link>
        <Link to="/support" className="text-[10px] text-muted-foreground hover:text-foreground">
          Support
        </Link>
      </div>
    </footer>
  );
}
