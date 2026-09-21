/**
 * The BEM quote reader: one success shape, three classified failures.
 *
 * Kept apart from the server function that calls it so the classification can
 * be tested without a Start runtime. The panel owns a sentence per class
 * (`price.err.http` with the status, `price.err.empty`, `price.err.network`),
 * which is why the reader answers with machine reasons instead of prose: the
 * reader used to return the sentence itself, so a language switch could not
 * retranslate it and an HTTP status never reached the page.
 */

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
type PriceErr = {
  ok: false;
  /** Machine reason the UI localizes; no server prose reaches the page. */
  reason: "http" | "empty" | "network";
  /** The upstream status, when there was one. */
  status?: number;
};
export type PriceResult = PriceOk | PriceErr;

let priceCache: { at: number; value: PriceResult } | null = null;

export async function readTokenPrice(
  doFetch: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<PriceResult> {
  const at = now();
  if (priceCache && at - priceCache.at < 20_000) return priceCache.value;
  try {
    const res = await doFetch(DEX, { headers: { accept: "application/json" } });
    if (!res.ok) {
      const value: PriceResult = { ok: false, reason: "http", status: res.status };
      priceCache = { at, value };
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
      const value: PriceResult = { ok: false, reason: "empty" };
      priceCache = { at, value };
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
      fetchedAt: at,
    };
    priceCache = { at, value };
    return value;
  } catch {
    const value: PriceResult = { ok: false, reason: "network" };
    priceCache = { at, value };
    return value;
  }
}
