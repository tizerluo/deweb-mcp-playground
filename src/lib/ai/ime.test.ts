/**
 * Enter-to-send, and the Enter that is not a send.
 *
 * A Chinese, Japanese or Korean visitor picks an IME candidate with Enter, and
 * that keydown belongs to the input method: treating it as a submit mails a
 * half-typed question, and on a keyed deploy it spends one of the day's two
 * free calls before the sentence exists. The review reproduced it against the
 * live input box; these are the same cases as plain values.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSubmitEnter } from "./ime.ts";

describe("isSubmitEnter", () => {
  it("sends on a plain Enter", () => {
    assert.equal(isSubmitEnter({ key: "Enter", isComposing: false, keyCode: 13 }), true);
    assert.equal(isSubmitEnter({ key: "Enter" }), true, "an engine that reports neither flag");
  });

  it("refuses the Enter that is only picking an IME candidate", () => {
    assert.equal(isSubmitEnter({ key: "Enter", isComposing: true, keyCode: 13 }), false);
    assert.equal(
      isSubmitEnter({ key: "Enter", isComposing: false, keyCode: 229 }),
      false,
      "the legacy code some engines send for the same key",
    );
  });

  it("ignores every other key, composing or not", () => {
    for (const key of ["a", "Escape", "Shift", " "]) {
      assert.equal(isSubmitEnter({ key, isComposing: false, keyCode: 0 }), false);
      assert.equal(isSubmitEnter({ key, isComposing: true, keyCode: 0 }), false);
    }
  });
});
