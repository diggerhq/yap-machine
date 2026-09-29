// The router, created per request on the server and once in the browser. On
// the server it also stamps the document: a fresh nonce on the framework's
// inline bootstrap scripts and the matching security headers.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

async function stampDocument(): Promise<string> {
  const { setResponseHeaders } = await import("@tanstack/react-start/server");
  const { securityHeaders } = await import("./server/headers");
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  setResponseHeaders(new Headers(securityHeaders(nonce)));
  return nonce;
}

export async function getRouter() {
  const nonce = import.meta.env.SSR ? await stampDocument() : undefined;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: false,
    ...(nonce ? { ssr: { nonce } } : {}),
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}
