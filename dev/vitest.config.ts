import { defineConfig } from "vitest/config";

// Unit tests only (dev/test); they import src/ directly and never start Vite, so this
// config stays independent of vite.config.ts and its plugins. Server tests
// run in node; component tests opt into happy-dom per file with
// `// @vitest-environment happy-dom` at the top.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["dev/test/**/*.test.{ts,tsx}"],
  },
});
