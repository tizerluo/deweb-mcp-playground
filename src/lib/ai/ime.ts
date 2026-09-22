/**
 * When an Enter press means "send" for a text box.
 *
 * Chinese, Japanese and Korean visitors press Enter to commit an IME
 * candidate, and that keydown belongs to the input method rather than to the
 * visitor: taking it as a submit mails a half-typed question, and on a keyed
 * deploy it spends one of the day's two free calls before the sentence exists.
 * Composition is reported two ways — `isComposing` on the event itself, and
 * the legacy `keyCode 229` that some engines send for the same key — so both
 * are checked rather than trusting either alone.
 */
export type SubmitKey = {
  key: string;
  /** `KeyboardEvent.isComposing`: the IME is mid-composition. */
  isComposing?: boolean;
  /** The legacy "the IME handled this key" code. */
  keyCode?: number;
};

/** A visitor's own Enter, never an IME candidate pick. */
export function isSubmitEnter(event: SubmitKey): boolean {
  if (event.key !== "Enter") return false;
  if (event.isComposing === true) return false;
  return event.keyCode !== 229;
}
