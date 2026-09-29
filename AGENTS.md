# Yap machine

Finds posts on X worth answering. An OpenComputer agent pulls fresh posts
through saved X searches and scores each against the owner's brief; a
TanStack Start app shows the ranked feed and links every post to X, where
the owner replies by hand. The README serves people; this file serves agents.

## Layout

- `opencomputer/` the agent.
  - `project.ts` names project `yap-machine` and its one agent, `yap`, whose
    cloud id is `yap-machine`.
  - `agents/yap/agent.ts` picks the role from the input payload: `scout` or
    `learning`; any other session gets no tools. The instructions for both
    roles are here.
  - `agents/yap/contract.ts` holds `MODEL_ID` and every JSON Schema the tools
    and the app share: tool inputs, the report, the `/api/agent/*` bodies.
  - `agents/yap/connections/` the X API and the app. `app.ts` holds the app's
    public origin as a literal.
  - `agents/yap/tools/` one file per tool; `x-search.ts` builds the X request
    and parses responses.
  - `agents/yap/schedules/scout.ts` the five-minute schedule (production).
- `supabase/migrations/` every table, grant and database function, applied in
  name order. `supabase/seed.sql` authored sample posts for every card state.
- `src/routes/` the screens (`index` is the feed, `searches`, `brief`) and the
  server routes: `api/*` for the owner, `api/agent/*` for the agent.
  `-guards.ts` holds the two guards.
- `src/server/` what the routes call, with no framework imports:
  - `agent-api.ts` and `owner-api.ts` the handlers, one database function each;
  - `db.ts` the one database seam (`rpc` only); `wiring.ts` configuration,
    database, management client, clock and `waitUntil` per request;
  - `env.ts`, `agent-auth.ts`, `origin.ts`, `headers.ts`, `problem.ts`;
  - `learning.ts` starts learning runs and ends finished ones; `scout.ts` the
    input every scout run starts with; `client.ts` the OpenComputer
    management client; `brief.ts` renders the brief for the model.
- `src/shared/` the only seam the browser and the server both import: the
  validators built from the agent's schemas, and the view types.
- `src/components/`, `src/lib/` the browser side.
- `scripts/` one file per npm command; `local-env.ts` is the configuration
  they all read.
- `dev/` everything auxiliary: `test/` (SQL runs in PGlite, routes are served
  by `serve.ts`), `e2e/` the screenshot suite, `fixtures/x/` authored X
  responses (no real posts), `local/` the local database stand-in (PGlite
  with the real migrations, behind PostgREST's `rpc` endpoint) and the sample
  app, `design/screens/` the captures.

## Commands

- Setup, once (README): `npm run setup` (local files only), `npm run secrets`, `npm run deploy:agent`
- `npm run dev` the app and its local database; `npm run tunnel` ngrok to it; `npm run dev:sample` the app over sample data on port 3310
- `npm run check` typecheck (app and agent), lint, unit tests, build; what CI runs
- `npx playwright test --config dev/playwright.config.ts` captures every screen into `dev/design/screens`
- `npm run seed:brief -- <path>`, `npm run scout:once`, `npm run rejudge`, `npm run avatars`
- `npm run doctor` checks the agent directory

## Invariants

- Nothing writes text for X or posts to it. The app links to posts and opens X's own reply composer; the agent only scores.
- The model never supplies a query, a cursor or post content. Tool code does the plumbing; the model judges.
- The brief and the search queries are the owner's: they live in the database, never in Git.
- The browser talks only to the app's routes; the server alone holds the database and OpenComputer keys.
- Every multi-step write is one Postgres function called through `db.rpc`. Functions refuse with `{ error: "<code>" }`, which `problem.ts` maps to a status, and take the clock as `p_now`.
- A schema change is a new migration file; never edit an applied one.
- Agent routes require the bearer token. Owner routes answer only on the app's own host, never through the tunnel, and owner writes require the app's own origin.
- `connections/app.ts` holds the owner's public origin; `npm run setup` writes it. The committed value is a placeholder; never commit a real one.
- `.opencomputer/project.json`, `.env.local` files and `*.local.md` are per clone and ignored. Never print or commit secrets.
- Agent code imports only relative modules and `@opencomputer/agent` (plus type-only `json-schema-to-ts`).
- `GAP(Gn)` comments mark workarounds for current OpenComputer limitations; each says what the limitation is where it applies.
