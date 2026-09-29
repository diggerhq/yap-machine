// One Vite project, one artifact: TanStack Start builds the client and the
// server together, and the Cloudflare plugin turns that server into the
// Worker (the assets and the worker come out of `vite build`; `wrangler
// deploy` ships them). `vite dev` runs the same server in this process with
// .env.local loaded into it, the way the Worker gets its variables in
// production, so nothing about configuration differs between the two.
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function publicHosts(): string[] {
  try {
    return process.env.YAP_PUBLIC_ORIGIN ? [new URL(process.env.YAP_PUBLIC_ORIGIN).host] : [];
  } catch {
    return [];
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    // The environment wins over the file, so a replay (dev/e2e) can point the
    // same server at its fixtures without touching .env.local.
    for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
      process.env[key] ??= value;
    }
  }
  return {
    resolve: { tsconfigPaths: true },
    // The agent, which runs in the cloud, reaches the dev server through a
    // tunnel at YAP_PUBLIC_ORIGIN (npm run tunnel), so that host is allowed.
    server: { allowedHosts: publicHosts() },
    plugins: [
      tailwindcss(),
      ...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
      tanstackStart({ srcDirectory: "src", server: { entry: "server.ts" } }),
      react(),
    ],
  };
});
