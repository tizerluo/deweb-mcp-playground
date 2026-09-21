/**
 * The quote reader's three failure classes and its one success shape.
 *
 * The panel shows a different sentence per class (`price.err.http` with the
 * status, `price.err.empty`, `price.err.network`), so the classification is
 * part of the contract: a reader that answered everything with one vague
 * sentence, or leaked the upstream's own text, is what the review filed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MESSAGES } from "../i18n.ts";

const { readTokenPrice } = await import("./quote.ts");

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * A clock that never repeats, so the module's 20s cache never answers. One
 * counter for the whole file: a per-test clock would let a previous test's
 * entry look fresh to the next one.
 */
let clock = 0;
const tickingClock = () => () => (clock += 60_000);

describe("readTokenPrice", () => {
  it("classifies a non-200 as http and keeps the status", async () => {
    const result = await readTokenPrice(
      async () => new Response("upstream said no", { status: 503 }),
      tickingClock(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : null, "http");
    assert.equal(result.ok === false ? result.status : null, 503);
  });

  it("classifies a 200 with no usable pair as empty", async () => {
    const noPairs = await readTokenPrice(async () => jsonResponse({ pairs: [] }), tickingClock());
    assert.equal(noPairs.ok === false ? noPairs.reason : null, "empty");
    const junk = await readTokenPrice(
      async () => jsonResponse({ pairs: [{ chainId: "bsc", priceUsd: "not-a-number" }] }),
      tickingClock(),
    );
    assert.equal(junk.ok === false ? junk.reason : null, "empty");
  });

  it("classifies a failed request as network", async () => {
    const result = await readTokenPrice(async () => {
      throw new TypeError("fetch failed");
    }, tickingClock());
    assert.equal(result.ok === false ? result.reason : null, "network");
  });

  it("reads the bsc pair and its numbers", async () => {
    const result = await readTokenPrice(
      async () =>
        jsonResponse({
          pairs: [
            { chainId: "ethereum", priceUsd: "0.001" },
            {
              chainId: "bsc",
              priceUsd: "0.00412",
              priceChange: { h24: -3.5 },
              liquidity: { usd: 41234.5 },
              fdv: 412345,
              url: "https://dexscreener.com/bsc/0xabc",
            },
          ],
        }),
      tickingClock(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.usd : null, 0.00412);
    assert.equal(result.ok ? result.change24h : null, -3.5);
    assert.equal(result.ok ? result.pairUrl : null, "https://dexscreener.com/bsc/0xabc");
  });

  it("answers every class with a sentence the tables hold", () => {
    const keys = ["price.err.http", "price.err.empty", "price.err.network"];
    for (const key of keys) assert.ok(key in MESSAGES.en, `${key} missing from en`);
    // The http sentence names the status it was given, so it must keep its slot.
    assert.match(MESSAGES.en["price.err.http"]!, /\{code\}/);
  });
});
