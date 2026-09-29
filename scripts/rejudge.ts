// `npm run rejudge`: clears the scores of posts still in the feed that you
// have not handled, so the next scout run (`npm run scout:once`) scores them
// again under the current instructions and brief. Handled posts, your
// feedback and the learned rules stay. Costs model time only; X is not
// queried again.
import { isRefusal, supabaseDb } from "../src/server/db";
import { appEnv } from "./local-env";

const env = appEnv();
const db = supabaseDb(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY as string, fetch);
const result = await db.rpc<{ reset: number }>("reset_judgments").catch(() => {
  console.error("The database is not reachable, or lacks the latest migration: restart `npm run dev` and try again.");
  process.exit(1);
});
if (isRefusal(result)) throw new Error(result.error);
console.log(`Cleared ${String(result.reset)} scores. Run npm run scout:once to score those posts again.`);
