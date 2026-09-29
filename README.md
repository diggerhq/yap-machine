# Yap machine

A feed of the posts on X worth answering. An [OpenComputer](https://opencomputer.dev)
agent searches X for you, scores each new post against a brief you write,
and a small app ranks what's left. You read the post, open it on X, and
reply yourself. Nothing here writes or posts for you.

![The feed](dev/design/screens/feed-open-1440-light.png)

## How it works

```
saved X searches ──► scout run (OpenComputer agent) ──► app ──► database
                      fetches new posts, scores each         │
you ◄── feed: Open · Filtered · Handled ◄────────────────────┘
 └──► Not relevant / Relevant ──► learning run turns your marks into rules in the brief
```

- **Searches** are saved X queries: a watchlist of people, a competitor, a
  topic. Each keeps a cursor, so a post is fetched and paid for once.
- **A scout run** fetches new posts for every search that is due, stores
  them, and scores each from 0 to 100 against your brief: is it on your
  topics, and can you add something to it. Code does the searching,
  storing and bookkeeping; the model only scores.
- **The feed** shows posts scoring 60 or more in *Open*, ranked by score
  and freshness, and the rest in *Filtered*.
- **Your marks teach it.** Mark an Open post *Not relevant*, or a Filtered
  one *Relevant*, with an optional note. The next scout run reads your marks
  as examples, and a learning run folds them into short rules in your brief,
  then re-scores the feed.

## Run it locally

The app and its database run on your machine. The agent runs in your
OpenComputer project, in the cloud, and calls the app back over HTTPS, so
the app needs a public address: an [ngrok](https://ngrok.com) tunnel on the
fixed domain every free ngrok account gets.

### You need

- Node 22, and the [ngrok CLI](https://ngrok.com/download) with your
  authtoken added (`ngrok config add-authtoken <token>`).
- Your ngrok domain, from the ngrok dashboard under **Domains**, such as
  `https://your-words.ngrok-free.app`.
- An OpenComputer account (`npx opencomputer login`) and an API key for your
  organization, from the dashboard.
- An X API app on [pay-per-use](https://docs.x.com/x-api/getting-started/pricing)
  with credits loaded, and its app-only bearer token.

### Set up, once

```bash
npm install
cp .env.example .env.local                           # YAP_PUBLIC_ORIGIN, OPENCOMPUTER_API_KEY
cp opencomputer/.env.example opencomputer/.env.local # X_BEARER_TOKEN
npx opencomputer link --create-project yap-machine
npm run setup
npm run secrets
npm run deploy:agent
```

| Step | What it does |
|---|---|
| `link` | Creates your OpenComputer project for the agent. |
| `setup` | Local files only. Generates the token the agent presents to the app, into both `.env.local` files, and writes your ngrok domain into the agent's connection to the app. Lists anything still missing. |
| `secrets` | Uploads `X_BEARER_TOKEN` and the agent token to your project. OpenComputer attaches them to the agent's outgoing requests; the agent's code never sees them. |
| `deploy:agent` | Deploys the agent to your project's development environment. Run it again after changing anything under `opencomputer/`. |

If your ngrok domain changes, run `setup`, `secrets` and `deploy:agent`
again.

### Run

```bash
npm run dev      # terminal 1: the app on http://localhost:3300, with its database
npm run tunnel   # terminal 2: ngrok from your domain to the app
```

The first time, load a brief and its searches. `brief.example.md` is a
sample for a made-up product; copy it, make it yours, and load your copy:

```bash
cp brief.example.md brief.local.md
npm run seed:brief -- brief.local.md
```

Open http://localhost:3300 and press **Refresh**. The button shows the run
as it goes (searching X, then scoring) and reloads the feed when it's done,
usually within a minute or two.

## Using the feed

| Action | Key | What happens |
|---|---|---|
| Reply | `c` | Opens X's reply box for the post in a small window. You write and post it there, as yourself. |
| Open on X | `o` | Opens the post on X in a new tab. |
| Not relevant (Open) | `x` | Asks for an optional note, then moves the post to Handled. The agent learns from it. |
| Relevant (Filtered) | `r` | The same, the other way. |
| Done | `d` | Moves the post to Handled with no verdict. Nothing is learned; use it for posts you've answered already or want to skip. |
| Why it's here | | Shows the agent's one-line reason. |
| Move | `j` `k` | Selects the next or previous post. |

Replies go through X's own composer because X pages can't be embedded, and
X's API only takes a reply from an account the author has mentioned.

## Your brief and searches

The brief says who you are, what your product is, which topics and people
matter, and what to find and skip. `brief.example.md` shows the sections.
`seed:brief` loads the brief and turns its **Searches** table into saved
searches; the model never sees that table.

After loading, both live in the app's database: edit them on the **Brief**
and **Searches** screens. Every brief change makes a version you can diff
and restore, and each learned rule shows the marks behind it. Your brief
and queries stay out of Git; `*.local.md` files are ignored.

Each search runs on its own interval, from 5 minutes to a day. Refresh runs
every search not run in the last five minutes.

## What it costs

- **X:** $0.005 per post and $0.01 per user in a response, charged once per
  UTC day. The app stops searching when today's spend reaches
  `YAP_DAILY_X_SPEND_USD` ($25 by default) and shows the spend in the
  header.
- **OpenComputer:** each run's model calls and machine time, billed to your
  organization.

## How it's built

- **The agent** (`opencomputer/`) is one agent with two roles, chosen by
  the payload that starts it. A scout run searches, stores and scores; a
  learning run turns your marks into rules. Its tools are typed: the model
  can only submit a score for a post the app holds, and never sees a query,
  a cursor or a key.
- **Credentials stay outside the agent.** The X token and the app token are
  OpenComputer secrets, attached at its outbound proxy. A post that tries to
  talk the model into leaking a key finds none to leak.
- **The app** (`src/`) is TanStack Start, built for Cloudflare Workers. The
  browser talks only to the app's routes; the agent reaches `/api/agent/*`
  with its token. Through the tunnel, only those routes answer.
- **The database** (`supabase/migrations/`) is Postgres. Every write is one
  function, so each is a single transaction. Locally it runs in PGlite
  (Postgres compiled to WebAssembly) under `dev/local/.pglite`, so you need
  no database account; delete that directory to start over. To use a hosted
  Supabase project, apply `supabase/migrations/` and set `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY` in `.env.local`.
- **In production** the agent also runs on a five-minute schedule, and the
  feed offers what it finds as "N new".

`AGENTS.md` maps the code in more detail.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The app and its local database. |
| `npm run tunnel` | ngrok from your domain to the app. |
| `npm run seed:brief -- <file>` | Loads a brief and its searches. |
| `npm run scout:once` | Starts a scout run from the terminal, like Refresh. |
| `npm run rejudge` | Clears the scores of posts you haven't handled, so the next run scores them again under your current brief. Model time only; X isn't searched again. |
| `npm run avatars` | Fills in profile pictures for posts stored before the app kept them ($0.01 per author). |
| `npm run dev:sample` | The app over sample data on http://localhost:3310. No agent or setup needed. |
| `npm run check` | Typecheck, lint, tests and build, as CI runs them. |
| `npx playwright test --config dev/playwright.config.ts` | Captures every screen into `dev/design/screens`. |

## Deploying

Running the app on Workers, behind Cloudflare Access, isn't documented yet.
Until then, run it locally.

## License

[MIT](LICENSE)
