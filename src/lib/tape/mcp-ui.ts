import { create } from "zustand";

export type AgentLog = {
  id: string;
  kind: "list" | "call" | "consent" | "result" | "error";
  line: string;
};

export type ConsentAsk = {
  tool: string;
  priceBem: number;
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
  decision: PageDecision | null;
  score: number;
  lastTool: string | null;
  lastResult: unknown;
  consent: ConsentAsk | null;
  log: AgentLog[];
  setDecision: (decision: PageDecision | null) => void;
  setScore: (score: number) => void;
  setLast: (tool: string, result: unknown) => void;
  askConsent: (tool: string, priceBem: number) => Promise<boolean>;
  pushLog: (kind: AgentLog["kind"], line: string) => void;
  clearLog: () => void;
};

export const useMcpUi = create<McpUi>((set) => ({
  decision: null,
  score: 88,
  lastTool: null,
  lastResult: null,
  consent: null,
  log: [],
  setDecision: (decision) => set({ decision }),
  setScore: (score) => set({ score }),
  setLast: (tool, result) => set({ lastTool: tool, lastResult: result }),
  askConsent: (tool, priceBem) =>
    new Promise<boolean>((resolve) => {
      set({
        consent: {
          tool,
          priceBem,
          resolve: (ok) => {
            set({ consent: null });
            resolve(ok);
          },
        },
      });
    }),
  pushLog: (kind, line) =>
    set((s) => ({
      log: [{ id: crypto.randomUUID(), kind, line }, ...s.log].slice(0, 16),
    })),
  clearLog: () => set({ log: [] }),
}));
