import { createFileRoute, Link } from "@tanstack/react-router";
import { IdentityBar } from "@/components/identity-bar";
import { ProtocolTrace } from "@/components/protocol-trace";
import { ServiceRail } from "@/components/service-rail";
import { WebMcpPlayground } from "@/components/webmcp-playground";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/mcp")({ component: McpPage });

function McpPage() {
  const t = useT();
  return (
    <div className="tape-grid min-h-dvh bg-bg text-fg">
      <IdentityBar />
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              {t("mcp.kicker")}
            </p>
            <h1 className="mt-1 text-xl font-medium tracking-tight sm:text-2xl">
              {t("mcp.title")}
            </h1>
            <p className="mt-1 text-xs text-muted">{t("mcp.lead")}</p>
            {/* The order matters: a visitor who starts with jev_decide sees a
                confirmation before they have seen either tool work, and reads
                the prompts as friction rather than as the point. */}
            <p className="mt-1 text-xs text-muted">{t("mcp.tryOrder")}</p>
          </div>
          <Link
            to="/spec"
            className="text-xs text-muted transition-colors duration-[var(--motion-quick)] hover:text-fg"
          >
            {t("mcp.specLink")}
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:gap-6">
          <ServiceRail active="mcp" />
          <div className="min-w-0">
            <WebMcpPlayground />
          </div>
          <ProtocolTrace />
        </div>
      </div>
    </div>
  );
}
