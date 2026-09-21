import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppProviders } from "@/components/providers";
import { DEFAULT_LOCALE, LocaleContext, htmlLang, t } from "@/lib/i18n";
import { readRequestLocale } from "@/lib/locale-request";
import appCss from "../styles.css?url";

const APP_NAME = "DeWEB MCP";

export const Route = createRootRoute({
  /**
   * The request's locale, resolved on the server before the first byte of
   * markup is written: the cookie wins, then `Accept-Language`, then English.
   * Everything below renders in it, `<html lang>` included, so the first client
   * render matches the server's markup instead of repainting it (React #418).
   */
  loader: async () => ({ locale: (await readRequestLocale()) ?? DEFAULT_LOCALE }),
  /**
   * Keep the server's answer for the whole session. A client-side re-run reads
   * no cookie (`readRequestLocale` is null off the server) and would silently
   * drop the locale back to English on the first navigation.
   */
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0c0c0d" },
      {
        name: "description",
        // The description follows the rendered language; the brand name does not.
        content: t("meta.description", undefined, loaderData?.locale ?? DEFAULT_LOCALE),
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const { locale } = Route.useLoaderData();
  return (
    <html lang={htmlLang(locale)} data-locale={locale} className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleContext.Provider value={locale}>
          <PreviewHostBridge />
          <AuthProvider>
            <AppProviders>
              <Outlet />
            </AppProviders>
          </AuthProvider>
        </LocaleContext.Provider>
        <Scripts />
      </body>
    </html>
  );
}
