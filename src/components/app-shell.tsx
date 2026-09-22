import type { ReactNode } from "react";
import { IdentityBar } from "@/components/identity-bar";
import { ProtocolTrace } from "@/components/protocol-trace";
import { ServiceRail } from "@/components/service-rail";
import { cn } from "@/lib/utils";

/**
 * The site frame. `rail`/`trace` are per-page: the catalog and every service
 * page keep both columns, but the home page is a cover — there is no service
 * list to pick from yet, and an empty trace saying "run a demo" beside the
 * hero reads as a broken widget rather than a hint.
 *
 * The four layouts are written out as literals on purpose: Tailwind scans
 * source text for class names, so a `grid-cols` built from a template string
 * would never make it into the stylesheet.
 */
const LAYOUT = {
  railTrace: "lg:grid-cols-[220px_minmax(0,1fr)_300px]",
  rail: "lg:grid-cols-[220px_minmax(0,1fr)]",
  trace: "lg:grid-cols-[minmax(0,1fr)_300px]",
  alone: "lg:grid-cols-1",
} as const;

export function AppShell({
  children,
  slug,
  rail = true,
  trace = true,
}: {
  children: ReactNode;
  slug?: string;
  rail?: boolean;
  trace?: boolean;
}) {
  const layout =
    rail && trace ? LAYOUT.railTrace : rail ? LAYOUT.rail : trace ? LAYOUT.trace : LAYOUT.alone;
  return (
    <div className="tape-grid min-h-dvh bg-bg text-fg">
      <IdentityBar />
      <div
        className={cn("mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:gap-6 lg:py-6", layout)}
      >
        {rail ? <ServiceRail active={slug} /> : null}
        <div className="min-w-0">{children}</div>
        {trace ? <ProtocolTrace /> : null}
      </div>
    </div>
  );
}
