import { getCookie, getRequestIP, setCookie } from "@tanstack/react-start/server";
import { env } from "../env.server.ts";
import { TokenBucket, classifyJevStatus, type JevFailureReason } from "../jev/protocol.ts";
import { assertAiServerOnly } from "./server-only.ts";
import { AI_TIMEOUT_MS, buildChatRequest, parseChatReply, type ChatReply } from "./models.ts";
import { DailyQuota, VISITOR_COOKIE, quotaExempt, quotaKey } from "./quota.ts";

assertAiServerOnly();

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const ERROR_SNIPPET_CHARS = 200;

/**
 * A ceiling on how fast this instance will spend provider calls, whatever the
 * trial counter says — a whitelisted or bypassed client still shares one key.
 * The bucket is the JEV layer's own (`@/lib/jev/protocol`), so both providers
 * are throttled by the same proven primitive; no cache and no cooldown here,
 * because two chat messages are never the same question.
 */
export const AI_RATE_BURST = 10;
export const AI_RATE_PER_MINUTE = 30;

/** Read a positive integer env override, else the compiled-in default. */
function positiveIntEnv(key: string, fallback: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const bucket = new TokenBucket({
  capacity: positiveIntEnv("AI_RATE_BURST", AI_RATE_BURST),
  refillPerMinute: positiveIntEnv("AI_RATE_PER_MINUTE", AI_RATE_PER_MINUTE),
});

/**
 * The free-trial counter and everything that needs the request or the key.
 * Deliberately in the guarded module: `chat.ts` (which the browser also
 * imports for its server-fn references) must stay free of server text.
 */
const quota = new DailyQuota();

export type ChatEnv = { key: string; bypass: string | null; whitelist: string | null };

export function chatEnv(): ChatEnv {
  return {
    key: env("OPENROUTER_API_KEY") ?? "",
    bypass: env("FREE_LIMITS_BYPASS") ?? null,
    whitelist: env("FREE_LIMITS_WHITELIST") ?? null,
  };
}

/** No key ⇒ the panel reports `no_key` and the demos degrade to local policy. */
export function hasChatKey(): boolean {
  return Boolean(chatEnv().key);
}

/**
 * The visitor's cookie, minted on first use. Not a secret and not a login: it
 * only keeps two people behind one address from sharing a bucket. `secure` is
 * left off so local http:// dev keeps the cookie.
 */
function visitorId(): string {
  const existing = getCookie(VISITOR_COOKIE);
  if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  setCookie(VISITOR_COOKIE, id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax",
  });
  return id;
}

export function quotaIdentity(): { key: string; ip: string; exempt: boolean } {
  const ip = getRequestIP({ xForwardedFor: true }) ?? "";
  const { bypass, whitelist } = chatEnv();
  return {
    key: quotaKey(ip, visitorId()),
    ip,
    exempt: quotaExempt({ bypass, whitelist, ip }),
  };
}

export function quotaPeek(key: string) {
  return quota.peek(key);
}

export function quotaTake(key: string) {
  return quota.take(key);
}

export function quotaLimit(): number {
  return quota.limit;
}

/**
 * The counter itself, for a decision that needs more than one call on it:
 * `chat.ts` either draws a trial unit or marks the call paid, and hands a
 * failed trial call back. One instance per process, as `quota.ts` describes.
 */
export function quotaStore(): DailyQuota {
  return quota;
}

export type ChatCallResult =
  | { ok: true; reply: ChatReply; latencyMs: number }
  | { ok: false; reason: JevFailureReason; message: string };

/** Nothing from a provider body may carry the key back to the caller. */
function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

/** Short provider message for the UI; never the raw body, never the key. */
async function errorSnippet(res: Response, secret: string): Promise<string> {
  try {
    const text = (await res.text()).slice(0, ERROR_SNIPPET_CHARS);
    return redact(text.replace(/\s+/g, " ").trim(), secret);
  } catch {
    return "";
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * One chat completion. The chain lives in the body's `models` array, so
 * OpenRouter does the failover itself and names the model that answered; this
 * function only classifies what came back. Reasoning is off and the answer is
 * capped, because a visitor is waiting on a letter, not on a monologue.
 */
export async function callChatModel(text: string): Promise<ChatCallResult> {
  const { key } = chatEnv();
  if (!key) return { ok: false, reason: "no_key", message: "" };
  // Checked before the fetch, like the JEV layer: a throttled call must not
  // reach the provider at all.
  if (!bucket.tryTake(Date.now())) {
    return { ok: false, reason: "rate_limited", message: "local rate limit" };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Attribution only; the key travels below and nowhere else.
        "x-title": "deweb-mcp-playground",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildChatRequest(text)),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      reason: isTimeoutError(err) ? "timeout" : "network",
      message: err instanceof Error ? redact(err.message, key) : "",
    };
  }

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const snippet = await errorSnippet(res, key);
    let errorType: string | undefined;
    try {
      const parsed = JSON.parse(snippet) as { error_type?: string; error?: { code?: string } };
      errorType = parsed.error_type ?? parsed.error?.code;
    } catch {
      errorType = undefined;
    }
    return { ok: false, reason: classifyJevStatus(res.status, errorType), message: snippet };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "parse_error", message: "response body is not JSON" };
  }
  const parsed = parseChatReply(json);
  if (!parsed) return { ok: false, reason: "parse_error", message: "no answer in the response" };
  return { ok: true, reply: parsed, latencyMs };
}
