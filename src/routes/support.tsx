import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/leethe/VisualAssets";
import { submitSupportTicket, type SupportCategory } from "@/lib/product";

type SupportSearch = {
  category?: SupportCategory;
  path?: string;
  type?: "movie" | "tv";
  id?: number;
  s?: number;
  e?: number;
};

const categories: Array<{ value: SupportCategory; label: string; description: string }> = [
  { value: "playback", label: "Playback", description: "Video will not start, buffers, or stops." },
  {
    value: "subtitles",
    label: "Subtitles",
    description: "Missing, incorrect, or out of sync captions.",
  },
  {
    value: "audio",
    label: "Audio & dubs",
    description: "Missing language, silent, or wrong audio.",
  },
  {
    value: "downloads",
    label: "Downloads",
    description: "Download link or episode selection issue.",
  },
  { value: "catalog", label: "Catalog", description: "Wrong title, artwork, season, or episode." },
  { value: "legal", label: "Legal", description: "Rights, privacy, or takedown request." },
  { value: "other", label: "Other", description: "Anything else that needs attention." },
];

function positiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const Route = createFileRoute("/support")({
  validateSearch: (search: Record<string, unknown>): SupportSearch => ({
    category: categories.some((category) => category.value === search.category)
      ? (search.category as SupportCategory)
      : undefined,
    path: typeof search.path === "string" ? search.path.slice(0, 240) : undefined,
    type: search.type === "movie" || search.type === "tv" ? search.type : undefined,
    id: positiveInt(search.id),
    s: positiveInt(search.s),
    e: positiveInt(search.e),
  }),
  head: () => ({
    meta: [
      { title: "Leethe - Support" },
      {
        name: "description",
        content: "Report playback, subtitle, audio, download, or catalog issues.",
      },
    ],
  }),
  component: SupportPage,
});

function SupportPage() {
  const search = Route.useSearch();
  const [category, setCategory] = useState<SupportCategory>(search.category ?? "playback");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketId, setTicketId] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await submitSupportTicket({
        data: {
          category,
          email,
          message,
          path: search.path,
          mediaType: search.type,
          tmdbId: search.id,
          season: search.s,
          episode: search.e,
        },
      });
      setTicketId(result.ticketId);
      setMessage("");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "The report could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1040px] px-3 py-5 sm:px-4 sm:py-8">
      <header className="nav-aluminum brushed mb-5 flex items-center justify-between rounded-md border border-[var(--aluminum-line)] px-3 py-2">
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <BrandMark />
          <span className="text-[13px] font-semibold">leethe support</span>
        </Link>
        <Link to="/" className="chip-pill chip-pill-interactive rounded-full px-3 py-1 text-[11px]">
          Catalog
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="panel-aluminum rounded-md p-4">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Tell us what went wrong
          </h1>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            Reports go directly into the operations dashboard so playback, subtitle, audio, and
            download issues can be tracked through resolution.
          </p>
          <div className="mt-5 space-y-2 border-t border-[var(--aluminum-line)] pt-4 text-[11px] text-muted-foreground">
            <p>Include the exact title and episode when relevant.</p>
            <p>Email is optional and is used only if a reply is needed.</p>
            <p>Do not include passwords or payment details.</p>
          </div>
        </aside>

        <form onSubmit={submit} className="panel-aluminum rounded-md p-4 sm:p-5">
          <fieldset>
            <legend className="text-[12px] font-semibold text-foreground/90">Issue type</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {categories.map((item) => (
                <label
                  key={item.value}
                  className={[
                    "cursor-pointer rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                    category === item.value
                      ? "border-[oklch(0.55_0.16_245/0.8)] bg-[oklch(0.2_0.03_245)]"
                      : "border-[var(--aluminum-line)] bg-black/15 hover:bg-white/5",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="category"
                    value={item.value}
                    checked={category === item.value}
                    onChange={() => setCategory(item.value)}
                    className="sr-only"
                  />
                  <span className="block text-[11px] font-semibold text-foreground">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 block">
            <span className="text-[11px] font-semibold text-foreground/90">Email, optional</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="support-field mt-1"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[11px] font-semibold text-foreground/90">What happened?</span>
            <textarea
              required
              minLength={12}
              maxLength={4000}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                if (ticketId) setTicketId("");
              }}
              placeholder="Describe what you expected, what happened, and any steps that reproduce the issue."
              className="support-field mt-1 min-h-36 resize-y"
            />
            <span className="mt-1 block text-right text-[9px] text-muted-foreground">
              {message.length} / 4000
            </span>
          </label>

          {ticketId ? (
            <div
              role="status"
              className="mt-4 rounded-md border border-[oklch(0.55_0.14_145/0.55)] bg-[oklch(0.2_0.04_145/0.5)] px-3 py-2 text-[11px] text-foreground"
            >
              Report received. Reference: <strong>{ticketId}</strong>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[11px] text-foreground"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--aluminum-line)] pt-4">
            <Link to="/legal" className="text-[10px] text-muted-foreground hover:text-foreground">
              Legal & privacy
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="btn-aqua btn-aqua-interactive rounded-full px-5 py-1.5 text-[12px] font-medium disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Submit report"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
