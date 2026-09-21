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
      const pair = body.pairs?.find((p) => p.chainId === "bsc") ?? body.pairs?.[0];
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
