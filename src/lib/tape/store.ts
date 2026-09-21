import { create } from "zustand";
import { t } from "@/lib/i18n";
import { sha256Hex, sleep } from "@/lib/utils";
import { GENESIS_BLOCK, PROTOCOL_FEE, SERVICES, USER, serviceBySlug } from "./catalog";
import { runJevDecide } from "@/lib/jev/decide";
import { readPriceTape } from "./rpc";
import { randomNonce, requestIdHex, toHex } from "./id";
import { CallError, errorDetail, errorMessageKey, errorVars, refundDetailKey } from "./failure";
import type { JevAnswer, JevDecisionReason } from "@/lib/jev/protocol";
import type { CallTrace, HubMessage, Identity, LeaderEntry, TraceEvent, TraceKind } from "./types";
import type { PriceResult } from "./rpc";

const LS = "tapeapi-v1";

type PersistShape = {
  bem: number;
  treasury: number;
  balances: Record<string, number>;
  board: LeaderEntry[];
};

/**
 * What both sides start from. The server paints this snapshot — it has no
 * localStorage — so the first client render must paint it too; the browser's
 * own snapshot is applied only after hydration (`hydratePersisted`). The
 * `Date.now()` values here feed list keys, never rendered text.
 */
function basePersist(): PersistShape {
  return {
    bem: USER.startBem,
    treasury: 0,
    balances: Object.fromEntries(SERVICES.map((s) => [s.endpoint, 4])),
    board: [
      { name: "Behemoth", score: 4004, from: "#15324@30", at: Date.now() - 86_400_000 },
      { name: "NAND", score: 221, from: "#4246@0", at: Date.now() - 36_000_000 },
    ],
  };
}

/**
 * The visitor's own snapshot, or null when there is none (server render, empty
 * or unreadable storage). Browser-only: reading it before the first render is
 * exactly what turned a returning visitor's hard refresh into a hydration
 * mismatch — the server painted `12.00 BEM` while the client painted the
 * stored `0.05 BEM` and React rebuilt the tree.
 */
function readPersisted(base: PersistShape): PersistShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return {
      bem: typeof parsed.bem === "number" ? parsed.bem : base.bem,
      treasury: typeof parsed.treasury === "number" ? parsed.treasury : 0,
      balances: parsed.balances ?? base.balances,
      board: Array.isArray(parsed.board) ? parsed.board : base.board,
    };
  } catch {
    return null;
  }
}

function savePersist(s: PersistShape) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS, JSON.stringify(s));
}

/** Snapshot the persisted slice of the store (single writer: this module). */
function persistSnapshot(state: {
  bem: number;
  treasury: number;
  balances: Record<string, number>;
  board: LeaderEntry[];
}) {
  savePersist({
    bem: state.bem,
    treasury: state.treasury,
    balances: state.balances,
    board: state.board,
  });
}

function reduced() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function stepMs() {
  return reduced() ? 40 : 280;
}

type CallArgs = {
  slug: string;
  method: string;
  params: Record<string, unknown>;
  extraBem?: number;
  pay?: boolean;
};

/**
 * One JEV decision as the playground books it: a paid TAP-10 round trip whose
 * request carries the question and whose reply carries the typed answer.
 * `charge` is what actually left the wallet (0 when the escrow was refunded);
 * `envelope.paidBem` is what the request message shows on the hub.
 */
export type JevRound = {
  ok: boolean;
  reason: JevDecisionReason | null;
  message: string;
  answers: Record<string, JevAnswer> | null;
  model: string | null;
  latencyMs: number;
  charge: number;
  cached: boolean;
  envelope: {
    requestId: string;
    from: string;
    to: string;
    block: number;
    paidBem: number;
    reqDigest: string;
    resDigest: string | null;
  };
};

type TapeState = {
  identity: Identity;
  block: number;
  bem: number;
  locked: number;
  treasury: number;
  balances: Record<string, number>;
  messages: HubMessage[];
  traces: CallTrace[];
  busy: boolean;
  /**
   * Paid work in flight, whoever started it: the `busy` lock only ever covers
   * one workspace `call`, so the JEV loops (which deliberately never take that
   * lock) used to leave the header claiming the site was idle while it was
   * sending letters and moving BEM on every tick.
   */
  activeCalls: number;
  price: PriceResult | null;
  board: LeaderEntry[];
  /**
   * Apply the browser's own snapshot — once, after hydration. The store always
   * starts on the server's snapshot (`basePersist`) so the first client render
   * matches the markup React is hydrating; a returning visitor's stored
   * balance/board/resources land here instead.
   */
  hydratePersisted: () => void;
  tick: () => void;
  faucet: () => void;
  refreshPrice: () => Promise<void>;
  call: (args: CallArgs) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  /**
   * Per-tick path for the JEV demos: same envelope and billing as `call`, but
   * it never takes the global `busy` lock and never sleeps between steps, so a
   * fixed-clock demo can run one decision per tick while the rest of the page
   * stays usable.
   */
  jevDecision: (params: Record<string, unknown>) => Promise<JevRound>;
};

function eid() {
  return crypto.randomUUID();
}

export const useTape = create<TapeState>((set, get) => {
  const base = basePersist();
  return {
    identity: USER.identity,
    block: GENESIS_BLOCK,
    bem: base.bem,
    locked: 0,
    treasury: base.treasury,
    balances: base.balances,
    messages: [],
    traces: [],
    busy: false,
    activeCalls: 0,
    price: null,
    board: base.board,
    hydratePersisted: () => {
      // The first render is already on screen: loading what this browser
      // remembers now is an ordinary state update, not a hydration mismatch.
      const saved = readPersisted(base);
      if (!saved) return;
      set({
        bem: saved.bem,
        treasury: saved.treasury,
        balances: saved.balances,
        board: saved.board,
      });
    },
    tick: () => set((s) => ({ block: s.block + 1 })),
    faucet: () => {
      set((s) => {
        const bem = s.bem + 8;
        savePersist({ bem, treasury: s.treasury, balances: s.balances, board: s.board });
        return { bem };
      });
    },
    refreshPrice: async () => {
      const price = await readPriceTape();
      set({ price });
    },
    jevDecision: async (params) => {
      const svc = serviceBySlug("jev");
      const method = svc?.methods.find((m) => m.name === "decide");
      const from = get().identity.endpoint;
      const to = svc?.endpoint ?? "";
      const block = get().block;
      const envelope = {
        requestId: "",
        from,
        to,
        block,
        paidBem: 0,
        reqDigest: "",
        resDigest: null as string | null,
      };
      const failed = (reason: JevDecisionReason | null, message: string): JevRound => ({
        ok: false,
        reason,
        message,
        answers: null,
        model: null,
        latencyMs: 0,
        charge: 0,
        cached: false,
        envelope,
      });

      if (!svc || !method) return failed(null, t("err.noService"));

      const charge = method.priceBem;
      const fee = charge * PROTOCOL_FEE;
      const net = charge - fee;
      // Nothing is sent and nothing is escrowed when the wallet cannot pay:
      // the round never exists, so no letter may be drawn for it.
      if (get().bem < charge) return failed("insufficient_bem", "");

      set((s) => ({ activeCalls: s.activeCalls + 1 }));
      try {
        // Escrow first, then send: the request letter exists before the model
        // is asked, exactly like the paid `call` path — just without its pacing.
        set((s) => ({ bem: s.bem - charge, locked: s.locked + charge }));
        const nonce = randomNonce();
        const requestId = await requestIdHex({ from, to, nonce, params });
        const reqPayload = {
          kind: "deweb.req/v0",
          id: requestId,
          nonce: toHex(nonce),
          method: "decide",
          params,
          replyTo: from,
          deadline: block + method.timeoutBlocks,
        };
        const reqDigest = await sha256Hex(JSON.stringify(reqPayload));
        const reqMsg: HubMessage = {
          id: eid(),
          kind: "deweb.req/v0",
          from,
          to,
          block,
          digest: reqDigest,
          payload: reqPayload,
          paidBem: charge,
        };
        set((s) => ({ messages: [reqMsg, ...s.messages].slice(0, 40) }));

        const started = Date.now();
        let result: Awaited<ReturnType<typeof runJevDecide>> | null = null;
        let transportError = "";
        try {
          result = await runJevDecide({ data: params });
        } catch (err) {
          transportError = err instanceof Error ? err.message : t("err.fail");
        }
        const latencyMs = Date.now() - started;
        const sent = { ...envelope, requestId, paidBem: charge, reqDigest };

        const refund = () => {
          set((s) => ({ bem: s.bem + charge, locked: Math.max(0, s.locked - charge) }));
          persistSnapshot(get());
        };

        if (!result || !result.ok) {
          const reason: JevDecisionReason = result ? result.reason : "network";
          const message = result ? result.message : transportError;
          refund();
          return {
            ok: false,
            reason,
            message,
            answers: null,
            model: null,
            latencyMs,
            charge: 0,
            cached: false,
            envelope: sent,
          };
        }

        const resPayload = {
          kind: "deweb.res/v0",
          id: requestId,
          ok: true,
          result: {
            backend: result.backend,
            model: result.model,
            answers: result.answers,
          },
        };
        const resDigest = await sha256Hex(JSON.stringify(resPayload));
        const resMsg: HubMessage = {
          id: eid(),
          kind: "deweb.res/v0",
          from: to,
          to: from,
          block: get().block,
          digest: resDigest,
          payload: resPayload,
          ref: reqMsg.id,
        };
        set((s) => ({
          messages: [resMsg, ...s.messages].slice(0, 40),
          locked: Math.max(0, s.locked - charge),
          treasury: s.treasury + fee,
          balances: { ...s.balances, [to]: (s.balances[to] ?? 0) + net },
        }));
        persistSnapshot(get());

        return {
          ok: true,
          reason: null,
          message: "",
          answers: result.answers,
          model: result.model,
          latencyMs,
          charge,
          cached: result.cached,
          envelope: { ...sent, resDigest },
        };
      } finally {
        set((s) => ({ activeCalls: Math.max(0, s.activeCalls - 1) }));
      }
    },
    call: async (args) => {
      const svc = serviceBySlug(args.slug);
      if (!svc) return { ok: false, error: t("err.noService") };
      const method = svc.methods.find((m) => m.name === args.method);
      if (!method) return { ok: false, error: t("err.noMethod") };
      if (get().busy) return { ok: false, error: t("err.busy") };

      const priceBem = method.priceBem + (args.extraBem ?? 0);
      const paid = args.pay !== false;
      const charge = paid ? priceBem : 0;
      const fee = charge * PROTOCOL_FEE;
      const net = charge - fee;
      const traceId = eid();
      const startedBlock = get().block;

      const trace: CallTrace = {
        id: traceId,
        slug: args.slug,
        method: args.method,
        status: "running",
        startedBlock,
        events: [],
      };

      set((s) => ({
        busy: true,
        activeCalls: s.activeCalls + 1,
        traces: [trace, ...s.traces].slice(0, 12),
      }));

      const emit = (event: {
        kind: TraceKind;
        code: string;
        vars?: Record<string, string | number>;
        detail?: string;
        json?: unknown;
      }) => {
        const ev: TraceEvent = {
          id: eid(),
          kind: event.kind,
          code: event.code,
          vars: event.vars,
          detail: event.detail,
          block: get().block,
          json: event.json,
        };
        set((s) => ({
          traces: s.traces.map((t) => (t.id === traceId ? { ...t, events: [...t.events, ev] } : t)),
        }));
      };

      const finish = (patch: Partial<CallTrace>) => {
        set((s) => ({
          busy: false,
          activeCalls: Math.max(0, s.activeCalls - 1),
          traces: s.traces.map((t) =>
            t.id === traceId ? { ...t, ...patch, finishedBlock: get().block } : t,
          ),
        }));
      };

      const persist = () => persistSnapshot(get());

      const runWork = async (): Promise<unknown> => {
        if (svc.slug === "price") {
          const price = await readPriceTape();
          set({ price });
          if (!price.ok) throw new CallError("price", price.reason);
          return {
            path: "/data/price.json",
            pair: "BEM/USDT",
            usd: price.usd,
            change24h: price.change24h,
            updatedAt: price.fetchedAt,
          };
        }
        if (svc.slug === "jev") {
          const r = await runJevDecide({ data: args.params });
          if (!r.ok) throw new CallError("jev", r.reason);
          return {
            backend: r.backend,
            model: r.model,
            answers: r.answers,
            latencyMs: r.latencyMs,
            usage: r.usage,
          };
        }
        if (svc.slug === "game" && args.method === "board") {
          return { board: get().board.slice(0, 8) };
        }
        if (svc.slug === "game") {
          const from = get().identity.endpoint;
          const name = String(args.params.name ?? "player").slice(0, 16);
          const score = Math.max(0, Math.floor(Number(args.params.score) || 0));
          const entry: LeaderEntry = {
            name,
            score,
            from,
            at: Date.now(),
          };
          set((s) => ({
            board: [...s.board, entry].sort((a, b) => b.score - a.score).slice(0, 12),
          }));
          return { saved: entry, board: get().board.slice(0, 8) };
        }
        if (svc.slug === "payment") {
          const from = get().identity.endpoint;
          const to = String(args.params.to ?? "");
          const amount = Number(args.params.amount);
          const memo = String(args.params.memo ?? "").slice(0, 80);
          // These are local input/balance checks, not provider failures: the
          // refund note must not blame the provider for them.
          if (!to) throw new CallError("noPayee");
          if (!Number.isFinite(amount) || amount <= 0) throw new CallError("badAmt");
          if (get().bem < amount) throw new CallError("lowPay");
          set((s) => ({
            bem: s.bem - amount,
            balances: {
              ...s.balances,
              [to]: (s.balances[to] ?? 0) + amount,
            },
          }));
          return {
            to,
            amount,
            memo,
            receipt: await sha256Hex(`pay|${from}|${to}|${amount}|${get().block}`),
          };
        }
        throw new CallError("unknown");
      };

      try {
        emit({
          kind: "resolve",
          code: "emit.resolve",
          vars: { name: svc.endpoint },
          detail: `${svc.endpoint} · CPU ${svc.cpu} · #${svc.tokenId}`,
        });
        await sleep(stepMs());

        const manifest = {
          tap: 10,
          name: svc.slug,
          endpoint: svc.endpoint,
          methods: Object.fromEntries(
            svc.methods.map((m) => [
              m.name,
              { price: { token: "BEM", amount: m.priceBem }, timeoutBlocks: m.timeoutBlocks },
            ]),
          ),
          mode: svc.mode === "A" ? "onchain-file" : svc.mode === "B" ? "onchain-state" : "hybrid",
        };
        emit({ kind: "manifest", code: "emit.manifest", json: manifest });
        await sleep(stepMs());

        if (svc.mode === "A" || (svc.slug === "game" && args.method === "board")) {
          emit({ kind: "read", code: "emit.read" });
          await sleep(stepMs());
          const result = await runWork();
          emit({ kind: "result", code: "emit.got", json: result });
          finish({ status: "ok", result });
          persist();
          return { ok: true, result };
        }

        if (!paid) {
          emit({ kind: "work", code: "emit.workFree" });
          const result = await runWork();
          emit({ kind: "result", code: "emit.toolBack", json: result });
          finish({ status: "ok", result });
          persist();
          return { ok: true, result };
        }

        if (get().bem < charge) {
          throw new CallError("lowBem", String(charge));
        }

        set((s) => ({ bem: s.bem - charge, locked: s.locked + charge }));
        emit({ kind: "pay", code: "emit.pay", vars: { n: charge } });
        emit({
          kind: "pay",
          code: "emit.payDetail",
          vars: { fee: fee.toFixed(4), net: net.toFixed(4) },
        });
        await sleep(stepMs());

        const from = get().identity.endpoint;
        const nonce = randomNonce();
        const nonceHex = toHex(nonce);
        const requestId = await requestIdHex({
          from,
          to: svc.endpoint,
          nonce,
          params: args.params,
        });
        const reqPayload = {
          kind: "deweb.req/v0",
          id: requestId,
          nonce: nonceHex,
          method: args.method,
          params: args.params,
          replyTo: from,
          deadline: get().block + method.timeoutBlocks,
        };
        const digest = await sha256Hex(JSON.stringify(reqPayload));

        const reqMsg: HubMessage = {
          id: eid(),
          kind: "deweb.req/v0",
          from,
          to: svc.endpoint,
          block: get().block,
          digest,
          payload: reqPayload,
          paidBem: charge,
        };
        set((s) => ({ messages: [reqMsg, ...s.messages].slice(0, 40) }));
        emit({
          kind: "send",
          code: "emit.send",
          detail: `${from} → ${svc.endpoint}`,
          json: reqPayload,
        });
        await sleep(stepMs());
        emit({
          kind: "inbox",
          code: "emit.inbox",
          vars: { name: svc.endpoint },
          detail: `digest ${digest.slice(0, 18)}…`,
        });
        await sleep(stepMs());

        emit({ kind: "work", code: "emit.work" });
        const result = await runWork();
        await sleep(stepMs());

        const resPayload = {
          kind: "deweb.res/v0",
          id: requestId,
          ok: true,
          result,
        };
        const resDigest = await sha256Hex(JSON.stringify(resPayload));
        const resMsg: HubMessage = {
          id: eid(),
          kind: "deweb.res/v0",
          from: svc.endpoint,
          to: from,
          block: get().block,
          digest: resDigest,
          payload: resPayload,
          ref: reqMsg.id,
        };
        set((s) => ({ messages: [resMsg, ...s.messages].slice(0, 40) }));
        emit({
          kind: "reply",
          code: "emit.reply",
          detail: `${requestId.slice(0, 18)}…`,
          json: resPayload,
        });
        await sleep(stepMs());

        set((s) => ({
          locked: Math.max(0, s.locked - charge),
          treasury: s.treasury + fee,
          balances: {
            ...s.balances,
            [svc.endpoint]: (s.balances[svc.endpoint] ?? 0) + net,
          },
        }));
        emit({ kind: "release", code: "emit.release" });
        emit({ kind: "release", code: "emit.treasury", vars: { n: fee.toFixed(4) } });
        await sleep(stepMs());
        emit({ kind: "result", code: "emit.done", json: result });
        finish({ status: "ok", result, requestId });
        persist();
        return { ok: true, result };
      } catch (err) {
        const error = t(errorMessageKey(err), errorVars(err));
        const locked = get().locked;
        const refund = Math.min(locked, charge);
        if (refund > 0) {
          set((s) => ({ bem: s.bem + refund, locked: Math.max(0, s.locked - refund) }));
          emit({ kind: "refund", code: "emit.refund", vars: { n: refund } });
          emit({ kind: "refund", code: refundDetailKey(err) });
        }
        emit({
          kind: "error",
          code: errorMessageKey(err),
          vars: errorVars(err),
          detail: errorDetail(err),
        });
        finish({ status: "error", error });
        persist();
        return { ok: false, error };
      }
    },
  };
});
