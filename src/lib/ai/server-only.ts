/**
 * The model key is server-side only. Any import path that could end up in a
 * client bundle trips this guard at module load, mirroring
 * `@/lib/jev/server-only.ts`.
 */
export function assertAiServerOnly(context = "@/lib/ai/client.server"): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${context} is server-only. Call it from a createServerFn handler (see ` +
        "@/lib/ai/chat.ts); the model key must never reach the browser.",
    );
  }
}
