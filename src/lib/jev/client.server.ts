import { env } from "../env.server.ts";
import { assertJevServerOnly } from "./server-only.ts";
import {
  JEV_RATE_BURST,
  JEV_RATE_PER_MINUTE,
  JEV_TIMEOUT_MS,
  JevCooldown,
  JevResponseCache,
  TokenBucket,
  classifyJevStatus,
  jevCacheKey,
  parseJevResponse,
  selectJevBackend,
  type JevFailureReason,
  type JevRequest,
  type JevResponse,
  type JevBackend,
} from "./protocol.ts";

assertJevServerOnly();

export const JEV_CACHE_TTL_MS = 30_000;
export const JEV_CACHE_MAX = 24;
const JEV_COOLDOWN_BASE_MS = 2_000;
const JEV_COOLDOWN_MAX_MS = 30_000;
const JEV_ERROR_SNIPPET_CHARS = 200;

/** Read a positive integer env override, else the compiled-in default. */
function positiveIntEnv(key: string, fallback: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type JevCallResult =
  | {
      ok: true;
      backend: JevBackend["id"];
      model: string;
      latencyMs: number;
      cached: boolean;
      response: JevResponse;
    }
  | { ok: false; reason: JevFailureReason; message: string };

// Process-wide server state. A single playground instance is the whole
// audience, so a module-level bucket/cooldown/cache is the right scope. Both
// rate knobs are env-tunable (see protocol.ts for why the sustained default is
// 240/min rather than the brief's 30/min: a normal round would be throttled).
const bucket = new TokenBucket({
  capacity: positiveIntEnv("JEV_RATE_BURST", JEV_RATE_BURST),
  refillPerMinute: positiveIntEnv("JEV_RATE_PER_MINUTE", JEV_RATE_PER_MINUTE),
});
const cooldown = new JevCooldown({ baseMs: JEV_COOLDOWN_BASE_MS, maxMs: JEV_COOLDOWN_MAX_MS });
const cache = new JevResponseCache({ ttlMs: JEV_CACHE_TTL_MS, max: JEV_CACHE_MAX });

/** Nothing from a provider body may carry the key back to the caller. */
function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

/** Short provider message for the UI; never the raw body, never the key. */
async function errorSnippet(res: Response, secret: string): Promise<string> {
  try {
    const text = (await res.text()).slice(0, JEV_ERROR_SNIPPET_CHARS);
    return redact(text.replace(/\s+/g, " ").trim(), secret);
  } catch {
    return "";
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * One System One round trip. Returns the layer's classified failure shape
 * instead of throwing, so the UI can tell "no key configured" (degrade, stay
 * quiet) apart from "upstream said 429" (degrade, say why).
 */
export async function callSystemOne(request: JevRequest): Promise<JevCallResult> {
  const backend = selectJevBackend(process.env);
  if (!backend) return { ok: false, reason: "no_key", message: "" };
  const apiKey = env(backend.keyVar) ?? "";
  if (!apiKey) return { ok: false, reason: "no_key", message: "" };

  const now = Date.now();
  const cacheKey = jevCacheKey(request);
  const cached = cache.get(cacheKey, now);
  if (cached) {
    return {
      ok: true,
      backend: backend.id,
      model: cached.model,
      latencyMs: 0,
      cached: true,
      response: cached,
    };
  }

  const backoffMs = cooldown.remainingMs(now);
  if (backoffMs > 0) {
    return {
      ok: false,
      reason: "rate_limited",
      message: `cooling down for ${Math.ceil(backoffMs / 1000)}s`,
    };
  }
  if (!bucket.tryTake(now)) {
    return { ok: false, reason: "rate_limited", message: "local rate limit" };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(backend.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // The key travels only here — never into a message, cache key, or log.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: backend.model,
        state: request.state,
        questions: request.questions,
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      reason: isTimeoutError(err) ? "timeout" : "network",
      message: err instanceof Error ? redact(err.message, apiKey) : "",
    };
  }

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const snippet = await errorSnippet(res, apiKey);
    let errorType: string | undefined;
    try {
      errorType = (JSON.parse(snippet) as { error_type?: string }).error_type;
    } catch {
      errorType = undefined;
    }
    const reason = classifyJevStatus(res.status, errorType);
    if (reason === "rate_limited") cooldown.noteThrottled(Date.now());
    return { ok: false, reason, message: snippet };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "parse_error", message: "response body is not JSON" };
  }
  const parsed = parseJevResponse(json);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, message: parsed.message };

  cooldown.noteSuccess();
  cache.set(cacheKey, parsed.response, Date.now());
  return {
    ok: true,
    backend: backend.id,
    model: parsed.response.model,
    latencyMs,
    cached: false,
    response: parsed.response,
  };
}

/** Inspectable for tests/diagnostics: which backend is wired right now. */
export function jevBackendId(): JevBackend["id"] | null {
  return selectJevBackend(process.env)?.id ?? null;
}
