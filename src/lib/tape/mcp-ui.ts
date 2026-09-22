import { create } from "zustand";

export type AgentLog = {
  id: string;
  kind: "list" | "call" | "consent" | "result" | "error";
  line: string;
};

export type ConsentAsk = {
  tool: string;
  /** BNB the call will actually settle, read from the service catalog. */
  priceBem: number;
  /** The container the letter is addressed to. */
  to: string;
  resolve: (ok: boolean) => void;
};

/** The last typed answer a page-level tool put on display. */
export type PageDecision = {
  tool: string;
  choice: string;
  confidence: number | null;
  probabilities: { label: string; value: number }[];
};

type McpUi = {
  /** The confirmation on screen: always the head of the queue, or null. */
  consent: ConsentAsk | null;
  /** How many confirmations are waiting behind the one on screen. */
  consentQueue: number;
  decision: PageDecision | null;
  /**
   * The score the site holds, or null when `save_score` has not run yet. It
   * used to default to 88, a number with no provenance: a visitor who never
   * called the tool saw a saved score that was never saved.
   */
  score: number | null;
  lastTool: string | null;
  lastResult: unknown;
  /**
   * The tool whose result just landed. The site pane rings that block for a
   * moment: a result shows up twice (the block and the agent's raw JSON), and
   * the ring says which block the call it belongs to is.
   */
  highlightTool: string | null;
  log: AgentLog[];
  setDecision: (decision: PageDecision | null) => void;
  setScore: (score: number) => void;
  setLast: (tool: string, result: unknown) => void;
  askConsent: (tool: string, priceBem: number, to: string) => Promise<boolean>;
  pushLog: (kind: AgentLog["kind"], line: string) => void;
  clearLog: () => void;
};

/** How long a fresh result stays ringed in the site pane. */
export const MCP_HIGHLIGHT_MS = 1_500;

export const useMcpUi = create<McpUi>((set) => {
  /**
   * Confirmations are a queue, not a slot. Two concurrent `executeTool` calls
   * used to overwrite one another — the second prompt replaced the first
   * resolver, so that `executeTool` never returned it at all. The UI still
   * shows one prompt; the rest wait their turn.
   */
  const waiting: ConsentAsk[] = [];
  const publish = () =>
    set({ consent: waiting[0] ?? null, consentQueue: Math.max(0, waiting.length - 1) });

  /**
   * The ring is cleared by a timer rather than by a component effect: two
   * results in quick succession must not leave the first block lit, and the
   * pane only has to render `highlightTool`.
   */
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    consent: null,
    consentQueue: 0,
    decision: null,
    score: null,
    lastTool: null,
    lastResult: null,
    highlightTool: null,
    log: [],
    setDecision: (decision) => set({ decision }),
    setScore: (score) => set({ score }),
    setLast: (tool, result) => {
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => set({ highlightTool: null }), MCP_HIGHLIGHT_MS);
      set({ lastTool: tool, lastResult: result, highlightTool: tool });
    },
    askConsent: (tool, priceBem, to) =>
      new Promise<boolean>((resolve) => {
        const ask: ConsentAsk = {
          tool,
          priceBem,
          to,
          resolve: (ok) => {
            const at = waiting.indexOf(ask);
            if (at >= 0) waiting.splice(at, 1);
            publish();
            resolve(ok);
          },
        };
        waiting.push(ask);
        publish();
      }),
    pushLog: (kind, line) =>
      set((s) => ({
        log: [{ id: crypto.randomUUID(), kind, line }, ...s.log].slice(0, 16),
      })),
    clearLog: () => set({ log: [] }),
  };
});
