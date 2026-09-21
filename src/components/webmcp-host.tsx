import { useEffect } from "react";
import { MCP_TOOLS, isFileVia, type McpToolDef } from "@/lib/tape/mcp-manifest";
import { t } from "@/lib/i18n";
import { useMcpUi } from "@/lib/tape/mcp-ui";
import { useTape } from "@/lib/tape/store";
import { getModelContext, nativeModelContext, type ToolDescriptor } from "@/lib/tape/webmcp";

function asText(result: unknown) {
  if (!result || typeof result !== "object") return String(result ?? "");
  const rec = result as Record<string, unknown>;
  if (typeof rec.text === "string") return rec.text;
  if (typeof rec.usd === "number") return `BEM ${rec.usd}`;
  const answer = firstChoiceAnswer(rec.answers);
  if (answer) {
    const confidence =
      typeof answer.confidence === "number" ? ` · confidence ${answer.confidence.toFixed(2)}` : "";
    return `${answer.choice}${confidence}`;
  }
  return JSON.stringify(result);
}

type ChoiceAnswer = {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

/** The single answer a `jev_decide` call returns, whatever its question name. */
function firstChoiceAnswer(answers: unknown): ChoiceAnswer | null {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  for (const value of Object.values(answers as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const answer = value as ChoiceAnswer;
    if (answer.type === "choice" && typeof answer.choice === "string") return answer;
  }
  return null;
}

export function WebMcpHost() {
  const setDecision = useMcpUi((s) => s.setDecision);
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
        applyPage(def.name, params, r.result, { setDecision, setScore });
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
  }, [askConsent, setDecision, setLast, setScore]);

  return null;
}

function bindParams(def: McpToolDef, input: Record<string, unknown>) {
  if (def.name === "jev_decide") {
    // The tool takes a plain comma-separated list; the wire wants a label map,
    // so each option becomes its own description (JEV reads them per option).
    const options = String(input.options ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .slice(0, 8);
    const criteria: Record<string, string> = {};
    options.forEach((label, index) => {
      criteria[label.slice(0, 32) || `option-${index + 1}`] = label;
    });
    return {
      kind: "choice",
      state: String(input.state ?? ""),
      questions: {
        answer: {
          type: "choice",
          instructions: String(input.question ?? ""),
          criteria,
        },
      },
    };
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
  ui: {
    setDecision: (decision: {
      tool: string;
      choice: string;
      confidence: number | null;
      probabilities: { label: string; value: number }[];
    }) => void;
    setScore: (n: number) => void;
  },
) {
  const rec = (result ?? {}) as Record<string, unknown>;
  if (name === "jev_decide") {
    const answer = firstChoiceAnswer(rec.answers);
    if (answer?.choice) {
      const requested = (params.questions as { answer?: { criteria?: Record<string, string> } })
        ?.answer?.criteria;
      const order = Object.keys(requested ?? {});
      const probabilities = Object.entries(answer.probabilities ?? {})
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
      ui.setDecision({
        tool: name,
        choice: answer.choice,
        confidence: typeof answer.confidence === "number" ? answer.confidence : null,
        probabilities,
      });
    }
  }
  if (name === "save_score") {
    ui.setScore(Number(params.score ?? 0));
  }
}
