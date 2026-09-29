// The screenshot loop over the real application: the app runs on the local
// database stand-in (PGlite with the real migration, loaded with
// supabase/seed.sql), and the spec captures every screen and card state at
// 390 and 1440 in both themes under dev/design/screens.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3310", screenshot: "off" },
  webServer: {
    command: "npx tsx dev/local/run.ts",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: "http://localhost:3310/api/status",
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
