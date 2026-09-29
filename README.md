# Yap machine

Finds the posts on X worth answering. An [OpenComputer](https://opencomputer.dev)
agent pulls fresh posts through a few saved X searches and scores each one
against a brief you write: is it on your topics, can you add something, is the
thread still young. A small app shows the ranked feed. Every post links to
X, where you read the thread and reply yourself. Nothing here writes or
posts for you.

```
X recent search ──► yap agent (OpenComputer) ──► the app's /api/agent routes ──► database
                     scores each post 0–100                                        │
you ◄── feed: Open · Filtered · Handled ◄── the app ◄────────────────────────────────┘
 └──► Not relevant / Relevant (+ a note) ──► learning run folds it into the brief's rules
```

## Run it locally

The app and its database run on your machine. The agent runs in your
OpenComputer project's development environment and reaches the app through a
Cloudflare quick tunnel, which needs no Cloudflare account.

You need:

- Node 22.
- An OpenComputer account: `npx opencomputer login`.
- An X API app on [pay-per-use](https://docs.x.com/x-api/getting-started/pricing)
  with credits loaded, and its app-only **bearer token**.
- An OpenComputer **API key** for your organization, from the dashboard. The
  app uses it to start the agent's runs.

Then:

```bash
npm install
cp .env.example .env.local                           # set OPENCOMPUTER_API_KEY
cp opencomputer/.env.example opencomputer/.env.local # set X_BEARER_TOKEN
npm run dev
```

`npm run dev` does everything in one go:

1. generates the token the agent uses on the app's routes, into both
   `.env.local` files;
2. links an OpenComputer project named `yap-machine` on the first run;
3. starts a local database (Postgres in WebAssembly, kept in `dev/local/.pglite`);
4. starts the app on http://localhost:3300;
5. opens a tunnel and writes its address into the agent's `app` connection;
6. uploads the agent's development secrets;
7. deploys the agent to development.

Keep it running. In a second terminal:

```bash
npm run seed:brief -- brief.example.md   # a brief and three searches; make your own copy first
npm run scout:once                       # one scout run: search X, store, score
```

Open http://localhost:3300. Posts appear as the run scores them. Run
`npm run scout:once` again whenever you want fresh posts; a search runs only
once its interval has passed. Follow a run with the
`npx opencomputer session attach <id>` command that `scout:once` prints.

Each `npm run dev` gets a new tunnel address, so it redeploys the agent,
and `opencomputer/agents/yap/connections/app.ts` shows as changed. That file
holds your app's address; don't commit the tunnel's.

To use a hosted Supabase project instead of the local database, apply
`supabase/migrations/` to it and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
(an `sb_secret_…` key) in `.env.local`.

## Using it

- **Feed.** *Open* is what scored at or above the threshold (60), ranked by
  score and freshness; a post loses half its rank every six hours. *Filtered*
  is what scored lower. *Handled* is what you opened or marked.
- **Open on X** opens the post in a new tab, where you reply by hand.
- **Not relevant** on an Open post, or **Relevant** on a Filtered one, takes
  an optional one-line note. The next scout run reads your marks as examples.
  A learning run then folds them into short rules in the brief and re-scores
  the feed.
- **Keys:** `j`/`k` move, `o` opens on X, `x` marks Not relevant, `r` marks
  Relevant.
- **Searches** are saved X queries, each with its own interval. Edit them in
  the app; there is nothing to deploy.
- **Brief** is your sections, which only you edit, plus the learned rules,
  each linked to the feedback behind it. Every change makes a version you
  can diff and restore.

Your brief and searches are your strategy. They live in the database, not in
this repository; `*.local.md` files are ignored for your working copy.

## What it costs

- **X:** $0.005 per post and $0.010 per user returned, counted once per UTC
  day. The app stops searching at `YAP_DAILY_X_SPEND_USD` (default $25) and
  shows today's spend in the header. Each search pays for a post once.
- **OpenComputer:** each run's model calls and machine time, billed to your
  organization.

## How it's built

- `opencomputer/`: the agent. One agent, two roles chosen by the payload that
  starts it: a **scout** run searches, stores and scores; a **learning** run
  turns feedback into rules. Tool code calls X and the app, keeps the cursors
  and the budget, and leases posts in small batches. The model only scores.
  The X token and the app token are attached by OpenComputer outside the
  agent's machine, so a post that tries to hijack the model finds no key.
- `src/`: the app, TanStack Start on Cloudflare Workers. The browser talks
  only to the app's routes; the agent reaches `/api/agent/*` with its token.
- `supabase/migrations/`: every table and every write, as Postgres functions.

`AGENTS.md` maps the code for coding agents.

## Development

```bash
npm run check                      # typecheck, lint, tests (SQL runs in PGlite), build
npm run dev:sample                 # the app over authored sample data, no agent
npx playwright test --config dev/playwright.config.ts   # captures every screen
```

Deploying the app to Workers, with Cloudflare Access in front of it, is not
written up yet.
