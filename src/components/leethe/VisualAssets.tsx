export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`relative inline-grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[28%] border border-white/15 bg-[linear-gradient(145deg,oklch(0.68_0.025_245),oklch(0.19_0.012_250)_58%,oklch(0.08_0.006_250))] shadow-[0_1px_0_oklch(1_0_0/0.35)_inset,0_1px_3px_oklch(0_0_0/0.65)] ${className ?? ""}`}
      aria-hidden="true"
    >
      <svg className="h-[68%] w-[68%]" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5A8.5 8.5 0 0 0 12 3.5Z"
          stroke="oklch(0.9 0.01 245 / .72)"
          strokeWidth="1.35"
        />
        <path d="m10 8.2 6.2 3.8-6.2 3.8V8.2Z" fill="oklch(0.93 0.02 235 / .9)" />
        <path
          d="M5.7 7.1 8 8.5M18.3 7.1 16 8.5M5.7 16.9 8 15.5"
          stroke="white"
          strokeOpacity=".3"
        />
      </svg>
    </span>
  );
}

export function MetallicWordmark({ className }: { className?: string }) {
  return (
    <span
      className={`bg-[linear-gradient(180deg,oklch(0.98_0.004_245),oklch(0.67_0.012_245)_48%,oklch(0.93_0.006_245))] bg-clip-text font-semibold lowercase tracking-[-0.055em] text-transparent drop-shadow-[0_1px_0_oklch(0_0_0/0.75)] ${className ?? ""}`}
      aria-label="Leethe"
    >
      leethe
    </span>
  );
}

export function PersonPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={`grid h-full w-full place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_32%,oklch(0.31_0.012_245),oklch(0.13_0.006_250))] text-foreground/42 ${className ?? ""}`}
      aria-hidden="true"
    >
      <svg className="h-[72%] w-[72%]" viewBox="0 0 24 24" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M7.5 6a4.5 4.5 0 1 0 9 0 4.5 4.5 0 0 0-9 0ZM3.75 20.1a8.25 8.25 0 0 1 16.5 0 .75.75 0 0 1-.44.7A18.68 18.68 0 0 1 12 22.5c-2.79 0-5.43-.61-7.81-1.7a.75.75 0 0 1-.44-.7Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

export function MediaGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MediaPlaceholder({
  label = "Artwork unavailable",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_35%,oklch(0.27_0.012_245),oklch(0.13_0.006_250))] text-center ${className ?? ""}`}
    >
      <div className="flex flex-col items-center gap-2 px-3 text-[10px] text-muted-foreground">
        <MediaGlyph className="h-8 w-8 text-foreground/45" />
        {label ? <span>{label}</span> : null}
      </div>
    </div>
  );
}
