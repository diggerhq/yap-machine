import { defineConfig } from "vitest/config";

// The unit tests (dev/test). They import the app, the agent and the scripts
// directly and never start Vite, so this config stays independent of
// vite.config.ts and its plugins. SQL runs in PGlite (dev/test/pg.ts).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["dev/test/**/*.test.{ts,tsx}"],
  },
});
