/**
 * How one decision row reads in the message strip.
 *
 * The strip used to treat "no request id" as "no reply, refunded", so a tick
 * whose call never went out — no letter, no escrow, no refund — was drawn as
 * money held and given back. The three states are now told apart, and the
 * reason behind the silent one is a key the UI translates.
 *
 * The demos play for free, which made a second version of the same mistake
 * visible: `charge > 0 ? charged : refunded` called every free, unanswered
 * letter "refunded". A letter that carried nothing and got no reply has no
 * money outcome to report, and the strip says nothing about money for it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES } from "../i18n.ts";
import {
  messageRowKind,
  messageStatusKey,
  notSentReasonKey,
  type MessageRowInput,
} from "./rows.ts";

const ANSWERED = "9c2e…";

function envelope(overrides: Partial<MessageRowInput["envelope"]> = {}) {
  return { requestId: "5a4f…", paidBem: 0, resDigest: null, ...overrides };
}

function row(overrides: Partial<MessageRowInput> = {}): MessageRowInput {
  return {
    requested: true,
    envelope: envelope(),
    decision: { reason: null },
    ...overrides,
  };
}

describe("message strip rows", () => {
  it("reads a rules-forced move as nothing sent at all", () => {
    const forced = row({ requested: false, envelope: envelope({ requestId: "" }) });
    assert.equal(messageRowKind(forced), "forced");
  });

  it("reads a request that never went out as not sent, never as refunded", () => {
    const dry = row({ envelope: envelope({ requestId: "" }), decision: { reason: "quota" } });
    assert.equal(messageRowKind(dry), "not-sent");
    const rateLimited = row({
      envelope: envelope({ requestId: "" }),
      decision: { reason: "rate_limited" },
    });
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
        row({ envelope: envelope({ requestId: "" }), decision: { reason: "quota" } }),
      ),
      "jev.err.quota",
    );
    assert.equal(
      notSentReasonKey(row({ envelope: envelope({ requestId: "" }), decision: { reason: null } })),
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
        const key = notSentReasonKey(
          row({ envelope: envelope({ requestId: "" }), decision: { reason } }),
        );
        assert.ok(table.has(key), `${loc} is missing ${key}`);
      }
    }
  });
});

describe("what a settled letter says about its outcome", () => {
  it("says accepted when a reply came back, paid or free", () => {
    assert.equal(
      messageStatusKey(row({ envelope: envelope({ resDigest: ANSWERED }) })),
      "jev.messages.charged",
    );
    assert.equal(
      messageStatusKey(row({ envelope: envelope({ resDigest: ANSWERED, paidBem: 0.0003 }) })),
      "jev.messages.charged",
    );
  });

  it("says refunded only when money was actually carried and no reply came", () => {
    assert.equal(
      messageStatusKey(row({ envelope: envelope({ paidBem: 0.0003 }) })),
      "jev.messages.refunded",
    );
  });

  it("claims nothing about money for a free letter that got no reply", () => {
    // The regression this rule exists for: with no reply and nothing paid,
    // "refunded" would be a refund of money that never changed hands.
    assert.equal(messageStatusKey(row({ envelope: envelope() })), null);
  });

  it("claims nothing for the rows that sent no letter at all", () => {
    assert.equal(
      messageStatusKey(row({ requested: false, envelope: envelope({ requestId: "" }) })),
      null,
    );
    assert.equal(messageStatusKey(row({ envelope: envelope({ requestId: "" }) })), null);
  });
});
