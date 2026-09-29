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
OpenComputer project's development environment, in the cloud, and calls the
app over HTTPS, so the app needs a public address: an
[ngrok](https://ngrok.com) tunnel to `localhost:3300`, on the fixed domain
ngrok gives every free account.

### What you need

- Node 22 and the [ngrok CLI](https://ngrok.com/download), with your authtoken
  added (`ngrok config add-authtoken …`).
- Your ngrok domain: ngrok dashboard → **Domains** (free accounts get one,
  like `https://your-words.ngrok-free.app`).
- An OpenComputer account (`npx opencomputer login`) and an **API key** for
  your organization, from the dashboard.
- An X API app on [pay-per-use](https://docs.x.com/x-api/getting-started/pricing)
  with credits loaded, and its app-only **bearer token**.

### Set up, once

```bash
npm install
cp .env.example .env.local                           # YAP_PUBLIC_ORIGIN, OPENCOMPUTER_API_KEY
cp opencomputer/.env.example opencomputer/.env.local # X_BEARER_TOKEN
npx opencomputer link --create-project yap-machine   # your project for the agent
npm run setup
npm run secrets
npm run deploy:agent
```

- `npm run setup` changes local files only. It generates the token the agent
  presents to the app, into both `.env.local` files, and writes your ngrok
  domain into the agent's `app` connection
  (`opencomputer/agents/yap/connections/app.ts`). It lists anything still
  missing.
- `npm run secrets` uploads `X_BEARER_TOKEN` and `YAP_AGENT_TOKEN` to your
  project's development environment. OpenComputer attaches them to the
  agent's outgoing requests; the agent's code never sees them.
- `npm run deploy:agent` deploys the agent to development. Run it again after
  you change anything under `opencomputer/`.

If you change `YAP_PUBLIC_ORIGIN`, run all three again: the origin is part
of the agent's source, and a secret's allowed destinations follow it.

### Run

```bash
npm run dev      # terminal 1: the app on http://localhost:3300 and a local database
npm run tunnel   # terminal 2: ngrok from your domain to the app
```

Then, the first time, load a brief and its searches. `brief.example.md` is a
sample for a fictional product; make your own copy and load that.

```bash
npm run seed:brief -- brief.example.md
```

Start a scout run whenever you want fresh posts:

```bash
npm run scout:once
```

It searches X for every search whose interval has passed, stores new posts
and scores them; they appear at http://localhost:3300 as they are scored.
Follow the run with the `npx opencomputer session attach <id>` command it
prints. In development the five-minute schedule does not recur on its own;
in production it does.

The local database lives in `dev/local/.pglite`; delete that directory to
start over. To use a hosted Supabase project instead, apply
`supabase/migrations/` to it and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
(an `sb_secret_…` key) in `.env.local`.

Through the tunnel, only the agent's routes answer, and only with its token.
Your feed, brief and searches are served on `localhost` alone.

## Using it

- **Feed.** *Open* is what scored at or above the threshold (60), ranked by
  score and freshness; a post loses half its rank every six hours. *Filtered*
  is what scored lower. *Handled* is what you opened, marked, or set aside with Done.
- **Open on X** opens the post in a new tab, where you reply by hand.
- **Not relevant** on an Open post, or **Relevant** on a Filtered one, takes
  an optional one-line note. The next scout run reads your marks as examples.
  A learning run then folds them into short rules in the brief and re-scores
  the feed.
- **Done** (✓) sets a post aside with no verdict: it moves to Handled and
  nothing is learned from it. Use it for posts you've already answered or
  simply want to skip.
- **Why it's here** (ⓘ) shows the agent's one-line reason, folded away by
  default.
- **Keys:** `j`/`k` move, `o` opens on X, `x` marks Not relevant, `r` marks
  Relevant, `d` marks Done.
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
npm run dev:sample                 # the app over sample data on :3310, no agent or setup
npx playwright test --config dev/playwright.config.ts   # captures every screen
```

Deploying the app to Workers, with Cloudflare Access in front of it, is not
written up yet.
