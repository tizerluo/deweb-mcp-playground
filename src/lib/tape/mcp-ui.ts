import { create } from "zustand";
import { NPC_DEFAULT } from "./mcp-manifest";

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

type McpUi = {
  npc: string;
  score: number;
  lastTool: string | null;
  lastResult: unknown;
  consent: ConsentAsk | null;
  log: AgentLog[];
  setNpc: (npc: string) => void;
  setScore: (score: number) => void;
  setLast: (tool: string, result: unknown) => void;
  askConsent: (tool: string, priceBem: number) => Promise<boolean>;
  pushLog: (kind: AgentLog["kind"], line: string) => void;
  clearLog: () => void;
};

export const useMcpUi = create<McpUi>((set) => ({
  npc: NPC_DEFAULT,
  score: 88,
  lastTool: null,
  lastResult: null,
  consent: null,
  log: [],
  setNpc: (npc) => set({ npc }),
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
