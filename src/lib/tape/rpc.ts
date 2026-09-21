import { createServerFn } from "@tanstack/react-start";
import { readTokenPrice, type PriceResult } from "./quote";

export type { PriceResult };

/**
 * The quote read runs on the server: the upstream source is cross-origin, and
 * a browser-side read would need its CORS policy to cooperate. The reader
 * itself (classification, caching) lives in `./quote`.
 */
export const readPriceTape = createServerFn({ method: "POST" }).handler(
  async (): Promise<PriceResult> => readTokenPrice(),
);
