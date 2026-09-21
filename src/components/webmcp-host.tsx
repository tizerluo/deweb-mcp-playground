import { useEffect } from "react";
import {
  MCP_TOOLS,
  NPC_DEFAULT,
  isFileVia,
  type McpToolDef,
} from "@/lib/tape/mcp-manifest";
import { t } from "@/lib/i18n";
import { useMcpUi } from "@/lib/tape/mcp-ui";
import { useTape } from "@/lib/tape/store";
import {
  getModelContext,
  nativeModelContext,
  type ToolDescriptor,
} from "@/lib/tape/webmcp";

function asText(result: unknown) {
  if (!result || typeof result !== "object") return String(result ?? "");
  const rec = result as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.usd === "number") return `BEM ${rec.usd}`;
  return JSON.stringify(result);
}

export function WebMcpHost() {
  const setNpc = useMcpUi((s) => s.setNpc);
  const setScore = useMcpUi((s) => s.setScore);
  const setLast = useMcpUi((s) => s.setLast);
  const askConsent = useMcpUi((s) => s.askConsent);
  const refreshPrice = useTape((s) => s.refreshPrice);

  useEffect(() => {
    void refreshPrice();
  }, [refreshPrice]);

  useEffect(() => {
    const ctx = getModelContext();
    if (!ctx) return;
    const ac = new AbortController();

    const tools: ToolDescriptor[] = MCP_TOOLS.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      execute: async (input) => {
        if (!window.tape) throw new Error(t("err.fail"));
        if (!isFileVia(def.via)) {
          const ok = await askConsent(def.name, 0);
          if (!ok) throw new Error(t("mcp.declined"));
        }
        const params = bindParams(def, input);
        const r = await window.tape.call(def.via.service, def.via.method, params, {
          pay: !isFileVia(def.via),
        });
        if (!r.ok) throw new Error(r.error ?? t("err.fail"));
        applyPage(def.name, params, r.result, { setNpc, setScore });
        setLast(def.name, r.result);
        return {
          content: [{ type: "text", text: asText(r.result) }],
        };
      },
    }));

    const native = nativeModelContext();
    for (const tool of tools) {
      ctx.registerTool(tool, { signal: ac.signal });
      native?.registerTool?.(tool, { signal: ac.signal });
    }

    return () => ac.abort();
  }, [askConsent, setLast, setNpc, setScore]);

  return null;
}

function bindParams(def: McpToolDef, input: Record<string, unknown>) {
  if (def.name === "translate_dialogue") {
    return {
      text: String(input.text ?? NPC_DEFAULT),
      from: "auto",
      to: String(input.to ?? "zh"),
    };
  }
  if (def.name === "ask_npc") {
    return { prompt: String(input.prompt ?? "") };
  }
  if (def.name === "save_score") {
    return {
      name: String(input.name ?? "arcade"),
      score: Number(input.score ?? 0),
    };
  }
  return { ...input };
}

function applyPage(
  name: string,
  params: Record<string, unknown>,
  result: unknown,
  ui: { setNpc: (s: string) => void; setScore: (n: number) => void },
) {
  const rec = (result ?? {}) as Record<string, unknown>;
  if (name === "translate_dialogue" && typeof rec.text === "string") {
    ui.setNpc(rec.text);
  }
  if (name === "ask_npc" && typeof rec.text === "string") {
    ui.setNpc(rec.text);
  }
  if (name === "save_score") {
    ui.setScore(Number(params.score ?? 0));
  }
}
