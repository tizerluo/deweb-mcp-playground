import type { ServiceDef } from "./types";

export const USER: { identity: import("./types").Identity; startBem: number } =
  {
    identity: {
      endpoint: "#8801@0",
      vanity: "arcade.0.tape",
      tokenId: 8801,
      cpu: 0,
    },
    startBem: 12,
  };

export const SERVICES: ServiceDef[] = [
  {
    slug: "price",
    vanity: "price.tape",
    name: "行情",
    headline: "把报价写成链上文件",
    blurb: "提供方定期把 BEM 价格写进容器里的 price.json。DeWEB 站点直接读文件，不发信、不扣费。",
    mode: "A",
    modeLabel: "只读",
    endpoint: "#9101@0",
    cpu: 0,
    tokenId: 9101,
    methods: [
      {
        name: "get",
        summary: "read /data/price.json",
        priceBem: 0,
        timeoutBlocks: 2,
      },
    ],
  },
  {
    slug: "translate",
    vanity: "translate.tape",
    name: "翻译",
    headline: "按句付费的翻译摊",
    blurb: "游戏或站点把原文塞进对方信箱，附上 BEM。提供方的程序盯着信箱，译完回一封信。",
    mode: "C",
    modeLabel: "接单",
    endpoint: "#9102@0",
    cpu: 0,
    tokenId: 9102,
    methods: [
      {
        name: "translate",
        summary: "翻译一段话",
        priceBem: 0.02,
        timeoutBlocks: 20,
      },
    ],
  },
  {
    slug: "ai",
    vanity: "ai.tape",
    name: "AI",
    headline: "把模型租出去",
    blurb: "调用方不必自己申请模型密钥。按次把提示词发到 ai.tape，结果加密写回信箱。",
    mode: "C",
    modeLabel: "接单",
    endpoint: "#9104@0",
    cpu: 0,
    tokenId: 9104,
    methods: [
      {
        name: "complete",
        summary: "短回答",
        priceBem: 0.08,
        timeoutBlocks: 24,
      },
    ],
  },
  {
    slug: "game",
    vanity: "game.tape",
    name: "存档",
    headline: "全服分数记在容器里",
    blurb: "静态网页自己记不住全服第一。分数写入提供方容器的 RAM，换设备也能读回来。",
    mode: "B",
    modeLabel: "链上记",
    endpoint: "#9103@0",
    cpu: 0,
    tokenId: 9103,
    methods: [
      {
        name: "save",
        summary: "提交分数",
        priceBem: 0.01,
        timeoutBlocks: 12,
      },
      {
        name: "board",
        summary: "读取排行榜",
        priceBem: 0,
        timeoutBlocks: 2,
      },
    ],
  },
  {
    slug: "payment",
    vanity: "payment.tape",
    name: "支付",
    headline: "按次把 BEM 打给别人",
    blurb: "内容站不必自建收银。指定收款容器和金额，支付服务记账并回执。",
    mode: "B",
    modeLabel: "链上记",
    endpoint: "#9105@0",
    cpu: 0,
    tokenId: 9105,
    methods: [
      {
        name: "pay",
        summary: "转一笔 BEM",
        priceBem: 0.005,
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
