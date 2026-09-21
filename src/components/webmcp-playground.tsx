import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MCP_MANIFEST, MCP_TOOLS, isFileVia, type McpToolDef } from "@/lib/tape/mcp-manifest";
import { useMcpUi } from "@/lib/tape/mcp-ui";
import { useTape } from "@/lib/tape/store";
import { getModelContext } from "@/lib/tape/webmcp";
import { WebMcpHost } from "@/components/webmcp-host";
import { t, useT } from "@/lib/i18n";

export function WebMcpPlayground() {
  return (
    <>
      <WebMcpHost />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="order-2 lg:order-1">
          <SitePane />
        </div>
        <div className="order-1 lg:order-2">
          <AgentPane />
        </div>
      </div>
    </>
  );
}

function SitePane() {
  const t = useT();
  const decision = useMcpUi((s) => s.decision);
  const score = useMcpUi((s) => s.score);
  const lastTool = useMcpUi((s) => s.lastTool);
  const price = useTape((s) => s.price);
  const board = useTape((s) => s.board);

  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-accent">8801-0.tapekit.org</p>
          <h2 className="mt-1 text-base font-medium">NAND Arcade</h2>
        </div>
        <Badge variant="live">{t("mcp.origin")}</Badge>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{t("mcp.siteLead")}</p>

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2 rounded-lg bg-raised px-3 py-3 shadow-[var(--shadow-border)]">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">BEM</p>
          <p className="mt-1 font-mono text-base tabular-nums">
            {price?.ok ? `$${price.usd.toFixed(4)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            {t("mcp.score")}
          </p>
          <p className="mt-1 font-mono text-base tabular-nums">{score}</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-raised p-4 shadow-[var(--shadow-border)]">
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          {t("mcp.decision")}
        </p>
        {decision ? (
          <>
            <p className="mt-2 text-sm leading-relaxed">
              {decision.choice}
              {decision.confidence === null
                ? ""
                : ` · ${t("jev.confidence")} ${decision.confidence.toFixed(2)}`}
            </p>
            <div className="mt-2 grid gap-1">
              {decision.probabilities.map((row) => (
                <div key={row.label} className="grid grid-cols-[64px_1fr_44px] items-center gap-2">
                  <span className="truncate font-mono text-[10px] text-subtle">{row.label}</span>
                  <span className="h-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${Math.round(Math.min(1, row.value) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[10px] tabular-nums text-muted">
                    {row.value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted">{t("mcp.decisionEmpty")}</p>
        )}
        {lastTool ? (
          <p className="mt-2 font-mono text-[10px] text-accent">last tool · {lastTool}</p>
        ) : null}
      </div>

      <ol className="mt-4 space-y-1.5">
        {board.slice(0, 3).map((row, i) => (
          <li
            key={`${row.from}-${row.at}`}
            className="flex justify-between gap-3 font-mono text-[11px] text-muted"
          >
            <span>
              {i + 1} {row.name}
            </span>
            <span className="tabular-nums text-fg">{row.score}</span>
          </li>
        ))}
      </ol>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted">{t("mcp.viewJson")}</summary>
        <pre className="mt-2 overflow-auto rounded-md bg-raised p-3 font-mono text-[10px] leading-relaxed text-muted">
          {JSON.stringify(
            {
              webmcp: true,
              tools: MCP_MANIFEST.tools.map((tool) => ({
                name: tool.name,
                via: isFileVia(tool.via)
                  ? { file: tool.via.file }
                  : { endpoint: tool.via.endpoint, method: tool.via.method },
              })),
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}

function AgentPane() {
  const t = useT();
  const tools = MCP_TOOLS;
  const [name, setName] = useState(tools[0]?.name ?? "get_price");
  const current = tools.find((t) => t.name === name) ?? tools[0];
  const defaults = useMemo(() => defaultArgs(current?.name ?? ""), [current?.name]);
  const [args, setArgs] = useState<Record<string, string>>(defaults);
  const [busy, setBusy] = useState(false);
  const log = useMcpUi((s) => s.log);
  const pushLog = useMcpUi((s) => s.pushLog);
  const lastResult = useMcpUi((s) => s.lastResult);
  const consent = useMcpUi((s) => s.consent);
  const tapeBusy = useTape((s) => s.busy);

  const fields = Object.entries(current?.inputSchema.properties ?? {});

  async function run(toolName: string, payload: Record<string, unknown>) {
    const ctx = getModelContext();
    if (!ctx) return;
    setBusy(true);
    pushLog("call", `executeTool("${toolName}")`);
    try {
      const listed = ctx.getTools().map((t) => t.name);
      pushLog("list", `getTools → ${listed.join(", ")}`);
      const result = await ctx.executeTool(toolName, payload);
      pushLog("result", JSON.stringify(result));
    } catch (err) {
      pushLog("error", err instanceof Error ? err.message : t("kind.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">Agent</h2>
        <Badge variant="mode">document.modelContext</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">{t("mcp.agentHint")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {tools.map((t) => (
          <Button
            key={t.name}
            type="button"
            size="sm"
            variant={t.name === name ? "default" : "secondary"}
            onClick={() => {
              setName(t.name);
              setArgs(defaultArgs(t.name));
            }}
          >
            {t.name}
          </Button>
        ))}
      </div>

      <p className="mt-3 font-mono text-xs text-ok">
        {current && isFileVia(current.via) ? t("mcp.fileHint") : t("mcp.sendHint")}
      </p>

      {consent ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-3 shadow-[var(--shadow-border)]">
          <p className="text-xs text-muted">{t("mcp.consent", { tool: consent.tool })}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => consent.resolve(false)}>
              {t("mcp.deny")}
            </Button>
            <Button size="sm" onClick={() => consent.resolve(true)}>
              {t("mcp.allow")}
            </Button>
          </div>
        </div>
      ) : null}

      {fields.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {fields.map(([key, schema]) => (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={`mcp-${key}`}>{key}</Label>
              {schema.type === "string" && key !== "to" && String(args[key] ?? "").length > 40 ? (
                <Textarea
                  id={`mcp-${key}`}
                  value={args[key] ?? ""}
                  onChange={(e) => setArgs((s) => ({ ...s, [key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`mcp-${key}`}
                  type={schema.type === "number" ? "number" : "text"}
                  value={args[key] ?? ""}
                  onChange={(e) => setArgs((s) => ({ ...s, [key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy || tapeBusy || !current}
          onClick={() => {
            if (!current) return;
            void run(current.name, coerce(current, args));
          }}
        >
          executeTool
        </Button>
        <Button
          variant="secondary"
          disabled={busy || tapeBusy}
          onClick={() => {
            const ctx = getModelContext();
            pushLog(
              "list",
              `getTools → ${(ctx?.getTools() ?? []).map((t) => t.name).join(", ") || "(empty)"}`,
            );
          }}
        >
          getTools
        </Button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{current?.description}</p>

      {lastResult != null ? (
        <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-raised p-3 font-mono text-[10px] leading-relaxed text-muted">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      ) : null}

      <ul className="mt-4 space-y-1.5">
        {log.length === 0 ? (
          <li className="text-xs text-subtle">{t("mcp.emptyLog")}</li>
        ) : (
          log.slice(0, 6).map((row) => (
            <li key={row.id} className="font-mono text-[10px] leading-relaxed text-muted">
              <span className="text-accent">{row.kind}</span> {row.line}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function defaultArgs(name: string): Record<string, string> {
  if (name === "jev_decide") {
    return {
      state: t("jev.sample.state"),
      question: t("jev.sample.question"),
      options: t("jev.sample.options"),
    };
  }
  if (name === "save_score") {
    return { name: "arcade", score: "88" };
  }
  return {};
}

function coerce(def: McpToolDef, args: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(def.inputSchema.properties ?? {})) {
    const raw = args[key] ?? "";
    out[key] = schema.type === "number" ? Number(raw) : raw;
  }
  return out;
}
