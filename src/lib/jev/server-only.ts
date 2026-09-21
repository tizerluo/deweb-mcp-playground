/**
 * The JEV key is server-side only. Any import path that could end up in a
 * client bundle trips this guard at module load, mirroring
 * `@/lib/app-data/server-only.ts`.
 */
export function assertJevServerOnly(context = "@/lib/jev/client.server"): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${context} is server-only. Call it from a createServerFn handler (see ` +
        "@/lib/jev/decide.ts); the model key must never reach the browser.",
    );
  }
}
