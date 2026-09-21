import { create } from "zustand";

export type AgentLog = {
  id: string;
  kind: "list" | "call" | "consent" | "result" | "error";
  line: string;
};

export type ConsentAsk = {
  tool: string;
  /** BEM the call will actually settle, read from the service catalog. */
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
  score: number;
  lastTool: string | null;
  lastResult: unknown;
  log: AgentLog[];
  setDecision: (decision: PageDecision | null) => void;
  setScore: (score: number) => void;
  setLast: (tool: string, result: unknown) => void;
  askConsent: (tool: string, priceBem: number, to: string) => Promise<boolean>;
  pushLog: (kind: AgentLog["kind"], line: string) => void;
  clearLog: () => void;
};

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

  return {
    consent: null,
    consentQueue: 0,
    decision: null,
    score: 88,
    lastTool: null,
    lastResult: null,
    log: [],
    setDecision: (decision) => set({ decision }),
    setScore: (score) => set({ score }),
    setLast: (tool, result) => set({ lastTool: tool, lastResult: result }),
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
