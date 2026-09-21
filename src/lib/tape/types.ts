export type CallMode = "A" | "B" | "C";

export type ServiceMethod = {
  name: string;
  priceBem: number;
  timeoutBlocks: number;
};

/**
 * A service as the playground needs it: the structured protocol facts only.
 * Every user-facing sentence lives in the i18n tables (`svc.<slug>.*`), because
 * two copies of the same copy drift — the catalog still said `price.json` while
 * the UI said `/data/price.json`, and one stale string is enough to contradict
 * the page it is read on.
 */
export type ServiceDef = {
  slug: string;
  vanity: string;
  mode: CallMode;
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
  /**
   * i18n key, translated when the trace is *rendered* rather than when the
   * event happens: a trace written before a language switch must not stay in
   * the old language.
   */
  code: string;
  vars?: Record<string, string | number>;
  /** Raw or language-neutral detail (endpoints, digests, ids). */
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
