-- Authored data for looking at every screen and card state. Nothing here is a
-- real post: the ids are snowflakes dated decades ahead, so X's embed finds
-- nothing and every card shows its stored fallback, and every handle and
-- text is invented. Times are relative to now(), so the feed always looks
-- live. The sample searches are disabled; the real brief and searches come
-- from `npm run seed:brief`.

insert into brief_versions (owner_body, learned, status, created_by, created_at) values
  ('## Owner

A founder of an agent platform, answering questions about running agents in production.

## Topics

- Running agents for hours.
- Sandboxes for agents.', '[]', 'superseded', 'owner', now() - interval '3 days');

insert into brief_versions (owner_body, learned, status, created_by, based_on, created_at) values
  ('## Owner

A founder of an agent platform, answering questions about running agents in production.

## Topics

- Running agents for hours.
- Sandboxes for agents.', '[]', 'active', 'learning', 1, now() - interval '2 hours');

insert into searches (id, label, query, every_minutes, enabled, last_run_at) values
  ('sample-mentions', 'Mentions (sample)', '(sampleproduct OR "sample product") -is:retweet', 5, false, now() - interval '4 minutes'),
  ('sample-hosting', 'Hosting agents (sample)', '("long-running agent" OR "background agents") -is:retweet lang:en', 15, false, now() - interval '12 minutes'),
  ('sample-platforms', 'Agent platforms (sample)', '("agent runtime" OR "agent platform") -is:retweet lang:en', 60, false, null);

insert into posts (id, search_id, author_id, author_handle, author_name, author_followers, text, created_at, conversation_id, context, metrics, fetched_at, opened_at) values
  ('9000000000000000001', 'sample-hosting', '8001', 'builder_ana', 'Ana Builder', 12400,
   'Anyone running Claude Code headless on a schedule? Our cron box keeps OOMing and we lose all state when it dies.',
   now() - interval '25 minutes', '9000000000000000001', null,
   '{"like": 14, "reply": 2, "repost": 1, "quote": 0, "impression": 2100}', now() - interval '20 minutes', null),
  ('9000000000000000002', 'sample-hosting', '8002', 'ops_ben', 'Ben Ops', 830,
   '@infra_cy We moved ours to microVMs after containers kept leaking state between runs. Cold starts are the price.',
   now() - interval '50 minutes', '9000000000000000090',
   '{"kind": "replied_to", "id": "9000000000000000090", "authorHandle": "infra_cy", "text": "What are people using for sandboxes that run agents for hours?"}',
   '{"like": 2, "reply": 0, "repost": 0, "quote": 0, "impression": 180}', now() - interval '45 minutes', null),
  ('9000000000000000003', 'sample-mentions', '8003', 'infra_cy', 'Cy Infra', 45000,
   'Has anyone tried running a Mastra agent somewhere that keeps it alive for hours? Serverless keeps killing ours at 15 minutes.',
   now() - interval '2 hours', '9000000000000000003', null,
   '{"like": 60, "reply": 11, "repost": 4, "quote": 1, "impression": 9000}', now() - interval '110 minutes', null),
  ('9000000000000000004', 'sample-hosting', '8004', 'dee_dev', 'Dee', 2300,
   'Long thoughts on durable execution for agent loops. The loop is easy; resuming it after the machine dies is the whole problem. We tried a workflow engine around our own loop, then a platform that owns the loop, and the difference is where the state lives when a turn is interrupted halfway through a tool call. Thread below on what broke and what we would do again.',
   now() - interval '5 hours', '9000000000000000004', null,
   '{"like": 31, "reply": 4, "repost": 3, "quote": 0, "impression": 4100}', now() - interval '290 minutes', null),
  ('9000000000000000005', 'sample-platforms', '8005', 'eve_q', 'Eve', 150000,
   'Prompt injection is unsolvable, so never give agents API keys. Change my mind.',
   now() - interval '20 hours', '9000000000000000005', null,
   '{"like": 420, "reply": 96, "repost": 40, "quote": 12, "impression": 88000}', now() - interval '19 hours', null),
  ('9000000000000000006', 'sample-hosting', '8006', 'fin_sandbox', 'Fin', 640,
   'How we sandbox untrusted Python in our data platform (Docker + gVisor).',
   now() - interval '3 hours', '9000000000000000006', null,
   '{"like": 5, "reply": 1, "repost": 0, "quote": 0, "impression": 700}', now() - interval '170 minutes', null),
  ('9000000000000000007', 'sample-platforms', '8007', 'gus_ai', 'Gus', 5200,
   'GPT-7 vs Claude benchmarks just dropped, thread below',
   now() - interval '1 hour', '9000000000000000007', null,
   '{"like": 80, "reply": 30, "repost": 12, "quote": 3, "impression": 20000}', now() - interval '55 minutes', null),
  ('9000000000000000008', 'sample-mentions', '8008', 'hana_builds', 'Hana', 3100,
   'E2B vs Daytona vs a VM platform for an agent that needs a sandbox for hours: what are people using?',
   now() - interval '6 hours', '9000000000000000008', null,
   '{"like": 22, "reply": 7, "repost": 1, "quote": 0, "impression": 3000}', now() - interval '350 minutes', now() - interval '30 minutes'),
  ('9000000000000000009', 'sample-platforms', '8009', 'ivan_trades', 'Ivan', 9100,
   'Our AI agent runs 24/7 and trades tokens while we sleep. Autonomous agents are the future of finance.',
   now() - interval '4 hours', '9000000000000000009', null,
   '{"like": 40, "reply": 9, "repost": 6, "quote": 1, "impression": 7000}', now() - interval '230 minutes', null),
  ('9000000000000000010', 'sample-hosting', '8010', 'jo_ci', 'Jo', 1400,
   'Running coding agents in CI overnight: the agents are fine, the hard part is where their state goes when the runner is recycled.',
   now() - interval '9 hours', '9000000000000000010', null,
   '{"like": 12, "reply": 3, "repost": 0, "quote": 0, "impression": 1600}', now() - interval '8 hours', null),
  ('9000000000000000011', 'sample-mentions', '8011', 'kai_old', 'Kai', 700,
   null,
   now() - interval '3 days', '9000000000000000011', null,
   '{"like": 3, "reply": 0, "repost": 0, "quote": 0, "impression": 300}', now() - interval '3 days', now() - interval '2 days');

insert into judgments (post_id, kind, score, reason, brief_version_id, session_id, model, judged_at) values
  ('9000000000000000001', 'scout', 91, 'Coding agents unattended; the owner runs exactly this.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '19 minutes'),
  ('9000000000000000002', 'scout', 72, 'MicroVM versus container trade-off in a sandbox thread; first-hand data to add.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '44 minutes'),
  ('9000000000000000003', 'scout', 88, 'Direct ask for a place to run long agents; recommendation welcome.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '109 minutes'),
  ('9000000000000000004', 'scout', 70, 'Durable execution for agent loops; owner holds a concrete counterpoint.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '289 minutes'),
  ('9000000000000000004', 'rescore', 78, 'Learned: interrupted-turn recovery is a topic the owner answers.', 2, 'seed-learning', 'anthropic/claude-sonnet-5.5', now() - interval '2 hours'),
  ('9000000000000000005', 'scout', 64, 'Key custody at a proxy is an honest counterpoint; window closing.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '19 hours'),
  ('9000000000000000006', 'scout', 45, 'Adjacent sandboxing, not agent-specific; small reach.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '169 minutes'),
  ('9000000000000000007', 'scout', 8, 'Model benchmark horse race; nothing to add.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '54 minutes'),
  ('9000000000000000008', 'scout', 85, 'Direct category question; first-hand VM sandbox trade-offs.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '349 minutes'),
  ('9000000000000000009', 'scout', 66, 'Agents running unattended for days.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '229 minutes'),
  ('9000000000000000010', 'scout', 52, 'Coding agents in CI; state on recycled runners.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '479 minutes'),
  ('9000000000000000011', 'scout', 74, 'Hosting agents; answered already.', 1, 'seed-scout', 'anthropic/claude-sonnet-5.5', now() - interval '3 days');

insert into feedback (post_id, verdict, note, created_at, consolidated_in) values
  ('9000000000000000009', 'not_relevant', 'Trading bots are not our agents, even when they run 24/7.', now() - interval '3 minutes', null),
  ('9000000000000000010', 'relevant', 'CI coding agents are exactly our users.', now() - interval '150 minutes', 2);

update brief_versions set learned = jsonb_build_array(jsonb_build_object(
  'id', 'r-seed-1',
  'text', 'Coding agents run in CI or overnight are relevant, even when the post never says sandbox.',
  'feedbackIds', jsonb_build_array((select id from feedback where post_id = '9000000000000000010'))))
where id = 2;

insert into learning_runs (session_id, offered_ids, started_at, finished_at, report, session_ended_at) values
  ('seed-learning', array[(select id from feedback where post_id = '9000000000000000010')],
   now() - interval '130 minutes', now() - interval '2 hours',
   '{"role": "learning", "rulesBefore": 0, "rulesAfter": 1, "consolidated": 1, "rescored": 1, "notes": ""}',
   now() - interval '115 minutes');

-- Set aside with Done: in Handled, with no verdict.
update posts set dismissed_at = now() - interval '10 minutes' where id = '9000000000000000006';

insert into usage_daily (day, spend_usd, post_reads, user_reads) values
  ((now() at time zone 'UTC')::date, 3.415, 431, 126);
