/**
 * How one decision row reads in the message strip.
 *
 * The strip used to treat "no request id" as "no reply, refunded", so a tick
 * whose wallet could not cover the fee — no letter, no escrow, no refund —
 * was drawn as money held and given back. The three states are now told apart,
 * and the reason behind the silent one is a key the UI translates.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES } from "../i18n.ts";
import { messageRowKind, notSentReasonKey, type MessageRowInput } from "./rows.ts";

function row(overrides: Partial<MessageRowInput> = {}): MessageRowInput {
  return {
    requested: true,
    envelope: { requestId: "5a4f…" },
    decision: { reason: null },
    ...overrides,
  };
}

describe("message strip rows", () => {
  it("reads a rules-forced move as nothing sent at all", () => {
    const forced = row({ requested: false, envelope: { requestId: "" } });
    assert.equal(messageRowKind(forced), "forced");
  });

  it("reads a request that never went out as not sent, never as refunded", () => {
    const dry = row({ envelope: { requestId: "" }, decision: { reason: "insufficient_bem" } });
    assert.equal(messageRowKind(dry), "not-sent");
    const rateLimited = row({ envelope: { requestId: "" }, decision: { reason: "rate_limited" } });
    assert.equal(messageRowKind(rateLimited), "not-sent");
  });

  it("reads a letter that went out as settled, reply or not", () => {
    assert.equal(messageRowKind(row()), "settled");
    const noReply = row({ decision: { reason: "timeout" } });
    assert.equal(messageRowKind(noReply), "settled", "a timeout still sent a letter");
  });

  it("names why nothing was sent", () => {
    assert.equal(
      notSentReasonKey(
        row({ envelope: { requestId: "" }, decision: { reason: "insufficient_bem" } }),
      ),
      "jev.err.insufficient_bem",
    );
    assert.equal(
      notSentReasonKey(row({ envelope: { requestId: "" }, decision: { reason: null } })),
      "err.fail",
      "an unknown reason still has to say something",
    );
  });

  it("only ever asks for keys the four language tables carry", () => {
    const reasons = [
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
    ] as const;
    for (const loc of ["zh", "en", "ja", "ko"] as const) {
      const table = new Set(Object.keys(MESSAGES[loc]));
      assert.ok(table.has("err.fail"), loc);
      for (const reason of reasons) {
        const key = notSentReasonKey(row({ envelope: { requestId: "" }, decision: { reason } }));
        assert.ok(table.has(key), `${loc} is missing ${key}`);
      }
    }
  });
});
