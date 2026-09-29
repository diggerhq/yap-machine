// `npm run tunnel`: ngrok from YAP_PUBLIC_ORIGIN (your ngrok domain) to the
// app on localhost:3300, so the agent, which runs in the cloud, can reach the
// app's /api/agent routes. Needs the ngrok CLI with your authtoken. Keep it
// running beside `npm run dev`.
import { spawn } from "node:child_process";
import { APP_PORT, appEnv, publicOrigin } from "./local-env";

const origin = publicOrigin(appEnv().YAP_PUBLIC_ORIGIN);
if (!origin) {
  console.error("Set YAP_PUBLIC_ORIGIN in .env.local to your ngrok domain, e.g. https://example.ngrok-free.app");
  process.exit(1);
}
const ngrok = spawn("ngrok", ["http", String(APP_PORT), "--url", origin], { stdio: "inherit" });
ngrok.on("error", () => {
  console.error("The ngrok CLI is not installed: https://ngrok.com/download");
  process.exit(1);
});
ngrok.on("exit", (code) => process.exit(code ?? 0));
