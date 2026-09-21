import type { ServiceDef } from "./types";

export const USER: { identity: import("./types").Identity; startBem: number } = {
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
    slug: "jev",
    vanity: "jev.tape",
    name: "JEV",
    headline: "把判断力租出去",
    blurb:
      "不写作文，只做判断。调用方把局势和选项发过去，JEV 回一个类型化选择：选哪个、每个选项的概率、置信度。按次付费，每步一次。",
    mode: "C",
    modeLabel: "接单",
    endpoint: "#9104@0",
    cpu: 0,
    tokenId: 9104,
    methods: [
      {
        name: "decide",
        summary: "在选项里选一个",
        priceBem: 0.01,
        timeoutBlocks: 12,
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
