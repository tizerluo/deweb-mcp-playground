/**
 * The AI panel's continuation policy, pinned without a browser.
 *
 * The defect this covers (`.review/p2-review-r2.md` P2-R2-01): a tab whose
 * trial counter was read *before* another tab spent it sends an unpaid call,
 * the server refuses for quota, and the visitor had to press send a second
 * time before C-22's paid continuation happened. The equivalent stale snapshot
 * is reproduced here — the tab believes it still has units while the server
 * says otherwise — and then driven through the real policy module: one paid
 * retry inside the same submission, and a hard stop at two attempts for
 * everything else.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chatWithTrialFallback } from "./continuation.ts";

type Attempt = { ok: boolean; reason?: string | null };

/** A server that answers each attempt the way `runAiChat` does, and records who paid. */
function server(answer: (paid: boolean, attempt: number) => Attempt) {
  const paid: boolean[] = [];
  return {
    paid,
    send: async (which: boolean): Promise<Attempt> => {
      paid.push(which);
      return answer(which, paid.length);
    },
  };
}

describe("the chat continuation", () => {
  it("buys the call once when this tab's trial snapshot is stale", async () => {
    // The tab still shows 2 — another tab of the same visitor has spent both.
    const { send, paid } = server((which) =>
      which ? { ok: true } : { ok: false, reason: "quota" },
    );
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 2, send });
    assert.equal(result.ok, true);
    assert.equal(bought, true);
    assert.deepEqual(paid, [false, true], "one unpaid attempt, then one paid one");
  });

  it("asks for the trial while the snapshot still has units, and stays there", async () => {
    const { send, paid } = server(() => ({ ok: true }));
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 2, send });
    assert.equal(result.ok, true);
    assert.equal(bought, false);
    assert.deepEqual(paid, [false], "the trial pays, and nothing is charged");
  });

  it("takes the wallet straight away when the tab already knows the trial is spent", async () => {
    const { send, paid } = server(() => ({ ok: true }));
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 0, send });
    assert.equal(result.ok, true);
    assert.equal(bought, true);
    assert.deepEqual(paid, [true], "no doomed unpaid attempt first");
  });

  it("asks for the trial when no counter has been read yet", async () => {
    const { send, paid } = server((which) =>
      which ? { ok: true } : { ok: false, reason: "quota" },
    );
    const { result } = await chatWithTrialFallback({ trialLeft: null, send });
    assert.equal(result.ok, true);
    assert.deepEqual(paid, [false, true], "an unread counter is not a spent one");
  });

  it("never turns a refusal the wallet cannot pay away into a retry", async () => {
    const final = ["no_key", "rate_limited", "upstream", "timeout", "parse_error"];
    for (const reason of final) {
      const { send, paid } = server(() => ({ ok: false, reason }));
      const { result, bought } = await chatWithTrialFallback({ trialLeft: 2, send });
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(bought, false);
      assert.deepEqual(paid, [false], `${reason} is final`);
    }
  });

  it("does not read a transport failure as a quota refusal", async () => {
    // `call()` reports a failure that never reached the server as a null
    // reason. Buying a call on that would charge the wallet for an outage.
    const { send, paid } = server(() => ({ ok: false, reason: null }));
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 2, send });
    assert.equal(result.ok, false);
    assert.equal(bought, false);
    assert.deepEqual(paid, [false]);
  });

  it("stops after the one paid attempt, whatever it answers", async () => {
    // The first refusal buys the call; the bought call then fails upstream.
    // That failure is reported — it is not paid for a second time.
    const { send, paid } = server((which) =>
      which ? { ok: false, reason: "upstream" } : { ok: false, reason: "quota" },
    );
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 2, send });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "upstream");
    assert.equal(bought, true);
    assert.deepEqual(paid, [false, true], "two attempts, and no third");
  });

  it("does not retry in place when the wallet's own call is refused", async () => {
    // A paid attempt is never refused for quota; if a server ever says so,
    // the submission is over rather than retried in place.
    const { send, paid } = server(() => ({ ok: false, reason: "quota" }));
    const { result, bought } = await chatWithTrialFallback({ trialLeft: 0, send });
    assert.equal(result.ok, false);
    assert.equal(bought, true);
    assert.deepEqual(paid, [true], "no loop on a paid refusal");
  });
});
