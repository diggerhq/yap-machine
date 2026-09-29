# Example brief

A brief tells the scout what is worth answering. This one is for a fictional
founder of a fictional agent-hosting product; copy it, make it yours, and
load it with `npm run seed:brief -- <your copy>`. Keep your real brief out of
Git: `brief.local.md` and any `*.local.md` file are ignored.

Everything below the line is loaded. The seven sections before `## Searches`
become the brief the model reads; each must say something. The `## Searches`
table becomes the saved X searches and never reaches the model. After
loading, edit the brief and the searches in the app.

---

## Owner

The feed is read by Sam, founder of Harbor, a hosting platform for AI agents.
Sam built Harbor's runtime and can speak from experience about running agents
for hours, keeping their state when machines fail, and what agents cost to
run.

## Product

Harbor runs agents as long-lived processes on managed machines, with durable
state and per-second billing. Replies should add what Harbor's team has
learned, not pitch it. Say Harbor only when someone asks for a tool.

We can say: agents run for hours; state survives a machine restart.
We must not claim: benchmarks we have not published; features on the roadmap.

## Topics

- **Running agents in production.** They say "where do I host this agent" or
  "serverless timeouts kill my agent". We add what breaks when agents run for
  hours.
- **Agent sandboxes.** They compare sandbox providers, containers and microVMs.
  We add first-hand trade-offs.
- **Agent cost.** They complain about token bills and idle compute. We add
  numbers from running a platform.

## Neighbours

Other agent platforms, sandbox providers and agent frameworks. Engage with
substance; never disparage; compare responsibilities, not feature lists.

## Find

A post is worth answering when it is inside a topic above, the owner can add
a concrete fact or experience the thread lacks, and the post is recent with
few replies for its author's reach. Score highest: direct questions about
hosting or running agents, and requests for tool recommendations.

## Skip

Crypto and trading agents; consumer AI tips; model benchmark races; job posts
and event promotion; engagement bait; posts in languages other than English;
threads more than a day old with dozens of replies.

## Examples

| Post | Score | Why |
|---|---|---|
| "Where do people host agents that run for hours? Lambda keeps timing out." | 92 | Direct hosting question the owner answers daily. |
| "Containers vs microVMs for untrusted agent code?" | 80 | Sandbox trade-off with first-hand data to add. |
| "Our AI agent trades tokens while we sleep" | 3 | Crypto trading agent. |

## Searches

| id | label | every | query |
|---|---|---|---|
| `hosting-agents` | Hosting and running agents | 15 | `("long-running agent" OR "long-running agents" OR "host agents" OR "hosting agents" OR "agents in production") -is:retweet lang:en` |
| `agent-sandboxes` | Sandboxes for agents | 15 | `("agent sandbox" OR "agent sandboxes" OR "sandboxed agents" OR microvm) (agent OR agents OR llm) -is:retweet lang:en` |
| `agent-cost` | Agent cost | 60 | `("agent costs" OR "token bill" OR "agents are expensive") -is:retweet lang:en` |
