/**
 * The locale one request is rendered in.
 *
 * The site used to decide its language on the client only, so the server
 * always painted English (`<html lang="en">`), the client immediately
 * repainted in the stored language, and React logged hydration error #418 on
 * every non-English first load. The request itself carries the answer — the
 * cookie the language buttons write, or the browser's `Accept-Language` — so it
 * is read on the server, serialized by the root route, and echoed into
 * `<html lang>` / `<html data-locale>` for the first client render.
 *
 * `createIsomorphicFn` keeps the server-only import server-only: the client
 * half of this function returns null, and the bundler drops the other half.
 */
import { createIsomorphicFn } from "@tanstack/react-start";
import { LOCALE_COOKIE, matchAcceptLanguage, parseLocale, type Locale } from "./i18n";

export const readRequestLocale = createIsomorphicFn()
  .server(async (): Promise<Locale | null> => {
    const { getCookie, getRequestHeader } = await import("@tanstack/react-start/server");
    const fromCookie = parseLocale(getCookie(LOCALE_COOKIE));
    if (fromCookie) return fromCookie;
    return matchAcceptLanguage(getRequestHeader("accept-language") ?? null);
  })
  .client((): Locale | null => null);
