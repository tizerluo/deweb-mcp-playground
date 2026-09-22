/**
 * TypeSafe System One (JEV) wire protocol — pure helpers only: no `process.env`,
 * no network, no browser globals. The server-side client (`client.server.ts`)
 * imports this module; the unit tests import it directly, which is why it must
 * stay dependency-free.
 *
 * JEV does not generate text. Callers send a `state` plus typed questions and
 * get back typed answers: `choice` / `score` / `noul`, with calibrated
 * probabilities and (for choice/score) a confidence.
 */

export const JEV_KINDS = ["choice", "score", "noul"] as const;
export type JevQuestionKind = (typeof JEV_KINDS)[number];

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
};

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;
export type JevQuestions = Record<string, JevQuestion>;

/** The validated, truncated request body a caller may send. */
export type JevRequest = {
  kind: JevQuestionKind;
  state: string;
  questions: JevQuestions;
};

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number | null;
  probabilities: Record<string, number> | null;
};

export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string> | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
};

export type JevNoulAnswer = { type: "noul"; noul: number };

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  inputTokens: number | null;
  outputTokens: number | null;
};

/** Every failure the layer can report, in the `{ ok: false, reason }` shape. */
export const JEV_FAILURE_REASONS = [
  "invalid_request",
  "no_key",
  "rate_limited",
  "quota",
  "unauthorized",
  "bad_request",
  "upstream",
  "timeout",
  "network",
  "parse_error",
] as const;
export type JevFailureReason = (typeof JEV_FAILURE_REASONS)[number];

/** Reasons that a retry may clear (used for backoff hints). */
export function isJevTransient(reason: JevFailureReason): boolean {
  return (
    reason === "rate_limited" ||
    reason === "upstream" ||
    reason === "timeout" ||
    reason === "network"
  );
}

/**
 * Why a decision did not come from JEV: a provider failure, or the
 * playground's own escrow refusing the send (no BNB left). The UI localizes
 * both through the same `jev.err.<reason>` keys.
 */
export type JevDecisionReason = JevFailureReason | "insufficient_bem";

// ---------------------------------------------------------------- limits ----

export const JEV_MAX_STATE_CHARS = 4_000;
export const JEV_MAX_INSTRUCTION_CHARS = 1_200;
export const JEV_MAX_QUESTIONS = 4;
export const JEV_MAX_CHOICE_LABELS = 16;
export const JEV_MAX_SCORE_LEVELS = 10;
export const JEV_MAX_LABEL_CHARS = 48;
export const JEV_MAX_LABEL_DESC_CHARS = 240;

/** Server-side request budget. Matches the brief's "timeout ≤ 3s". */
export const JEV_TIMEOUT_MS = 3_000;

/**
 * Local safety net around the provider (env-tunable: `JEV_RATE_PER_MINUTE`,
 * `JEV_RATE_BURST`).
 *
 * The burst ceiling is the brief's 30 calls — a tight retry loop must not get
 * through. The sustained refill is not 30/min because the snake asks once per
 * tick: 67/min at the 900 ms default and 171/min at the 350 ms "fast" setting.
 * A 30/min sustained ceiling would throttle a normal round — exactly what the
 * review checklist rules out ("限流存在且正常局不被误伤"). 240/min (4/s) still
 * binds hard on a runaway loop and sits far below the point where the gateway
 * starts answering 429, which the cooldown handles separately.
 */
export const JEV_RATE_BURST = 30;
export const JEV_RATE_PER_MINUTE = 240;

// ---------------------------------------------------------------- backends --

export type JevBackendId = "gateway" | "direct";

export type JevBackend = {
  id: JevBackendId;
  url: string;
  model: string;
  /** Environment variable holding this backend's key (server side only). */
  keyVar: "AI_GATEWAY_API_KEY" | "TYPESAFE_API_KEY";
};

export const JEV_BACKENDS: Record<JevBackendId, JevBackend> = {
  gateway: {
    id: "gateway",
    url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
    keyVar: "AI_GATEWAY_API_KEY",
  },
  direct: {
    id: "direct",
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    keyVar: "TYPESAFE_API_KEY",
  },
};

/**
 * Pick the backend: AI Gateway first (the deployed path), official direct
 * second (local dev / fallback), `null` when neither key is configured — which
 * is the playground's documented degrade-to-local-policy mode, not an error.
 */
export function selectJevBackend(env: Record<string, string | undefined>): JevBackend | null {
  if (env.AI_GATEWAY_API_KEY?.trim()) return JEV_BACKENDS.gateway;
  if (env.TYPESAFE_API_KEY?.trim()) return JEV_BACKENDS.direct;
  return null;
}

/**
 * The canonical request the spec page shows. Exported, and tested against
 * `sanitizeJevRequest`, so the page cannot drift into an example the server
 * would refuse (a missing `instructions`, a choice with one option).
 */
export const JEV_REQUEST_EXAMPLE: JevRequest = {
  kind: "choice",
  state: "snake at 6,6 — heading right; food at 8,6",
  questions: {
    direction: {
      type: "choice",
      instructions:
        "Pick the snake's next move. Leaving the grid or touching its own body ends the round; eating grows it.",
      criteria: {
        up: "3 free cells reachable; food 2 rows away",
        right: "food 2 cells ahead; 11 free cells reachable",
        down: "pocket too small: 1 free cell reachable",
      },
    },
  },
};

// ------------------------------------------------------------- validation ---

export type SanitizeResult =
  { ok: true; request: JevRequest } | { ok: false; reason: "invalid_request"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitizeQuestion(
  kind: JevQuestionKind,
  raw: unknown,
): { ok: true; question: JevQuestion } | { ok: false; message: string } {
  if (!isPlainObject(raw)) return { ok: false, message: "question must be an object" };
  if (raw.type !== kind) {
    return { ok: false, message: `question.type must be "${kind}"` };
  }
  const instructions = clampText(raw.instructions, JEV_MAX_INSTRUCTION_CHARS);
  if (!instructions) return { ok: false, message: "question.instructions is required" };

  if (kind === "choice") {
    if (!isPlainObject(raw.criteria)) {
      return { ok: false, message: "choice.criteria must be a label map" };
    }
    const labels = Object.entries(raw.criteria);
    if (labels.length < 2) {
      return { ok: false, message: "choice.criteria needs at least 2 labels" };
    }
    if (labels.length > JEV_MAX_CHOICE_LABELS) {
      return { ok: false, message: "choice.criteria has too many labels" };
    }
    const criteria: Record<string, string> = {};
    const seen = new Set<string>();
    for (const [label, description] of labels) {
      const key = clampText(label, JEV_MAX_LABEL_CHARS);
      if (!key) return { ok: false, message: "choice.criteria has an empty label" };
      // Two labels that only differ past the truncation point rebuild into one
      // key: the request would go upstream as a "choice" with fewer options
      // than it was validated with (possibly a single one), so it is refused
      // instead of silently merged.
      if (seen.has(key)) {
        return {
          ok: false,
          message: `choice.criteria labels collide once truncated to ${JEV_MAX_LABEL_CHARS} characters`,
        };
      }
      seen.add(key);
      const text = clampText(description, JEV_MAX_LABEL_DESC_CHARS) ?? key;
      criteria[key] = text;
    }
    return { ok: true, question: { type: "choice", instructions, criteria } };
  }

  if (kind === "score") {
    if (!Array.isArray(raw.criteria)) {
      return { ok: false, message: "score.criteria must be an ordered list" };
    }
    if (raw.criteria.length < 2) {
      return { ok: false, message: "score.criteria needs at least 2 levels" };
    }
    if (raw.criteria.length > JEV_MAX_SCORE_LEVELS) {
      return { ok: false, message: "score.criteria has too many levels" };
    }
    const levels: string[] = [];
    for (const level of raw.criteria) {
      const text = clampText(level, JEV_MAX_LABEL_DESC_CHARS);
      if (!text) return { ok: false, message: "score.criteria has an empty level" };
      levels.push(text);
    }
    return { ok: true, question: { type: "score", instructions, criteria: levels } };
  }

  return { ok: true, question: { type: "noul", instructions } };
}

/**
 * Validate + truncate anything a client sends. The handler never forwards a
 * caller-shaped object to the model: only this function's output is sent.
 */
export function sanitizeJevRequest(input: unknown): SanitizeResult {
  if (!isPlainObject(input)) {
    return { ok: false, reason: "invalid_request", message: "body must be an object" };
  }
  const kind = input.kind;
  if (typeof kind !== "string" || !JEV_KINDS.includes(kind as JevQuestionKind)) {
    return { ok: false, reason: "invalid_request", message: "kind must be choice|score|noul" };
  }
  const state = clampText(input.state, JEV_MAX_STATE_CHARS);
  if (!state) {
    return { ok: false, reason: "invalid_request", message: "state is required" };
  }
  if (!isPlainObject(input.questions)) {
    return { ok: false, reason: "invalid_request", message: "questions must be an object" };
  }
  const entries = Object.entries(input.questions);
  if (entries.length === 0) {
    return { ok: false, reason: "invalid_request", message: "questions is empty" };
  }
  if (entries.length > JEV_MAX_QUESTIONS) {
    return { ok: false, reason: "invalid_request", message: "too many questions" };
  }
  const questions: JevQuestions = {};
  const names = new Set<string>();
  for (const [name, raw] of entries) {
    const key = clampText(name, JEV_MAX_LABEL_CHARS);
    if (!key) return { ok: false, reason: "invalid_request", message: "empty question name" };
    // Same rule as the criteria labels: a truncated name must not overwrite a
    // question that was already validated (the caller would get an answer map
    // with fewer keys than it asked with).
    if (names.has(key)) {
      return {
        ok: false,
        reason: "invalid_request",
        message: `question names collide once truncated to ${JEV_MAX_LABEL_CHARS} characters`,
      };
    }
    names.add(key);
    const question = sanitizeQuestion(kind as JevQuestionKind, raw);
    if (!question.ok) {
      return { ok: false, reason: "invalid_request", message: question.message };
    }
    questions[key] = question.question;
  }
  return { ok: true, request: { kind: kind as JevQuestionKind, state, questions } };
}

// ---------------------------------------------------------------- answers ---

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toProbabilityMap(value: unknown): Record<string, number> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = toNumber(raw);
    if (n !== null) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toLegend(value: unknown): Record<string, string> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseAnswer(
  key: string,
  raw: unknown,
): { ok: true; answer: JevAnswer } | { ok: false; message: string } {
  if (!isPlainObject(raw)) return { ok: false, message: `answers.${key} is not an object` };
  const type = raw.type;
  if (type === "choice") {
    const choice = clampText(raw.choice, JEV_MAX_LABEL_CHARS);
    if (!choice) return { ok: false, message: `answers.${key}.choice is missing` };
    return {
      ok: true,
      answer: {
        type: "choice",
        choice,
        confidence: toNumber(raw.confidence),
        probabilities: toProbabilityMap(raw.probabilities),
      },
    };
  }
  if (type === "score") {
    const score = toNumber(raw.score);
    if (score === null) return { ok: false, message: `answers.${key}.score is missing` };
    return {
      ok: true,
      answer: {
        type: "score",
        score,
        legend: toLegend(raw.legend),
        confidence: toNumber(raw.confidence),
        probabilities: toProbabilityMap(raw.probabilities),
      },
    };
  }
  if (type === "noul") {
    const noul = toNumber(raw.noul);
    if (noul === null) return { ok: false, message: `answers.${key}.noul is missing` };
    return { ok: true, answer: { type: "noul", noul } };
  }
  return { ok: false, message: `answers.${key} has an unknown type` };
}

export type ParseResult =
  { ok: true; response: JevResponse } | { ok: false; reason: JevFailureReason; message: string };

/** Structural validation of the provider body. Never trusts the shape. */
export function parseJevResponse(json: unknown): ParseResult {
  if (!isPlainObject(json)) {
    return { ok: false, reason: "parse_error", message: "response is not an object" };
  }
  if (!isPlainObject(json.answers)) {
    return { ok: false, reason: "parse_error", message: "response has no answers" };
  }
  const answers: Record<string, JevAnswer> = {};
  for (const [key, raw] of Object.entries(json.answers)) {
    const parsed = parseAnswer(key, raw);
    if (!parsed.ok) {
      return { ok: false, reason: "parse_error", message: parsed.message };
    }
    answers[key] = parsed.answer;
  }
  if (Object.keys(answers).length === 0) {
    return { ok: false, reason: "parse_error", message: "response answers are empty" };
  }
  const usage = isPlainObject(json.usage) ? json.usage : {};
  return {
    ok: true,
    response: {
      model: typeof json.model === "string" ? json.model : "unknown",
      answers,
      inputTokens: toNumber(usage.input_tokens),
      outputTokens: toNumber(usage.output_tokens),
    },
  };
}

/** Map an HTTP status (plus the provider's `error_type`) to a failure reason. */
export function classifyJevStatus(status: number, errorType?: string): JevFailureReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 402) return "quota";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream";
  if (status >= 400) return errorType === "invalid_request" ? "invalid_request" : "bad_request";
  return "upstream";
}

// ------------------------------------------------------------- rate limit ---

/**
 * Token bucket. The class itself is configuration-free; the defaults live in
 * `JEV_RATE_BURST` / `JEV_RATE_PER_MINUTE` above (see the note there for why
 * the sustained default is not the brief's 30/min). The bucket's job is to
 * stop a runaway loop and to make the limit visible to the caller as
 * `rate_limited` instead of provider-side abuse.
 */
export class TokenBucket {
  readonly capacity: number;
  readonly refillPerMs: number;
  private tokens: number;
  private updatedAt: number;

  constructor(opts: { capacity: number; refillPerMinute: number; now?: number }) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMinute / 60_000;
    this.tokens = opts.capacity;
    this.updatedAt = opts.now ?? 0;
  }

  available(now: number): number {
    this.refill(now);
    return this.tokens;
  }

  tryTake(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(now: number) {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.updatedAt = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
  }
}

/**
 * Exponential cooldown after upstream 429s. The gateway's free tier throttles
 * hard; backing off locally keeps a snake round from hammering it (and from
 * looking like abuse) while still recovering after the pause.
 */
export class JevCooldown {
  readonly baseMs: number;
  readonly maxMs: number;
  private until = 0;
  private step = 0;

  constructor(opts: { baseMs: number; maxMs: number }) {
    this.baseMs = opts.baseMs;
    this.maxMs = opts.maxMs;
  }

  remainingMs(now: number): number {
    return Math.max(0, this.until - now);
  }

  noteThrottled(now: number): void {
    const wait = Math.min(this.maxMs, this.baseMs * 2 ** this.step);
    this.step = Math.min(this.step + 1, 8);
    this.until = Math.max(this.until, now + wait);
  }

  noteSuccess(): void {
    this.step = 0;
    this.until = 0;
  }
}

/** Tiny TTL cache: repeated identical questions (the manual WebMCP panel) are free. */
export class JevResponseCache {
  readonly ttlMs: number;
  readonly max: number;
  private entries = new Map<string, { at: number; value: JevResponse }>();

  constructor(opts: { ttlMs: number; max: number }) {
    this.ttlMs = opts.ttlMs;
    this.max = opts.max;
  }

  get(key: string, now: number): JevResponse | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (now - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: JevResponse, now: number): void {
    for (const [staleKey, entry] of this.entries) {
      if (now - entry.at > this.ttlMs) this.entries.delete(staleKey);
    }
    this.entries.set(key, { at: now, value });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Order-independent key for a request (same question ⇒ same cache entry). */
export function jevCacheKey(request: JevRequest): string {
  const questions = Object.keys(request.questions)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${stableStringify(request.questions[name])}`)
    .join(",");
  return `${request.kind}|${JSON.stringify(request.state)}|{${questions}}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Compact pick of a `choice` answer, for callers that only need the label. */
export function readChoiceAnswer(response: JevResponse, question: string): JevChoiceAnswer | null {
  const answer = response.answers[question];
  return answer && answer.type === "choice" ? answer : null;
}
