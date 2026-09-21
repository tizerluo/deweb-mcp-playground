import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { htmlLang, useI18n } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";
import { getModelContext } from "@/lib/tape/webmcp";

function LangSync() {
  const locale = useI18n((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);
  return null;
}

function Ticker() {
  const tick = useTape((s) => s.tick);
  useEffect(() => {
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [tick]);
  return null;
}

function PersistedState() {
  const hydratePersisted = useTape((s) => s.hydratePersisted);
  useEffect(() => {
    // After hydration, never during the first render: the server has no
    // localStorage, so a balance/board read before React finishes hydrating
    // paints different text than the markup it is hydrating (#418).
    hydratePersisted();
  }, [hydratePersisted]);
  return null;
}

function TapeKitBridge() {
  const call = useTape((s) => s.call);
  useEffect(() => {
    getModelContext();
    window.tape = {
      call: (service, method, params, opts) => {
        const slug = service.replace(/\.tape$/, "");
        return call({ slug, method, params, pay: Boolean(opts?.pay) });
      },
    };
    return () => {
      delete window.tape;
    };
  }, [call]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Ticker />
      <PersistedState />
      <LangSync />
      <TapeKitBridge />
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          className: "bg-raised text-fg border-line",
        }}
      />
    </QueryClientProvider>
  );
}
