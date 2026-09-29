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
    plugins: [
      tailwindcss(),
      ...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
      tanstackStart({ srcDirectory: "src", server: { entry: "server.ts" } }),
      react(),
    ],
  };
});
