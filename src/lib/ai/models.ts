/**
 * The model chain behind the AI-call page, and the request/response shapes
 * that go with it.
 *
 * Pure on purpose: the chain, the body and the reply parser are what the tests
 * can pin without a key and without a network round trip, and the server-only
 * caller (`client.server.ts`) stays a thin transport.
 *
 * One model answers, and the rest are the failover chain: OpenRouter's `models`
 * array is tried in order when the primary's providers are down, rate-limited
 * or refuse — the reply names the model that actually answered, and that is the
 * name the letter shows.
 */

/**
 * The chain the card fixes: one primary plus at most three fallbacks, all of
 * them `:free` so the trial costs nothing. The ids are pinned against the live
 * OpenRouter catalogue — a typo here is not a build error, it is a 404 on the
 * visitor's first call, and `chat.test.ts` asserts the exact order.
 */

/** Answers first; always the first entry of `MODEL_CHAIN`. */
export const PRIMARY_MODEL = "inclusionai/ling-3.0-flash-sante:free";

/**
 * The failover chain, in order — at most three, so one slow request cannot
 * walk through half the catalogue before the timeout.
 */
export const FALLBACK_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nex-agi/nex-n2.5-pro:free",
  "dots-studio/dots-3-note-preview:free",
];

/** Primary then fallbacks, in the exact order OpenRouter should try them. */
export const MODEL_CHAIN = [PRIMARY_MODEL, ...FALLBACK_MODELS];

/**
 * A one-shot question in a demo: no reasoning tokens wanted (they are billed,
 * they delay the reply and a visitor cannot see them), and a short answer.
 * `effort: "none"` is OpenRouter's documented "disable reasoning entirely";
 * models without reasoning simply ignore it.
 */
export const AI_REASONING = { effort: "none" } as const;
export const AI_MAX_TOKENS = 400;
export const AI_TIMEOUT_MS = 180_000;
export const AI_MAX_INPUT_CHARS = 500;

/**
 * The service's own voice. It answers in the language it was asked in: the
 * panel's samples are localized, and an English question followed by a Chinese
 * answer would read as a bug rather than as a demo.
 */
export const AI_SYSTEM_PROMPT = [
  "You are the AI service behind a DeWEB playground demo: a visitor mailed you",
  "one question through an on-chain messaging layer and is waiting for the reply.",
  "Answer in the same language as the question.",
  "Be direct and useful: at most three sentences unless asked for more.",
  "No preamble, no restating the question, no markdown headings.",
].join(" ");

export type ChatRequestBody = {
  model: string;
  models: string[];
  messages: { role: "system" | "user"; content: string }[];
  reasoning: { effort: string };
  max_tokens: number;
};

/**
 * The exact body one chat call sends: `model` answers, `models` is the
 * failover list OpenRouter walks when it cannot.
 *
 * The primary must NOT be repeated inside `models` — the API caps that array
 * at three entries ("'models' array must have 3 items or fewer", 400) and a
 * duplicated primary would spend one of the three slots on a model already
 * being tried.
 */
export function buildChatRequest(text: string, maxTokens = AI_MAX_TOKENS): ChatRequestBody {
  return {
    model: PRIMARY_MODEL,
    models: [...FALLBACK_MODELS],
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    reasoning: { ...AI_REASONING },
    max_tokens: maxTokens,
  };
}

export type ChatReply = {
  reply: string;
  /** The model that answered — not necessarily the primary (see the chain). */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** The provider stopped on its token cap: the answer is cut off. */
  truncated: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read one chat completion. Anything that is not a non-empty string answer is
 * a parse failure, never an empty success — the caller turns it into the same
 * `parse_error` the decision path reports.
 */
export function parseChatReply(json: unknown): ChatReply | null {
  const root = asRecord(json);
  const choices = root?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (typeof content !== "string") return null;
  const reply = content.trim();
  if (!reply) return null;
  const usage = asRecord(root?.usage);
  return {
    reply,
    model: typeof root?.model === "string" ? root.model : PRIMARY_MODEL,
    inputTokens: asNumber(usage?.prompt_tokens),
    outputTokens: asNumber(usage?.completion_tokens),
    truncated: choice?.finish_reason === "length",
  };
}

/** Cut a visitor's text to the size the service accepts (and says so). */
export function excerpt(text: string, max = AI_MAX_INPUT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
