export type CallMode = "A" | "B" | "C";

export type ServiceMethod = {
  name: string;
  summary: string;
  priceBem: number;
  timeoutBlocks: number;
};

export type ServiceDef = {
  slug: string;
  vanity: string;
  name: string;
  headline: string;
  blurb: string;
  mode: CallMode;
  modeLabel: string;
  endpoint: string;
  cpu: number;
  tokenId: number;
  methods: ServiceMethod[];
};

export type TraceKind =
  | "resolve"
  | "manifest"
  | "read"
  | "pay"
  | "send"
  | "inbox"
  | "work"
  | "reply"
  | "release"
  | "refund"
  | "result"
  | "error";

export type TraceEvent = {
  id: string;
  kind: TraceKind;
  title: string;
  detail?: string;
  block: number;
  json?: unknown;
};

export type CallTrace = {
  id: string;
  slug: string;
  method: string;
  status: "running" | "ok" | "error";
  startedBlock: number;
  finishedBlock?: number;
  requestId?: string;
  events: TraceEvent[];
  result?: unknown;
  error?: string;
};

export type HubMessage = {
  id: string;
  kind: "deweb.req/v0" | "deweb.res/v0";
  from: string;
  to: string;
  block: number;
  digest: string;
  payload: Record<string, unknown>;
  paidBem?: number;
  ref?: string;
};

export type LeaderEntry = {
  name: string;
  score: number;
  from: string;
  at: number;
};

export type Identity = {
  endpoint: string;
  vanity: string;
  tokenId: number;
  cpu: number;
};
