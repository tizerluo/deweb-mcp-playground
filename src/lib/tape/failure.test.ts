/**
 * Typed call failures, and the two sentences derived from them.
 *
 * A failed paid call used to throw a plain `Error` carrying an already-localized
 * sentence, so the refund note guessed at what had happened: an insufficient
 * transfer amount was reported as "the provider never matched a reply", blaming
 * the provider for a local balance check. The code now classifies the failure,
 * and every message key it can produce is checked against the four language
 * tables below.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES } from "../i18n.ts";
import {
  CallError,
  errorDetail,
  errorMessageKey,
  errorVars,
  refundBucket,
  refundDetailKey,
} from "./failure.ts";

const keysOf = (loc: keyof typeof MESSAGES) => new Set(Object.keys(MESSAGES[loc]));

describe("call failures", () => {
  it("blames a local check for a local check", () => {
    for (const code of ["noPayee", "badAmt", "lowPay", "lowBem"] as const) {
      assert.equal(refundBucket(new CallError(code)), "validation", code);
      assert.equal(refundDetailKey(new CallError(code)), "emit.refundDetail.validation", code);
    }
  });

  it("blames the provider side when the provider side failed", () => {
    assert.equal(refundBucket(new CallError("jev", "timeout")), "provider");
    assert.equal(refundBucket(new CallError("price", "http")), "provider");
    assert.equal(refundBucket(new CallError("provider")), "provider");
    assert.equal(
      refundDetailKey(new CallError("jev", "timeout")),
      "emit.refundDetail.provider",
      "a provider that never matched a reply is the provider's doing",
    );
  });

  it("falls back to a neutral note for anything else", () => {
    for (const code of ["noService", "noMethod", "busy", "unknown"] as const) {
      assert.equal(refundBucket(new CallError(code)), "unknown", code);
    }
    assert.equal(refundBucket(new Error("boom")), "unknown");
    assert.equal(refundBucket("boom"), "unknown");
    assert.equal(refundDetailKey(new Error("boom")), "emit.refundDetail.unknown");
  });

  it("resolves a message key at display time, not at throw time", () => {
    assert.equal(errorMessageKey(new CallError("jev", "quota")), "jev.err.quota");
    assert.equal(errorMessageKey(new CallError("price", "empty")), "price.err.empty");
    assert.equal(errorMessageKey(new CallError("provider")), "err.fail");
    assert.equal(errorMessageKey(new CallError("noPayee")), "err.noPayee");
    assert.equal(errorMessageKey(new Error("boom")), "err.fail");
  });

  it("carries the placeholder values a key needs", () => {
    const low = new CallError("lowBem", "0.05");
    assert.equal(errorMessageKey(low), "err.lowBem");
    assert.deepEqual(errorVars(low), { n: "0.05" });
    assert.equal(errorVars(new CallError("noPayee")), undefined);
    assert.equal(errorVars(new Error("boom")), undefined);
  });

  it("keeps the raw detail machine-readable", () => {
    assert.equal(errorDetail(new CallError("jev", "rate_limited")), "rate_limited");
    assert.equal(errorDetail(new Error("boom")), undefined);
    const err = new CallError("provider");
    assert.equal(err.name, "CallError");
    assert.equal(err.message, "provider");
  });

  it("never produces a key that is missing from a language table", () => {
    const keys = new Set<string>();
    const codes = [
      "noService",
      "noMethod",
      "busy",
      "lowBem",
      "noPayee",
      "badAmt",
      "lowPay",
      "unknown",
      "provider",
    ] as const;
    for (const code of codes) {
      keys.add(errorMessageKey(new CallError(code)));
      keys.add(refundDetailKey(new CallError(code)));
    }
    // The classified failures carry a machine reason: only the reasons that
    // code can actually produce name keys the tables are expected to hold.
    const reasonsByCode = {
      jev: [
        "insufficient_bem",
        "rate_limited",
        "quota",
        "unauthorized",
        "bad_request",
        "invalid_request",
        "upstream",
        "timeout",
        "network",
        "parse_error",
        "no_key",
      ],
      price: ["http", "empty", "network"],
    } as const;
    for (const code of ["jev", "price"] as const) {
      keys.add(refundDetailKey(new CallError(code)));
      for (const reason of reasonsByCode[code])
        keys.add(errorMessageKey(new CallError(code, reason)));
    }
    for (const loc of ["zh", "en", "ja", "ko"] as const) {
      const table = keysOf(loc);
      for (const key of keys) {
        if (key === "err.provider") continue; // mapped to err.fail, never rendered
        assert.ok(table.has(key), `${loc} is missing ${key}`);
      }
    }
  });
});
