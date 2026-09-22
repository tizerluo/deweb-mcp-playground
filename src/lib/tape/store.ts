import { create } from "zustand";
import { t } from "@/lib/i18n";
import { sha256Hex, sleep } from "@/lib/utils";
import { GENESIS_BLOCK, PROTOCOL_FEE, SERVICES, USER, serviceBySlug } from "./catalog";
import { runJevDecide } from "@/lib/jev/decide";
import { claimAiRound, readAiQuota, runAiChat } from "@/lib/ai/chat";
import { chatWithTrialFallback } from "@/lib/ai/continuation";
import { readPriceTape } from "./rpc";
import { randomNonce, requestIdHex, toHex } from "./id";
import {
  CallError,
  errorDetail,
  errorMessageKey,
  errorReason,
  errorVars,
  refundDetailKey,
} from "./failure";
import type { AiRoundClaim } from "@/lib/ai/chat";
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
    balances: Object.fromEntries(SERVICES.map((s) => [s.endpoint, 0.01])),
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
 * mismatch — the server painted the base balance while the client painted the
 * stored one (a smaller number, after spending) and React rebuilt the tree.
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
  /**
   * Send the letter even though nothing is escrowed. The AI panel works this
   * way: the call is a real request/reply round trip on the hub, but the trial
   * covers it, so there is no payment step to draw. Without this, an unpaid
   * call is the in-page `execute` shortcut, which never mails anything.
   */
  sendMail?: boolean;
  /**
   * The caller will buy this call if the server refuses the trial for quota
   * (the AI panel's continuation, see `@/lib/ai/continuation`). Such a refusal
   * costs nothing and reaches no model, so this call takes its trace and its
   * letter back off the tape: the submission is one call, and what the visitor
   * is left holding must be the one that actually happened.
   */
  retryPaidOnQuota?: boolean;
};

/**
 * One JEV decision as the playground books it: a TAP-10 round trip whose
 * request carries the question and whose reply carries the typed answer.
 *
 * The demos are free to play: the code sends the letter and takes the answer,
 * and the daily trial — not an escrow — is what limits how much of the model a
 * visit may spend. `envelope.paidBem` is therefore 0 on every demo letter, and
 * the field survives because the hub view still shows what a request carried.
 */
export type JevRound = {
  ok: boolean;
  reason: JevDecisionReason | null;
  message: string;
  answers: Record<string, JevAnswer> | null;
  model: string | null;
  latencyMs: number;
  /** What left the wallet. The demos never lock anything, so this is 0. */
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
   * Calls in flight, whoever started them: the `busy` lock only ever covers
   * one workspace `call`, so the JEV loops (which deliberately never take that
   * lock) used to leave the header claiming the site was idle while it was
   * sending letters on every tick.
   */
  activeCalls: number;
  price: PriceResult | null;
  board: LeaderEntry[];
  /**
   * Today's free-call trial, as the server counts it — null until the first
   * read. Display only: whether a call is allowed is the server's answer, and
   * this number is what came back with the last one.
   */
  quota: { left: number; limit: number } | null;
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
  /** Read the free-call counter (page mount, and after each spend). */
  refreshQuota: () => Promise<void>;
  /**
   * A demo's claim on today's free round. A round is dozens of decisions, so
   * it is claimed once, up front, and the claim is the server's decision.
   */
  claimRound: () => Promise<AiRoundClaim>;
  /**
   * One AI-call round trip: a real request letter and reply letter on the hub,
   * covered by the free trial (no escrow, no payment step), counted against it
   * server-side.
   */
  aiChat: (
    text: string,
  ) => Promise<{ ok: boolean; reply?: string; model?: string; error?: string }>;
  call: (args: CallArgs) => Promise<{
    ok: boolean;
    result?: unknown;
    error?: string;
    /**
     * The failure's machine reason, so a caller can branch on it instead of
     * reading prose: the upstream reason for a classified failure (`quota`,
     * `no_key`, …), the error's own code for a local one (`lowBem`, `busy`,
     * …), and null when the call never reached the server at all.
     */
    reason?: string | null;
  }>;
  /**
   * Per-tick path for the JEV demos: same envelope and letters as `call`, but
   * free (the daily trial covers it, see `@/lib/ai/chat`), never taking the
   * global `busy` lock and never sleeping between steps, so a fixed-clock demo
   * can run one decision per tick while the rest of the page stays usable.
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
    quota: null,
    refreshQuota: async () => {
      try {
        const view = await readAiQuota();
        set({ quota: { left: view.left, limit: view.limit } });
      } catch {
        // Leave the last known number in place: the panel shows nothing until
        // it has one, and the server is still the one that decides.
      }
    },
    claimRound: async () => {
      try {
        const claim = await claimAiRound();
        set({ quota: { left: claim.left, limit: claim.limit } });
        return claim;
      } catch {
        // The claim never reached the server: nothing was claimed, and a round
        // that started anyway would spend the shared key uncounted — the
        // server's own counter is what the trial *is*. Only the server's
        // explicit `no_key` lets a round run on local policy; the demos refuse
        // to start on this and say so.
        const seen = get().quota;
        return {
          ok: false,
          left: seen?.left ?? 0,
          limit: seen?.limit ?? 0,
          reason: "network",
        };
      }
    },
    aiChat: async (text) => {
      // The trial pays while the server says it has a unit left. Once it is
      // spent, the same letter leaves as a call the visitor's own wallet pays
      // for: the price is the chat method's own (0.0003 BNB — quoted by the
      // panel's quota line), the ledger draws it before the letter goes out,
      // and the trace shows the escrow the free calls do not have.
      //
      // This tab's copy of the counter picks which budget to *ask* for, never
      // who pays: another tab of the same visitor can spend the trial between
      // the read and the send, so the server's own refusal — and only that
      // one — is answered by buying the call and sending the same submission
      // once more, inside this press of send (see `@/lib/ai/continuation`).
      // The refused attempt is an unpaid one that took nothing and reached no
      // model; `retryPaidOnQuota` makes it leave no trace and no letter, so
      // the visitor ends up with the single call that actually happened.
      const { result: r } = await chatWithTrialFallback({
        trialLeft: get().quota?.left ?? null,
        send: (paid) =>
          get().call({
            slug: "jev",
            method: "chat",
            params: { text },
            pay: paid,
            sendMail: true,
            retryPaidOnQuota: true,
          }),
      });
      const result = r.result as { reply?: string; model?: string } | undefined;
      return { ok: r.ok, reply: result?.reply, model: result?.model, error: r.error };
    },
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
        const bem = s.bem + 0.02;
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

      set((s) => ({ activeCalls: s.activeCalls + 1 }));
      try {
        // Free: no escrow, no wallet check, no release — the round trip is two
        // letters and the daily trial is what the visitor spends on it.
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
          paidBem: 0,
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
        const sent = { ...envelope, requestId, reqDigest };

        if (!result || !result.ok) {
          const reason: JevDecisionReason = result ? result.reason : "network";
          const message = result ? result.message : transportError;
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
        set((s) => ({ messages: [resMsg, ...s.messages].slice(0, 40) }));

        return {
          ok: true,
          reason: null,
          message: "",
          answers: result.answers,
          model: result.model,
          latencyMs,
          charge: 0,
          cached: result.cached,
          envelope: { ...sent, resDigest },
        };
      } finally {
        set((s) => ({ activeCalls: Math.max(0, s.activeCalls - 1) }));
      }
    },
    call: async (args) => {
      const svc = serviceBySlug(args.slug);
      if (!svc) return { ok: false, error: t("err.noService"), reason: "noService" };
      const method = svc.methods.find((m) => m.name === args.method);
      if (!method) return { ok: false, error: t("err.noMethod"), reason: "noMethod" };
      if (get().busy) return { ok: false, error: t("err.busy"), reason: "busy" };

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

      /**
       * The letters this call puts on the hub, so a refused probe can take
       * them back off (see the catch): nothing is mailed on behalf of a
       * submission that ends up being one call.
       */
      const mailed: string[] = [];

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
        if (svc.slug === "jev" && args.method === "chat") {
          // The AI-call service: the key and the trial counter both live on the
          // server, so this hop is where a free call is actually spent — and
          // where a paid one is served without spending the trial.
          const text = String(args.params.text ?? "");
          const r = await runAiChat({ data: { text, paid } });
          set({ quota: { left: r.left, limit: r.limit } });
          if (!r.ok) throw new CallError("jev", r.reason);
          return {
            reply: r.reply,
            model: r.model,
            truncated: r.truncated,
            latencyMs: r.latencyMs,
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
              { price: { token: "BNB", amount: m.priceBem }, timeoutBlocks: m.timeoutBlocks },
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

        if (!paid && !args.sendMail) {
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

        // Free-but-mailed (the AI panel's trial) has nothing to lock, so the
        // escrow step is absent from the trace rather than drawn as a payment
        // of nothing. Everything after it — the letter, the reply, the result —
        // is the same call the paid path makes.
        if (charge > 0) {
          set((s) => ({ bem: s.bem - charge, locked: s.locked + charge }));
          emit({ kind: "pay", code: "emit.pay", vars: { n: charge } });
          emit({
            kind: "pay",
            code: "emit.payDetail",
            vars: { fee: fee.toFixed(4), net: net.toFixed(4) },
          });
          await sleep(stepMs());
        }

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
        mailed.push(reqMsg.id);
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
        mailed.push(resMsg.id);
        emit({
          kind: "reply",
          code: "emit.reply",
          detail: `${requestId.slice(0, 18)}…`,
          json: resPayload,
        });
        await sleep(stepMs());

        if (charge > 0) {
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
        }
        emit({ kind: "result", code: "emit.done", json: result });
        finish({ status: "ok", result, requestId });
        persist();
        return { ok: true, result };
      } catch (err) {
        const reason = errorReason(err);
        // The other half of the continuation: this call was the unpaid attempt
        // of a submission whose caller will buy it (see `aiChat`), and the
        // server refused the trial. A quota refusal takes no unit and reaches
        // no model, so this attempt is not a call — it leaves no trace and
        // keeps no letter, and the submission goes on to buy the same call.
        // Nothing is refunded because nothing was escrowed (`charge` is 0 on
        // an unpaid call); every other failure keeps the ordinary path.
        if (!paid && args.retryPaidOnQuota === true && reason === "quota") {
          set((s) => ({
            busy: false,
            activeCalls: Math.max(0, s.activeCalls - 1),
            traces: s.traces.filter((t) => t.id !== traceId),
            messages: s.messages.filter((m) => !mailed.includes(m.id)),
          }));
          return { ok: false, error: t(errorMessageKey(err), errorVars(err)), reason };
        }
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
        return { ok: false, error, reason };
      }
    },
  };
});
