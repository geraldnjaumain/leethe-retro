import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { LogoDot } from "../components/leethe/Nav";
import { ProductTelemetry } from "../components/leethe/ProductTelemetry";

/* ── Retro panel wrapper used by error pages ─────────────────── */
function AluminumPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="brushed relative w-full max-w-sm overflow-hidden rounded-md border border-[oklch(0.08_0.005_250)] shadow-[var(--shadow-card)]">
        <div className="nav-aluminum flex items-center justify-center border-b border-[oklch(0.08_0.005_250)] px-3 py-1.5">
          <div className="text-center text-[11px] font-medium text-foreground/70">leethe</div>
        </div>

        {/* Panel body */}
        <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
          <LogoDot />
          {children}
        </div>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <AluminumPanel>
      <div>
        <div className="text-[48px] font-semibold tracking-tight text-foreground/30 leading-none">
          404
        </div>
        <h1 className="mt-1 text-[15px] font-semibold text-foreground">Page not found</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
      <Link
        to="/"
        className="btn-aqua btn-aqua-interactive rounded-full px-5 py-1.5 text-[12px] font-medium"
      >
        Go home
      </Link>
    </AluminumPanel>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    console.error("[Leethe] Unhandled error:", error);
  }, [error]);

  return (
    <AluminumPanel>
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Something went wrong on our end. Try refreshing or head back home.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="btn-aqua btn-aqua-interactive rounded-full px-5 py-1.5 text-[12px] font-medium"
        >
          Try again
        </button>
        <a
          href="/"
          className="chip-pill chip-pill-interactive rounded-full px-5 py-1.5 text-[12px] font-medium"
        >
          Go home
        </a>
      </div>
    </AluminumPanel>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "application-name", content: "Leethe" },
      { name: "theme-color", content: "#11151d" },
      { title: "Leethe - Movies & Series, on the go" },
      {
        name: "description",
        content:
          "Leethe is a clutter-free movie and series streaming experience. No ads, just what you want to watch.",
      },
      { name: "author", content: "Leethe" },
      { property: "og:title", content: "Leethe - Movies & Series, on the go" },
      {
        property: "og:description",
        content:
          "Leethe is a clutter-free movie and series streaming experience. No ads, just what you want to watch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Leethe" },
      { name: "twitter:title", content: "Leethe - Movies & Series, on the go" },
      {
        name: "twitter:description",
        content:
          "Leethe is a clutter-free movie and series streaming experience. No ads, just what you want to watch.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "mask-icon", href: "/favicon.svg", color: "#38a9ff" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ProductTelemetry />
      {/* Required: nested routes render here */}
      <Outlet />
    </QueryClientProvider>
  );
}
