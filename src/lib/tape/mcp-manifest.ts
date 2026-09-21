export type JsonSchema = {
  type: "object";
  properties?: Record<string, { type: string; description?: string }>;
  required?: string[];
};

export type McpVia =
  | { file: string; service: string; method: string }
  | { endpoint: string; method: string; service: string };

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  via: McpVia;
};

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_price",
    description: "Read BEM/USDT from an on-chain file. No send.",
    inputSchema: { type: "object", properties: {} },
    via: { file: "/data/price.json", service: "price", method: "get" },
  },
  {
    name: "jev_decide",
    description:
      "Ask JEV to pick one option for a situation. Typed choice, no text. TAP-10 send to #9104@0.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "The situation to judge" },
        question: { type: "string", description: "What to decide" },
        options: {
          type: "string",
          description: "Comma-separated options to choose between (2-8)",
        },
      },
      required: ["state", "question", "options"],
    },
    via: { endpoint: "#9104@0", method: "decide", service: "jev" },
  },
  {
    name: "save_score",
    description: "Write a score. TAP-10 send to #9103@0.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Player name" },
        score: { type: "number", description: "Score to save" },
      },
      required: ["name", "score"],
    },
    via: { endpoint: "#9103@0", method: "save", service: "game" },
  },
];

export const MCP_MANIFEST = {
  webmcp: true,
  endpoint: "#8801@0",
  origin: "https://8801-0.tapekit.org",
  tools: MCP_TOOLS,
};

export function isFileVia(via: McpVia): via is Extract<McpVia, { file: string }> {
  return "file" in via;
}
