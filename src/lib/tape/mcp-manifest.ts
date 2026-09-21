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
    name: "translate_dialogue",
    description: "Translate a line. TAP-10 send to #9102@0.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Source line" },
        to: { type: "string", description: "Target language code, e.g. zh, ja" },
      },
      required: ["text", "to"],
    },
    via: { endpoint: "#9102@0", method: "translate", service: "translate" },
  },
  {
    name: "ask_npc",
    description: "Ask the NPC a short question. TAP-10 send to #9104@0.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What the player says" },
      },
      required: ["prompt"],
    },
    via: { endpoint: "#9104@0", method: "complete", service: "ai" },
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

export const NPC_DEFAULT =
  "The circuit is live. Hash the NAND, keep the tape.";

export function isFileVia(via: McpVia): via is Extract<McpVia, { file: string }> {
  return "file" in via;
}
