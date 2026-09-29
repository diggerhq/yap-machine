// `npm run avatars`: fills in the X profile pictures of authors whose posts
// were stored before posts kept one. Looks the authors up on X, 100 per
// request, with X_BEARER_TOKEN from opencomputer/.env.local, and writes the
// pictures to the app's database (the local one while `npm run dev` runs).
// Each user X returns costs $0.01 of your X API credits. New posts carry
// their author's picture already, so this is a one-off.
import { isRefusal, supabaseDb } from "../src/server/db";
import { AGENT_ENV_FILE, appEnv, readEnvFile } from "./local-env";

const env = appEnv();
const token = readEnvFile(AGENT_ENV_FILE).X_BEARER_TOKEN;
if (!token) {
  console.error(`Set X_BEARER_TOKEN in ${AGENT_ENV_FILE}`);
  process.exit(2);
}
const db = supabaseDb(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY as string, fetch);

let authors: string[];
try {
  authors = await db.rpc<string[]>("authors_without_avatar");
} catch {
  console.error("The database is not reachable, or lacks the avatar migration: restart `npm run dev` and try again.");
  process.exit(1);
}
if (authors.length === 0) {
  console.log("Every author in the feed has a picture.");
  process.exit(0);
}
const cost = authors.length * 0.01;
console.log(`Looking up ${String(authors.length)} authors (about $${cost.toFixed(2)})…`);

const bigger = (url: string) => url.replace(/_normal(\.\w+)$/, "_bigger$1");
let posts = 0;
for (let i = 0; i < authors.length; i += 100) {
  const ids = authors.slice(i, i + 100);
  const response = await fetch(`https://api.x.com/2/users?ids=${ids.join(",")}&user.fields=profile_image_url`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.error(`X answered ${String(response.status)}: ${(await response.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const body = (await response.json()) as { data?: { id: string; profile_image_url?: string }[] };
  const users = body.data ?? [];
  const avatars = users
    .filter((u) => u.profile_image_url?.startsWith("https://pbs.twimg.com/"))
    .map((u) => ({ authorId: u.id, avatar: bigger(u.profile_image_url as string) }));
  const result = await db.rpc<{ posts: number }>("set_author_avatars", {
    p_avatars: avatars,
    p_user_reads: users.length,
  });
  if (isRefusal(result)) throw new Error(result.error);
  posts += result.posts;
}
console.log(`Pictures added to ${String(posts)} posts. Reload the feed.`);
