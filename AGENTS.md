# Yap machine

Finds X posts worth answering for one OpenComputer founder. An OpenComputer
agent pulls fresh posts through saved X searches and scores each against a
private brief; a TanStack Start app on Cloudflare Workers shows the ranked
feed and links every post to X, where the owner replies by hand. The README
serves people; this file serves agents. The build contract, decisions and
gap log live outside this repository (work 036 in the Serverless Agents
design repository).

## Layout

- `opencomputer/` the agent. `project.ts` names project `yap-machine` and its
  one agent `yap` (cloud id `yap-machine`). `agents/yap/agent.ts` picks the
  role from the input payload (`scout` or `learning`; anything else gets no
  tools); `contract.ts` holds `MODEL_ID` and every JSON Schema the tools and
  the app share; `connections/` the X API and the app; `tools/` one file per
  tool; `schedules/scout.ts` the five-minute schedule.
- `supabase/migrations/` the one migration: tables, grants, views and every
  database function. `supabase/seed.sql` authored posts for every card state.
- `src/routes/` the screens (`index` feed, `searches`, `brief`) and the
  server routes: `api/*` for the owner, `api/agent/*` for the agent.
- `src/server/` modules the server routes call, with no framework imports:
  `env.ts` configuration per request, `db.ts` the one database seam
  (`rpc` only), `agent-auth.ts`, `origin.ts`, `headers.ts`, `learning.ts`
  (starting and ending learning runs), `client.ts` the OpenComputer
  management client.
- `src/shared/` the only seam the client and the server both import: the
  validators built from the agent's schemas and the view types.
- `scripts/` one file per command: `setup.ts` (local files only), `secrets.ts`,
  `dev.ts` (app and local database), `tunnel.ts` (ngrok), `seed-brief.ts` with
  its parser `brief-file.ts`, `scout-once.ts`; `local-env.ts` is the
  configuration they all read.
- `dev/local/db-server.ts` the local database: PGlite with the real
  migration behind a stand-in for PostgREST's `rpc` endpoint, so supabase-js
  and the app run unmodified.
- `dev/` tests (`dev/test`, SQL functions run in PGlite), fixtures (authored
  X responses; no real third-party posts), the capture suite (`dev/e2e`) and
  configs. `brief.example.md` is a sample brief for a fictional product.

## Commands

- Local run (README): once `npm run setup`, `npm run secrets`, `npm run deploy:agent`; then `npm run dev` and `npm run tunnel`
- `npm run dev:sample` the app over sample data, no agent (its own database)
- `npm run dev:app` the app alone on port 3300, configuration from `.env.local`
- `npm run check` typecheck (app and agent), lint, unit tests, build; what CI runs
- `npm run seed:brief -- <path>` loads a brief and its searches into the app's database
- `npm run scout:once` starts one scout run on `YAP_AGENT_REF`
- `npm run doctor`, `npm run deploy:agent` the agent (`npx opencomputer login` first)
- `npm run deploy` builds and ships the Worker

## Invariants

- Nothing writes text for X or posts to it. The app links to posts on X; the agent only scores.
- The brief and the search queries are internal: they live in the database, never in Git.
- The browser talks only to the app's routes; the Worker alone holds the Supabase and OpenComputer keys.
- Every multi-step write is one Postgres function called through `db.rpc`.
- Agent routes require the bearer token. Owner routes answer only on the app's own host (not through the tunnel), and owner writes require the app's own origin.
- `connections/app.ts` holds the app's public origin as a literal (gap G5); `npm run setup` writes YAP_PUBLIC_ORIGIN into it. The committed value is a placeholder; never commit your own.
- Commands do one thing each: `dev` starts local processes only; only `secrets` and `deploy:agent` change anything remote.
- `.opencomputer/project.json` is per clone and ignored.
- The model never supplies a query, a cursor or post content: tool code does the plumbing, the model judges.
- Agent code imports only relative modules and `@opencomputer/agent` (type-only imports of `json-schema-to-ts` excepted).
- Platform workarounds carry a `GAP(Gn)` comment naming the gap in work 036.
- Never print or commit secrets; `.env.local`, `.dev.vars` and `brief.local.md` are ignored.
