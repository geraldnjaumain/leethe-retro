import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/leethe/VisualAssets";
import { getPublicLegalConfig } from "@/lib/legal";

export const Route = createFileRoute("/legal")({
  loader: () => getPublicLegalConfig(),
  head: () => ({
    meta: [
      { title: "Leethe - Legal and privacy" },
      { name: "description", content: "Leethe terms, privacy notice, and takedown process." },
    ],
  }),
  component: LegalPage,
});

function LegalPage() {
  const { contactEmail } = Route.useLoaderData();
  return (
    <main className="mx-auto min-h-screen max-w-[820px] px-4 py-8 text-[13px] leading-6 text-foreground/85">
      <header className="mb-8 flex items-center justify-between border-b border-[var(--aluminum-line)] pb-4">
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <BrandMark />
          <span className="font-semibold">leethe</span>
        </Link>
        <Link to="/" className="text-[12px] text-muted-foreground hover:text-foreground">
          Back to catalog
        </Link>
      </header>

      <h1 className="text-2xl font-semibold text-foreground">Legal and privacy</h1>
      <p className="mt-2 text-muted-foreground">Last updated June 6, 2026.</p>

      <LegalSection title="Terms of use">
        Leethe provides movie and series discovery information. You may not abuse the service,
        bypass access controls, automate excessive requests, or use it in violation of applicable
        law. Availability may change without notice.
      </LegalSection>

      <LegalSection title="Content and third-party services">
        Metadata and artwork are provided through TMDB. This product uses the TMDB API but is not
        endorsed or certified by TMDB. External playback is enabled only where the operator has
        confirmed the required distribution rights. Third-party services remain subject to their own
        terms.
      </LegalSection>

      <LegalSection title="Privacy notice">
        Leethe processes request logs, approximate network identifiers used for abuse prevention,
        and catalog activity needed to operate the service. Playback preferences and progress are
        stored locally in your browser. When first-party product analytics are enabled, Leethe also
        records aggregate page, playback, download, and support activity without storing names in
        analytics events. Operational logs and product events should be retained only as long as
        needed for security, reliability, and product improvement.
      </LegalSection>

      <LegalSection title="Copyright and takedown requests">
        Rights holders can request review or removal by emailing{" "}
        <a className="text-primary hover:underline" href={`mailto:${contactEmail}`}>
          {contactEmail}
        </a>{" "}
        with their contact details, identification of the protected work, the affected URL, a
        good-faith statement, and evidence of authority to act. Valid requests should be
        investigated promptly and access disabled where appropriate.
      </LegalSection>

      <LegalSection title="Contact">
        This notice must be reviewed for the launch jurisdiction. Contact{" "}
        <a className="text-primary hover:underline" href={`mailto:${contactEmail}`}>
          {contactEmail}
        </a>{" "}
        with privacy, legal, or service questions.
      </LegalSection>
    </main>
  );
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 border-t border-[var(--aluminum-line)] pt-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-muted-foreground">{children}</p>
    </section>
  );
}
