import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MediaPlaceholder } from "@/components/leethe/VisualAssets";
import { fetchDetail, poster, title, year, type MediaType, type TmdbItem } from "@/lib/tmdb";
import { useCallback } from "react";

export function PosterCard({
  item,
  type,
  delay = 0,
  aspect = "aspect-[2/3]",
}: {
  item: TmdbItem;
  type: MediaType;
  delay?: number;
  aspect?: string;
}) {
  const queryClient = useQueryClient();
  const img = poster(item.poster_path, "w500");
  const t = title(item);
  const y = year(item);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : "NR";
  const prefetchDetail = useCallback(() => {
    const queryKey = ["detail", type, String(item.id)];
    if (!queryClient.getQueryData(queryKey)) {
      queryClient.setQueryData(queryKey, {
        ...item,
        genres: [],
      });
    }
    void queryClient.prefetchQuery({
      queryKey,
      queryFn: () => fetchDetail(type, item.id),
      staleTime: 60_000,
    });
  }, [queryClient, type, item]);

  return (
    <Link
      to="/title/$type/$id"
      params={{ type, id: String(item.id) }}
      preload="intent"
      aria-label={`Open ${t}${y ? `, ${y}` : ""}`}
      onClick={prefetchDetail}
      onFocus={prefetchDetail}
      onPointerDown={prefetchDetail}
      onPointerEnter={prefetchDetail}
      className="poster-card poster-preview-card animate-fade-up relative mx-auto flex w-full max-w-[280px] min-w-0 flex-col overflow-hidden rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.7_0.16_240/0.7)] focus-visible:ring-offset-2 focus-visible:ring-offset-background min-[520px]:max-w-none"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between border-b border-[oklch(0.1_0.005_250)] bg-gradient-to-b from-[oklch(0.28_0.008_250)] to-[oklch(0.2_0.008_250)] px-2 py-1">
        <span className="text-[9px] text-muted-foreground">{y || "TBA"}</span>
        <span className="flex items-center gap-0.5 text-[9px] text-foreground/80">
          <StarGlyph className="h-2.5 w-2.5" />
          {rating}
        </span>
      </div>

      <div className={`${aspect} relative overflow-hidden bg-[oklch(0.16_0.008_250)]`}>
        {img ? (
          <img
            src={img}
            alt={t}
            loading="lazy"
            decoding="async"
            className="poster-preview-image absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <MediaPlaceholder label="Poster unavailable" className="absolute inset-0" />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1/2 bg-[linear-gradient(145deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.08)_28%,rgba(255,255,255,0)_50%)] opacity-70" />
        <div className="poster-preview-sheen pointer-events-none absolute right-0 top-0 z-30 h-full w-1/3 translate-x-full skew-x-12 bg-gradient-to-r from-transparent via-white/[0.18] to-transparent opacity-0" />

        <div className="poster-preview-titlebar absolute inset-x-0 bottom-0 z-30 p-2">
          <div className="line-clamp-1 text-[12px] font-semibold leading-tight text-white drop-shadow-[0_1px_2px_oklch(0_0_0/0.8)]">
            {t}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function PosterSkeleton({ aspect = "aspect-[2/3]" }: { aspect?: string }) {
  return (
    <div className="poster-card mx-auto w-full max-w-[280px] overflow-hidden rounded-[5px] min-[520px]:max-w-none">
      <div className="h-5 skeleton border-b border-[oklch(0.1_0.005_250)]" />
      <div className={`${aspect} skeleton`} />
    </div>
  );
}

export function StarGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="oklch(0.82 0.16 80)" aria-hidden="true">
      <polygon points="6,1.2 7.5,4.6 11,4.9 8.3,7.2 9.2,10.6 6,8.8 2.8,10.6 3.7,7.2 1,4.9 4.5,4.6" />
    </svg>
  );
}
