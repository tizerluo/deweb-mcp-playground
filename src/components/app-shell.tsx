import type { ReactNode } from "react";
import { IdentityBar } from "@/components/identity-bar";
import { ProtocolTrace } from "@/components/protocol-trace";
import { ServiceRail } from "@/components/service-rail";

export function AppShell({
  children,
  slug,
}: {
  children: ReactNode;
  slug?: string;
}) {
  return (
    <div className="tape-grid min-h-dvh bg-bg text-fg">
      <IdentityBar />
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:gap-6 lg:py-6">
        <ServiceRail active={slug} />
        <div className="min-w-0">{children}</div>
        <ProtocolTrace />
      </div>
    </div>
  );
}
