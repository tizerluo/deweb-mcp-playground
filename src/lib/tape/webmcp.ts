import type { JsonSchema } from "./mcp-manifest";

export type PublicTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type AgentHandle = {
  requestUserInteraction: (cb: () => Promise<boolean>) => Promise<boolean>;
};

export type ToolDescriptor = PublicTool & {
  execute: (
    input: Record<string, unknown>,
    agent: AgentHandle,
  ) => Promise<unknown>;
};

export class TapeModelContext extends EventTarget {
  private tools = new Map<string, ToolDescriptor>();
  ontoolchange: ((ev: Event) => void) | null = null;

  registerTool(tool: ToolDescriptor, options?: { signal?: AbortSignal }) {
    this.tools.set(tool.name, tool);
    this.emitChange();
    options?.signal?.addEventListener("abort", () => {
      if (this.tools.get(tool.name) === tool) {
        this.tools.delete(tool.name);
        this.emitChange();
      }
    });
  }

  getTools(): PublicTool[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async executeTool(name: string, input: Record<string, unknown> = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const agent: AgentHandle = {
      requestUserInteraction: async (cb) => cb(),
    };
    return tool.execute(input, agent);
  }

  private emitChange() {
    const ev = new Event("toolchange");
    this.dispatchEvent(ev);
    this.ontoolchange?.(ev);
  }
}

declare global {
  interface Document {
    modelContext?: TapeModelContext;
  }
  interface Navigator {
    modelContext?: TapeModelContext;
  }
  interface Window {
    tape?: {
      call: (
        service: string,
        method: string,
        params: Record<string, unknown>,
        opts?: { pay?: boolean },
      ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
    };
  }
}

let ctx: TapeModelContext | null = null;

function isOurs(value: unknown): value is TapeModelContext {
  return value instanceof TapeModelContext;
}

export function getModelContext(): TapeModelContext | null {
  if (typeof document === "undefined") return null;
  if (ctx) return ctx;
  ctx = new TapeModelContext();
  if (!document.modelContext) {
    Object.defineProperty(document, "modelContext", {
      value: ctx,
      configurable: true,
    });
  }
  if (!navigator.modelContext) {
    Object.defineProperty(navigator, "modelContext", {
      value: ctx,
      configurable: true,
    });
  }
  return ctx;
}

export function nativeModelContext(): {
  registerTool?: (tool: ToolDescriptor, options?: { signal?: AbortSignal }) => void;
} | null {
  if (typeof document === "undefined") return null;
  const native = document.modelContext;
  if (!native || isOurs(native)) return null;
  return native as {
    registerTool?: (tool: ToolDescriptor, options?: { signal?: AbortSignal }) => void;
  };
}
