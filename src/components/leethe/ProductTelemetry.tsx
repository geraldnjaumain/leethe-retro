import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { recordClientEvent } from "@/lib/product-telemetry";

export function ProductTelemetry() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    recordClientEvent("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
