import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isSubmitEnter } from "@/lib/ai/ime";
import { useT } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";

/**
 * The AI-call service's own panel: ask one question, get one answer.
 *
 * Two letters per call — a request and a reply — so the panel shows the round
 * trip as the service's product, and the trace beside it records the same two
 * letters. The trial counter is read from the server (this component never
 * decides whether a call is allowed) and re-read after every spend, so the
 * line always names the number the server enforced.
 */
export function AiPanel() {
  const t = useT();
  const aiChat = useTape((s) => s.aiChat);
  const quota = useTape((s) => s.quota);
  const refreshQuota = useTape((s) => s.refreshQuota);

  const [text, setText] = useState("");
  const [reply, setReply] = useState<{ text: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  const send = async () => {
    const question = text.trim();
    if (!question || waiting) return;
    setWaiting(true);
    setError(null);
    const result = await aiChat(question);
    setWaiting(false);
    if (!result.ok) {
      setReply(null);
      setError(result.error ?? t("err.fail"));
      return;
    }
    setReply({ text: result.reply ?? "", model: result.model ?? "" });
  };

  return (
    <div className="grid max-w-2xl gap-4" data-testid="ai-panel">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">{t("ai.lead")}</p>

      {/* Only shown once the server has answered: a made-up number here would
          claim a trial count this page does not know. */}
      {quota ? (
        <p className="font-mono text-xs text-subtle" data-testid="ai-quota">
          {t("ai.quota.free", { n: quota.left })}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Input
          value={text}
          maxLength={500}
          placeholder={t("ai.input.placeholder")}
          aria-label={t("ai.input.placeholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; the Enter that picks an IME candidate does not.
            if (
              isSubmitEnter({
                key: event.key,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.nativeEvent.keyCode,
              })
            )
              void send();
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={waiting || text.trim().length === 0} onClick={() => void send()}>
            {t("ai.send")}
          </Button>
          {/* The samples fill the box rather than sending: what is about to be
              mailed should be readable before it is. */}
          <Button
            variant="secondary"
            size="sm"
            className="max-w-[240px]"
            title={t("ai.sample.translate")}
            onClick={() => setText(t("ai.sample.translate"))}
          >
            <span className="truncate">{t("ai.sample.translate")}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="max-w-[240px]"
            title={t("ai.sample.ask")}
            onClick={() => setText(t("ai.sample.ask"))}
          >
            <span className="truncate">{t("ai.sample.ask")}</span>
          </Button>
        </div>
      </div>

      <div
        className="rounded-lg bg-raised px-4 py-3 shadow-[var(--shadow-border)]"
        data-testid="ai-reply"
        aria-live="polite"
      >
        {waiting ? (
          <p className="text-sm text-muted">{t("ai.waiting")}</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : reply ? (
          <div className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              {t("ai.replyLabel")}
            </span>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.text}</p>
            {reply.model ? (
              <span className="font-mono text-[10px] text-subtle" data-testid="ai-model">
                {reply.model}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-subtle">—</p>
        )}
      </div>

      <p className="text-xs text-subtle">{t("ai.note")}</p>
    </div>
  );
}
