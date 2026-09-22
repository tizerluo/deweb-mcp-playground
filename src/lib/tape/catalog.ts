import type { ServiceDef } from "./types";

/**
 * Money is BNB: the playground's own convention (see the copy table) — every
 * amount a visitor can see is denominated in BNB, from the wallet balance to
 * the per-call price. `priceBem`/`startBem` keep their old field names because
 * the quote service really does read the BEM/USDT pair; only the playground's
 * own ledger moved to BNB.
 */
export const USER: { identity: import("./types").Identity; startBem: number } = {
  identity: {
    endpoint: "#8801@0",
    vanity: "arcade.0.tape",
    tokenId: 8801,
    cpu: 0,
  },
  startBem: 0.05,
};

export const SERVICES: ServiceDef[] = [
  {
    slug: "price",
    vanity: "price.tape",
    mode: "A",
    endpoint: "#9101@0",
    cpu: 0,
    tokenId: 9101,
    methods: [
      {
        name: "get",
        priceBem: 0,
        timeoutBlocks: 2,
      },
    ],
  },
  {
    slug: "jev",
    vanity: "jev.tape",
    mode: "C",
    endpoint: "#9104@0",
    cpu: 0,
    tokenId: 9104,
    methods: [
      {
        // The games' picker. Its price is the paid continuation the AI panel
        // quotes ("about 0.0003 BNB per call"); the free trial covers the calls
        // the panel and the games actually make.
        name: "decide",
        priceBem: 0.0003,
        timeoutBlocks: 12,
      },
      {
        name: "chat",
        priceBem: 0.0003,
        timeoutBlocks: 12,
      },
    ],
  },
  {
    slug: "game",
    vanity: "game.tape",
    mode: "B",
    endpoint: "#9103@0",
    cpu: 0,
    tokenId: 9103,
    methods: [
      {
        name: "save",
        priceBem: 0.0002,
        timeoutBlocks: 12,
      },
      {
        name: "board",
        priceBem: 0,
        timeoutBlocks: 2,
      },
    ],
  },
  {
    slug: "payment",
    vanity: "payment.tape",
    mode: "B",
    endpoint: "#9105@0",
    cpu: 0,
    tokenId: 9105,
    methods: [
      {
        name: "pay",
        priceBem: 0.0002,
        timeoutBlocks: 16,
      },
    ],
  },
];

export function serviceBySlug(slug: string) {
  return SERVICES.find((s) => s.slug === slug);
}

export const PROTOCOL_FEE = 0.02;
export const GENESIS_BLOCK = 122_900_000;
