import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { DiscoverSort, MediaType } from "@/lib/tmdb";

export function useTypeAndGenre() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    type?: MediaType;
    genre?: number;
    q?: string;
    sort?: DiscoverSort;
  };
  const [q, setQ] = useState(search.q ?? "");
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  const type: MediaType = search.type === "tv" ? "tv" : "movie";
  const genre = search.genre ? Number(search.genre) : undefined;
  const sort: DiscoverSort =
    search.sort === "new" ? "new" : search.sort === "rated" ? "rated" : "popular";

  useEffect(() => {
    if ((search.q ?? "") === q) return;
    const timer = window.setTimeout(() => {
      void navigate({
        to: "/",
        search: { type, genre, q: q || undefined, sort: sortParam(sort) } as never,
        replace: true,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [genre, navigate, q, search.q, sort, type]);

  return {
    type,
    genre,
    sort,
    q,
    setQ,
    setType: (t: MediaType) =>
      navigate({
        to: "/",
        search: { type: t, genre: undefined, q: q || undefined, sort: sortParam(sort) } as never,
      }),
    setGenre: (g: number | undefined) =>
      navigate({
        to: "/",
        search: { type, genre: g, q: q || undefined, sort: sortParam(sort) } as never,
      }),
    setSort: (newSort: DiscoverSort) =>
      navigate({
        to: "/",
        search: { type, genre, q: q || undefined, sort: sortParam(newSort) } as never,
      }),
    setQuery: setQ,
  };
}

function sortParam(sort: DiscoverSort) {
  return sort === "popular" ? undefined : sort;
}
