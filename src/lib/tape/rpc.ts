import { createServerFn } from "@tanstack/react-start";

const BEM = "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8B695a";
const DEX = `https://api.dexscreener.com/latest/dex/tokens/${BEM}`;

type PriceOk = {
  ok: true;
  usd: number;
  change24h: number;
  pairUrl: string;
  liquidityUsd: number;
  fdv: number;
  source: "dexscreener";
  fetchedAt: number;
};
type PriceErr = { ok: false; error: string };
export type PriceResult = PriceOk | PriceErr;

let priceCache: { at: number; value: PriceResult } | null = null;

export const readPriceTape = createServerFn({ method: "POST" }).handler(
  async (): Promise<PriceResult> => {
    const now = Date.now();
    if (priceCache && now - priceCache.at < 20_000) return priceCache.value;
    try {
      const res = await fetch(DEX, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        const value: PriceResult = {
          ok: false,
          error: `行情源 ${res.status}`,
        };
        priceCache = { at: now, value };
        return value;
      }
      const body = (await res.json()) as {
        pairs?: {
          chainId: string;
          priceUsd?: string;
          priceChange?: { h24?: number };
          liquidity?: { usd?: number };
          fdv?: number;
          url?: string;
        }[];
      };
      const pair =
        body.pairs?.find((p) => p.chainId === "bsc") ?? body.pairs?.[0];
      const usd = Number(pair?.priceUsd);
      if (!pair || !Number.isFinite(usd)) {
        const value: PriceResult = { ok: false, error: "链上暂无有效报价" };
        priceCache = { at: now, value };
        return value;
      }
      const value: PriceResult = {
        ok: true,
        usd,
        change24h: Number(pair.priceChange?.h24 ?? 0),
        pairUrl: pair.url ?? "",
        liquidityUsd: Number(pair.liquidity?.usd ?? 0),
        fdv: Number(pair.fdv ?? 0),
        source: "dexscreener",
        fetchedAt: now,
      };
      priceCache = { at: now, value };
      return value;
    } catch {
      const value: PriceResult = { ok: false, error: "读行情失败，稍后重试" };
      priceCache = { at: now, value };
      return value;
    }
  },
);

type TranslateIn = { text: string; from: string; to: string };
type AiIn = { prompt: string };

const recent: number[] = [];
function allowCall() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 10 * 60_000) recent.shift();
  if (recent.length >= 24) return false;
  recent.push(now);
  return true;
}

export const runTranslate = createServerFn({ method: "POST" })
  .validator((data: TranslateIn) => {
    const text = (data?.text ?? "").trim().slice(0, 500);
    const from = (data?.from ?? "auto").slice(0, 16);
    const to = (data?.to ?? "zh").slice(0, 16);
    if (!text) throw new Error("缺少原文");
    return { text, from, to };
  })
  .handler(async ({ data }) => {
    if (!allowCall()) {
      return { ok: false as const, error: "调用过于频繁，请稍后再试" };
    }
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "翻译服务暂时不可用" };

    const langName: Record<string, string> = {
      auto: "the original language",
      zh: "Simplified Chinese",
      en: "English",
      ja: "Japanese",
      ko: "Korean",
      es: "Spanish",
      fr: "French",
    };
    const toName = langName[data.to] ?? data.to;
    const fromName = langName[data.from] ?? data.from;

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 220,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a translation API. Return ONLY the translated text, no quotes, no notes.",
            },
            {
              role: "user",
              content: `Translate from ${fromName} to ${toName}:\n\n${data.text}`,
            },
          ],
        }),
      });
    } catch {
      return { ok: false as const, error: "翻译超时" };
    }
    if (!res.ok) {
      return { ok: false as const, error: `翻译接口 ${res.status}` };
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (body.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false as const, error: "没有译文" };
    return { ok: true as const, text };
  });

export const runComplete = createServerFn({ method: "POST" })
  .validator((data: AiIn) => {
    const prompt = (data?.prompt ?? "").trim().slice(0, 280);
    if (!prompt) throw new Error("缺少提示词");
    return { prompt };
  })
  .handler(async ({ data }) => {
    if (!allowCall()) {
      return { ok: false as const, error: "调用过于频繁，请稍后再试" };
    }
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI 服务暂时不可用" };

    let res: Response;
    try {
      res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 180,
          temperature: 0.6,
          messages: [
            {
              role: "system",
              content:
                "You are ai.tape, a paid on-chain completion service. Answer in the user's language. Be concise: at most 80 words.",
            },
            { role: "user", content: data.prompt },
          ],
        }),
      });
    } catch {
      return { ok: false as const, error: "AI 超时" };
    }
    if (!res.ok) {
      return { ok: false as const, error: `AI 接口 ${res.status}` };
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (body.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { ok: false as const, error: "没有结果" };
    return { ok: true as const, text };
  });
