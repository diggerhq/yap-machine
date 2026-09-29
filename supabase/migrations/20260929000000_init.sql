-- The yap machine's whole database: tables, grants, views and every function
-- the Worker calls. Every multi-step write is one function, called with
-- supabase-js `.rpc()` (which has no transactions), and so is every read that
-- joins; each returns jsonb, and a refusal is `{ "error": "<code>", ... }`
-- rather than an exception, so the route maps it to a status. Functions that
-- depend on the clock take `p_now` so the tests can fix it.

-- ─── Tables ────────────────────────────────────────────────────────────────

create table brief_versions (
  id bigint generated always as identity primary key,
  owner_body text not null,                 -- the owner's sections (Markdown, fixed headings)
  learned jsonb not null default '[]',      -- [{ id, text, feedbackIds: [] }]
  status text not null check (status in ('active','superseded')),
  created_by text not null check (created_by in ('owner','learning')),
  based_on bigint references brief_versions(id),
  created_at timestamptz not null default now()
);
create unique index brief_one_active on brief_versions (status) where status = 'active';

create table searches (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  label text not null check (length(label) between 1 and 120),
  query text not null check (length(query) between 1 and 512),
  every_minutes integer not null check (every_minutes between 5 and 1440 and every_minutes % 5 = 0),
  enabled boolean not null default true,
  since_id text,
  last_run_at timestamptz
);

create table scout_runs (
  session_id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb
);

create table search_runs (
  id bigint generated always as identity primary key,
  search_id text not null references searches(id) on delete cascade,
  session_id text not null,
  fetched integer not null,
  stored integer not null,
  post_reads integer not null,
  user_reads integer not null,
  at timestamptz not null default now()
);
create index search_runs_at on search_runs (search_id, at);

create table posts (
  id text primary key,                      -- X post id
  search_id text not null references searches(id),
  author_id text not null,
  author_handle text not null,
  author_name text not null,
  author_followers integer not null,
  text text,                                -- cleared 48 h after created_at
  created_at timestamptz not null,
  conversation_id text,
  context jsonb,                            -- replied-to or quoted post: {kind, id, authorHandle, text}
  metrics jsonb not null,                   -- {like, reply, repost, quote, impression} at fetch
  fetched_at timestamptz not null default now(),
  leased_until timestamptz,
  leased_session text,
  opened_at timestamptz
);
create index posts_fetched on posts (fetched_at, id);
create index posts_created on posts (created_at);

create table judgments (
  id bigint generated always as identity primary key,
  post_id text not null references posts(id) on delete cascade,
  kind text not null check (kind in ('scout','rescore')),
  score integer not null check (score between 0 and 100),
  reason text not null check (length(reason) between 1 and 120),
  brief_version_id bigint not null references brief_versions(id),
  session_id text not null,
  model text not null,
  judged_at timestamptz not null default now()
);
create unique index judgments_one_scout on judgments (post_id) where kind = 'scout';
create unique index judgments_one_rescore_per_version on judgments (post_id, brief_version_id) where kind = 'rescore';
create index judgments_post on judgments (post_id, judged_at desc, id desc);

create view current_judgments with (security_invoker = true) as
  select distinct on (post_id) * from judgments order by post_id, judged_at desc, id desc;

create table feedback (
  id bigint generated always as identity primary key,
  post_id text not null unique references posts(id) on delete cascade,
  verdict text not null check (verdict in ('not_relevant','relevant')),
  note text check (length(note) <= 280),
  created_at timestamptz not null default now(),
  consolidated_in bigint references brief_versions(id)   -- null until a learning run folds it in
);

create table learning_runs (
  id bigint generated always as identity primary key,
  session_id text unique,
  offered_ids bigint[] not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  abandoned boolean not null default false,
  report jsonb,
  -- GAP(G14): ending a session cancels its running turn, so a learning run
  -- cannot be ended from its own report call; the app ends it later and
  -- records that here.
  session_ended_at timestamptz
);
create unique index learning_one_open on learning_runs ((true)) where finished_at is null and not abandoned;

create table usage_daily (
  day date primary key,
  spend_usd numeric(10,3) not null default 0,
  post_reads integer not null default 0,
  user_reads integer not null default 0
);

-- ─── Helpers ───────────────────────────────────────────────────────────────

create function utc_day(p_at timestamptz) returns date
language sql immutable as $$ select (p_at at time zone 'UTC')::date $$;

-- rank = score × 0.5 ^ (age_hours / 6): a post loses half its standing every
-- six hours, because a reply only earns reach while the thread is young.
create function post_rank(p_score integer, p_created_at timestamptz, p_now timestamptz) returns double precision
language sql immutable as $$
  select p_score * power(0.5, greatest(0, extract(epoch from (p_now - p_created_at)) / 3600.0) / 6.0)
$$;

create function active_brief() returns brief_versions
language sql stable as $$ select * from brief_versions where status = 'active' $$;

-- The compact form a post travels to the model in: enough to judge, bounded.
create function post_for_model(p posts, p_now timestamptz) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id,
    'author', p.author_handle,
    'followers', p.author_followers,
    'ageMinutes', greatest(0, floor(extract(epoch from (p_now - p.created_at)) / 60))::integer,
    'replies', coalesce((p.metrics->>'reply')::integer, 0),
    'likes', coalesce((p.metrics->>'like')::integer, 0),
    'text', left(p.text, 600),
    'context', case when p.context is null then null else jsonb_build_object(
      'kind', p.context->>'kind',
      'author', p.context->>'authorHandle',
      'text', left(p.context->>'text', 300)) end
  )
$$;

create function brief_json(b brief_versions) returns jsonb
language sql stable as $$
  select case when b.id is null then null else jsonb_build_object(
    'versionId', b.id, 'ownerBody', b.owner_body, 'learned', b.learned,
    'createdBy', b.created_by, 'createdAt', b.created_at, 'basedOn', b.based_on) end
$$;

-- The owner's feedback as a model reads it: verdict, note, the post's author and text.
create function feedback_for_model(f feedback, p posts, p_text_limit integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', f.id, 'verdict', f.verdict, 'note', f.note,
    'author', p.author_handle, 'text', left(p.text, p_text_limit),
    'context', case when p.context is null then null else jsonb_build_object(
      'kind', p.context->>'kind', 'author', p.context->>'authorHandle', 'text', left(p.context->>'text', 300)) end)
$$;

-- ─── Scout runs ────────────────────────────────────────────────────────────

-- GET /api/agent/work: records the scout run (idempotent) and returns what it
-- works on: the brief, the owner's unconsolidated feedback (newest 20), the
-- searches that are due, and today's spend.
create function begin_scout_run(p_session_id text, p_cap_usd numeric, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  b brief_versions;
begin
  insert into scout_runs (session_id, started_at) values (p_session_id, p_now) on conflict do nothing;
  b := active_brief();
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  return jsonb_build_object(
    'brief', brief_json(b),
    'feedback', coalesce((
      select jsonb_agg(item order by created_at desc) from (
        select feedback_for_model(f, p, 280) as item, f.created_at
        from feedback f join posts p on p.id = f.post_id
        where f.consolidated_in is null
        order by f.created_at desc limit 20) t), '[]'),
    'searches', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label) order by s.id)
      from searches s
      where s.enabled and (s.last_run_at is null or s.last_run_at <= p_now - make_interval(mins => s.every_minutes - 1))), '[]'),
    'spend', jsonb_build_object(
      'todayUsd', coalesce((select spend_usd from usage_daily where day = utc_day(p_now)), 0),
      'capUsd', p_cap_usd),
    'unconsolidated', (select count(*) from feedback where consolidated_in is null)
  );
end $$;

-- POST /api/agent/searches/:id/claim: the only way to learn a search's query.
-- Refuses without a brief, at the budget cap, or when the search is not due;
-- otherwise stamps last_run_at and hands back the query and the cursor. The
-- cursor is dropped when the last run is more than 6 days old, because X
-- rejects a since_id older than its 7-day window.
create function claim_search(p_search_id text, p_cap_usd numeric, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  s searches;
begin
  if (active_brief()).id is null then return jsonb_build_object('error', 'no_brief'); end if;
  if coalesce((select spend_usd from usage_daily where day = utc_day(p_now)), 0) >= p_cap_usd then
    return jsonb_build_object('error', 'budget_exhausted');
  end if;
  select * into s from searches where id = p_search_id for update;
  if s.id is null then return jsonb_build_object('error', 'unknown_search'); end if;
  if not s.enabled or (s.last_run_at is not null and s.last_run_at > p_now - make_interval(mins => s.every_minutes - 1)) then
    return jsonb_build_object('error', 'not_due');
  end if;
  update searches set last_run_at = p_now where id = s.id;
  return jsonb_build_object(
    'query', s.query,
    'sinceId', case when s.last_run_at is null or s.last_run_at < p_now - interval '6 days' then null else s.since_id end);
end $$;

-- POST /api/agent/candidates: stores what one search fetched. New posts are
-- inserted with the search that first saw them; known posts only refresh
-- their metrics. The cursor advances when the new id is greater (compared as
-- numbers: X ids are 64-bit). Every object X returned is counted against
-- today's spend. Retention runs here, since every scout run with work comes
-- through: text is cleared 48 h after a post was created, rows go after 7 days.
create function record_candidates(
  p_search_id text, p_session_id text, p_newest_id text, p_posts jsonb,
  p_post_reads integer, p_user_reads integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_fetched integer := jsonb_array_length(p_posts);
  v_stored integer;
begin
  perform 1 from searches where id = p_search_id for update;
  if not found then return jsonb_build_object('error', 'unknown_search'); end if;

  with incoming as (
    select * from jsonb_to_recordset(p_posts) as x(
      id text, "authorId" text, "authorHandle" text, "authorName" text, "authorFollowers" integer,
      text text, "createdAt" timestamptz, "conversationId" text, context jsonb, metrics jsonb)
  ), inserted as (
    insert into posts (id, search_id, author_id, author_handle, author_name, author_followers, text,
                       created_at, conversation_id, context, metrics, fetched_at)
    select i.id, p_search_id, i."authorId", i."authorHandle", i."authorName", i."authorFollowers",
           case when i."createdAt" > p_now - interval '48 hours' then i.text end,
           i."createdAt", i."conversationId",
           case when i."createdAt" > p_now - interval '48 hours' then i.context end,
           i.metrics, p_now
    from incoming i
    on conflict (id) do update set metrics = excluded.metrics, author_followers = excluded.author_followers
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new) into v_stored from inserted;

  if p_newest_id is not null then
    update searches set since_id = p_newest_id
    where id = p_search_id and (since_id is null or p_newest_id::numeric > since_id::numeric);
  end if;

  insert into usage_daily (day, spend_usd, post_reads, user_reads)
  values (utc_day(p_now), p_post_reads * 0.005 + p_user_reads * 0.010, p_post_reads, p_user_reads)
  on conflict (day) do update set
    spend_usd = usage_daily.spend_usd + excluded.spend_usd,
    post_reads = usage_daily.post_reads + excluded.post_reads,
    user_reads = usage_daily.user_reads + excluded.user_reads;

  insert into search_runs (search_id, session_id, fetched, stored, post_reads, user_reads, at)
  values (p_search_id, p_session_id, v_fetched, v_stored, p_post_reads, p_user_reads, p_now);

  update posts set text = null, context = null where text is not null and created_at <= p_now - interval '48 hours';
  delete from posts where fetched_at <= p_now - interval '7 days';

  return jsonb_build_object('fetched', v_fetched, 'stored', v_stored, 'alreadyKnown', v_fetched - v_stored);
end $$;

-- POST /api/agent/queue/lease: up to p_limit unjudged posts for this session,
-- oldest fetch first, each leased for 10 minutes. A post leased to the same
-- session comes back (the route trims a batch to its byte bound, and the
-- trimmed posts return on the next call); an expired lease from a crashed run
-- is taken over. Posts older than the 48-hour feed window are never judged.
create function lease_posts(p_session_id text, p_limit integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_posts jsonb;
  v_waiting integer;
begin
  with picked as (
    select p.id from posts p
    where p.text is not null
      and p.created_at > p_now - interval '48 hours'
      and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'scout')
      and (p.leased_until is null or p.leased_until <= p_now or p.leased_session = p_session_id)
    order by p.fetched_at, p.id
    limit greatest(0, least(p_limit, 25))
    for update of p skip locked
  ), leased as (
    update posts p set leased_until = p_now + interval '10 minutes', leased_session = p_session_id
    from picked where p.id = picked.id
    returning p.*
  )
  select coalesce(jsonb_agg(post_for_model(l::posts, p_now) order by l.fetched_at, l.id), '[]') into v_posts from leased l;

  select count(*) into v_waiting from posts p
  where p.text is not null
    and p.created_at > p_now - interval '48 hours'
    and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'scout')
    and (p.leased_until is null or p.leased_until <= p_now);

  return jsonb_build_object('posts', v_posts, 'waiting', v_waiting);
end $$;

-- Validates one submitted judgment; null when it is well formed.
create function judgment_problem(j jsonb) returns text
language sql immutable as $$
  select case
    when jsonb_typeof(j->'postId') is distinct from 'string' then 'invalid_judgment'
    -- One condition per WHEN: CASE tests them in order, so no cast runs on a non-number.
    when jsonb_typeof(j->'score') is distinct from 'number' then 'invalid_score'
    when (j->>'score')::numeric <> floor((j->>'score')::numeric) then 'invalid_score'
    when (j->>'score')::numeric < 0 or (j->>'score')::numeric > 100 then 'invalid_score'
    when jsonb_typeof(j->'reason') is distinct from 'string' then 'invalid_reason'
    when length(j->>'reason') < 1 or length(j->>'reason') > 120 then 'invalid_reason'
  end
$$;

-- POST /api/agent/judgments: a scout run's scores. Each post is judged once
-- by a scout run; the judgment records the active brief version, the session
-- and the model, and releases the post's lease.
create function record_judgments(p_session_id text, p_model text, p_judgments jsonb, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  b brief_versions := active_brief();
  j jsonb;
  v_problem text;
  v_accepted integer := 0;
  v_rejected jsonb := '[]';
begin
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  for j in select * from jsonb_array_elements(p_judgments) loop
    v_problem := judgment_problem(j);
    if v_problem is null and not exists (select 1 from posts where id = j->>'postId') then
      v_problem := 'unknown_post';
    end if;
    if v_problem is null and exists (select 1 from judgments where post_id = j->>'postId' and kind = 'scout') then
      v_problem := 'already_judged';
    end if;
    if v_problem is not null then
      v_rejected := v_rejected || jsonb_build_object('postId', j->'postId', 'error', v_problem);
      continue;
    end if;
    insert into judgments (post_id, kind, score, reason, brief_version_id, session_id, model, judged_at)
    values (j->>'postId', 'scout', (j->>'score')::integer, j->>'reason', b.id, p_session_id, p_model, p_now);
    update posts set leased_until = null, leased_session = null where id = j->>'postId';
    v_accepted := v_accepted + 1;
  end loop;
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end $$;

-- POST /api/agent/report: closes a scout run or a learning run, once. A
-- learning report says whether newer feedback is waiting, so the Worker
-- starts the next learning run.
create function record_report(p_session_id text, p_report jsonb, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_run learning_runs;
begin
  if p_report->>'role' = 'scout' then
    insert into scout_runs (session_id, started_at) values (p_session_id, p_now) on conflict do nothing;
    update scout_runs set finished_at = p_now, report = p_report
    where session_id = p_session_id and finished_at is null;
    return jsonb_build_object('role', 'scout', 'closed', found);
  elsif p_report->>'role' = 'learning' then
    select * into v_run from learning_runs where session_id = p_session_id;
    if v_run.id is null then return jsonb_build_object('error', 'not_learning_session'); end if;
    if v_run.finished_at is not null or v_run.abandoned then
      return jsonb_build_object('role', 'learning', 'closed', false, 'startNext', false);
    end if;
    update learning_runs set finished_at = p_now, report = p_report where id = v_run.id;
    return jsonb_build_object('role', 'learning', 'closed', true,
      'startNext', exists (select 1 from feedback where consolidated_in is null));
  end if;
  return jsonb_build_object('error', 'invalid_report');
end $$;

-- ─── Feedback and the brief ────────────────────────────────────────────────

-- PUT /api/posts/:id/feedback: the owner's verdict. Replaces unconsolidated
-- feedback on the post with a new row (a new id, so a learning run that was
-- offered the old one does not treat the new one as covered).
create function put_feedback(p_post_id text, p_verdict text, p_note text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from posts where id = p_post_id) then return jsonb_build_object('error', 'unknown_post'); end if;
  if p_verdict not in ('not_relevant', 'relevant') then return jsonb_build_object('error', 'invalid_verdict'); end if;
  if p_note is not null and length(p_note) > 280 then return jsonb_build_object('error', 'invalid_note'); end if;
  if exists (select 1 from feedback where post_id = p_post_id and consolidated_in is not null) then
    return jsonb_build_object('error', 'consolidated');
  end if;
  delete from feedback where post_id = p_post_id;
  insert into feedback (post_id, verdict, note, created_at)
  values (p_post_id, p_verdict, nullif(btrim(p_note), ''), p_now) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- DELETE /api/posts/:id/feedback: withdraws feedback no learning run has folded in.
create function withdraw_feedback(p_post_id text)
returns jsonb language plpgsql as $$
declare
  f feedback;
begin
  select * into f from feedback where post_id = p_post_id;
  if f.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if f.consolidated_in is not null then return jsonb_build_object('error', 'consolidated'); end if;
  delete from feedback where id = f.id;
  return jsonb_build_object('withdrawn', f.id);
end $$;

-- POST /api/posts/:id/open: the owner opened the post on X.
create function mark_opened(p_post_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
begin
  update posts set opened_at = coalesce(opened_at, p_now) where id = p_post_id;
  if not found then return jsonb_build_object('error', 'unknown_post'); end if;
  return jsonb_build_object('opened', p_post_id);
end $$;

-- Validates a learned-rules list: [{ id, text, feedbackIds }].
create function learned_problem(p_learned jsonb) returns text
language sql immutable as $$
  select case
    when jsonb_typeof(p_learned) is distinct from 'array' then 'invalid_rules'
    when exists (
      select 1 from jsonb_array_elements(p_learned) r
      where jsonb_typeof(r->'id') is distinct from 'string' or jsonb_typeof(r->'text') is distinct from 'string'
        or length(r->>'text') < 1 or length(r->>'text') > 200 or jsonb_typeof(r->'feedbackIds') is distinct from 'array') then 'invalid_rules'
  end
$$;

-- Makes a new active version and supersedes the old one, atomically. With
-- p_learned null the new version keeps the active version's learned rules
-- (the owner edits only their own sections).
create function create_brief_version(p_owner_body text, p_learned jsonb, p_created_by text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  b brief_versions := active_brief();
  v_learned jsonb := coalesce(p_learned, b.learned, '[]');
  v_id bigint;
begin
  if p_owner_body is null or length(btrim(p_owner_body)) = 0 then return jsonb_build_object('error', 'invalid_brief'); end if;
  if learned_problem(v_learned) is not null then return jsonb_build_object('error', learned_problem(v_learned)); end if;
  update brief_versions set status = 'superseded' where status = 'active';
  insert into brief_versions (owner_body, learned, status, created_by, based_on, created_at)
  values (p_owner_body, v_learned, 'active', p_created_by, b.id, p_now) returning id into v_id;
  return jsonb_build_object('versionId', v_id);
end $$;

-- DELETE /api/brief/rules/:ruleId: a new version without the rule. The
-- rule's feedback stays consolidated, so the rule returns only when new
-- feedback supports it.
create function delete_learned_rule(p_rule_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  b brief_versions := active_brief();
begin
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  if not exists (select 1 from jsonb_array_elements(b.learned) r where r->>'id' = p_rule_id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  return create_brief_version(b.owner_body,
    coalesce((select jsonb_agg(r order by ord) from jsonb_array_elements(b.learned) with ordinality as x(r, ord)
              where r->>'id' <> p_rule_id), '[]'),
    'owner', p_now);
end $$;

-- POST /api/brief/versions/:id/restore: a new version copying an old one.
create function restore_brief_version(p_version_id bigint, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  old brief_versions;
  v_result jsonb;
begin
  select * into old from brief_versions where id = p_version_id;
  if old.id is null then return jsonb_build_object('error', 'not_found'); end if;
  v_result := create_brief_version(old.owner_body, old.learned, 'owner', p_now);
  update brief_versions set based_on = old.id where id = (v_result->>'versionId')::bigint;
  return v_result;
end $$;

-- ─── Learning runs ─────────────────────────────────────────────────────────

-- Starts a learning run when unconsolidated feedback exists and none is open.
-- An open run older than 15 minutes is abandoned first (its session died or
-- never started). Returns the new run's id, or null.
create function begin_learning_run(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_id bigint;
begin
  update learning_runs set abandoned = true
  where finished_at is null and not abandoned and started_at <= p_now - interval '15 minutes';
  if not exists (select 1 from feedback where consolidated_in is null) then
    return jsonb_build_object('id', null);
  end if;
  insert into learning_runs (started_at) values (p_now)
  on conflict ((true)) where finished_at is null and not abandoned do nothing
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create function attach_learning_session(p_run_id bigint, p_session_id text)
returns jsonb language plpgsql as $$
begin
  update learning_runs set session_id = p_session_id where id = p_run_id and session_id is null;
  return jsonb_build_object('attached', found);
end $$;

create function abandon_learning_run(p_run_id bigint)
returns jsonb language plpgsql as $$
begin
  update learning_runs set abandoned = true where id = p_run_id and finished_at is null;
  return jsonb_build_object('abandoned', found);
end $$;

-- GAP(G14): the sessions of closed learning runs, still to be ended.
create function learning_sessions_to_end()
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(session_id), '[]') from learning_runs
  where session_id is not null and session_ended_at is null and (finished_at is not null or abandoned)
$$;

create function mark_learning_session_ended(p_session_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
begin
  update learning_runs set session_ended_at = p_now where session_id = p_session_id and session_ended_at is null;
  return jsonb_build_object('ended', found);
end $$;

-- The open learning run, when this session is the one running it.
create function learning_run_for(p_session_id text) returns learning_runs
language sql stable as $$
  select * from learning_runs where session_id = p_session_id and finished_at is null and not abandoned
$$;

-- GET /api/agent/learning: the active brief and the oldest 40 unconsolidated
-- feedback items; their ids are recorded as offered to this run.
create function offer_feedback(p_session_id text)
returns jsonb language plpgsql as $$
declare
  v_run learning_runs := learning_run_for(p_session_id);
  b brief_versions := active_brief();
  v_items jsonb;
  v_ids bigint[];
begin
  if v_run.id is null then return jsonb_build_object('error', 'not_learning_session'); end if;
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  select coalesce(jsonb_agg(item order by created_at, id), '[]'), coalesce(array_agg(id), '{}') into v_items, v_ids from (
    select feedback_for_model(f, p, 600) as item, f.created_at, f.id
    from feedback f join posts p on p.id = f.post_id
    where f.consolidated_in is null
    order by f.created_at, f.id limit 40) t;
  update learning_runs set offered_ids = (select array(select distinct unnest(offered_ids || v_ids))) where id = v_run.id;
  return jsonb_build_object('brief', brief_json(b), 'feedback', v_items);
end $$;

-- POST /api/agent/learning/rules: the complete new Learned list. Every
-- offered item still waiting must be covered by a rule or listed as
-- considered; a rule may cite only offered items or items its predecessors
-- cited. If the learned rules moved since the base version, the run must
-- read again (stale_learned). Covered items are marked consolidated.
create function save_learned(p_session_id text, p_base_version_id bigint, p_rules jsonb, p_considered jsonb, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_run learning_runs := learning_run_for(p_session_id);
  b brief_versions := active_brief();
  base brief_versions;
  v_allowed bigint[];
  v_cited bigint[];
  v_considered bigint[];
  v_uncovered bigint[];
  v_learned jsonb;
  v_result jsonb;
begin
  if v_run.id is null then return jsonb_build_object('error', 'not_learning_session'); end if;
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  select * into base from brief_versions where id = p_base_version_id;
  if base.id is null then return jsonb_build_object('error', 'unknown_version'); end if;
  if b.learned is distinct from base.learned then return jsonb_build_object('error', 'stale_learned'); end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 50 or exists (
    select 1 from jsonb_array_elements(p_rules) r
    where jsonb_typeof(r->'text') is distinct from 'string' or length(btrim(r->>'text')) < 1 or length(r->>'text') > 200
      or jsonb_typeof(r->'feedbackIds') is distinct from 'array') then
    return jsonb_build_object('error', 'invalid_rules');
  end if;

  select array(select distinct x::bigint from jsonb_array_elements(p_rules) r, jsonb_array_elements_text(r->'feedbackIds') x) into v_cited;
  select array(select distinct x::bigint from jsonb_array_elements_text(coalesce(p_considered, '[]')) x) into v_considered;
  select array(select distinct x::bigint from jsonb_array_elements(b.learned) r, jsonb_array_elements_text(r->'feedbackIds') x)
    || v_run.offered_ids into v_allowed;

  if exists (select 1 from unnest(v_cited) c where c <> all (v_allowed))
     or exists (select 1 from unnest(v_considered) c where c <> all (v_run.offered_ids)) then
    return jsonb_build_object('error', 'invalid_feedback_ids');
  end if;

  select array(
    select f.id from feedback f
    where f.id = any (v_run.offered_ids) and f.consolidated_in is null
      and f.id <> all (v_cited) and f.id <> all (v_considered)
    order by f.id) into v_uncovered;
  if cardinality(v_uncovered) > 0 then
    return jsonb_build_object('error', 'uncovered_feedback', 'feedbackIds', to_jsonb(v_uncovered));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', 'r-' || left(md5(random()::text || ord::text), 10),
      'text', btrim(r->>'text'),
      'feedbackIds', (select coalesce(jsonb_agg(distinct x::bigint), '[]') from jsonb_array_elements_text(r->'feedbackIds') x))
    order by ord), '[]')
  into v_learned from jsonb_array_elements(p_rules) with ordinality as t(r, ord);

  v_result := create_brief_version(b.owner_body, v_learned, 'learning', p_now);
  update feedback set consolidated_in = (v_result->>'versionId')::bigint
  where consolidated_in is null and id = any (v_run.offered_ids) and (id = any (v_cited) or id = any (v_considered));
  return jsonb_build_object('versionId', (v_result->>'versionId')::bigint, 'rules', jsonb_array_length(v_learned));
end $$;

-- The posts a learning run re-scores under version p_version: in the feed
-- window, with text and without feedback or an open, currently Open or
-- Filtered within 20 points of the threshold, and not yet re-scored under
-- this version.
create function rescore_set(p_version bigint, p_threshold integer, p_now timestamptz)
returns setof posts language sql stable as $$
  select p.* from posts p
  join current_judgments cj on cj.post_id = p.id
  where p.text is not null
    and p.created_at > p_now - interval '48 hours'
    and p.opened_at is null
    and not exists (select 1 from feedback f where f.post_id = p.id)
    and cj.score >= p_threshold - 20
    and cj.brief_version_id <> p_version
    and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'rescore' and j.brief_version_id = p_version)
$$;

-- POST /api/agent/learning/rescores/lease: up to p_limit posts to re-score,
-- highest current score first.
create function lease_rescores(p_session_id text, p_limit integer, p_threshold integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_run learning_runs := learning_run_for(p_session_id);
  b brief_versions := active_brief();
  v_posts jsonb;
  v_waiting integer;
begin
  if v_run.id is null then return jsonb_build_object('error', 'not_learning_session'); end if;
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  with picked as (
    select r.id from rescore_set(b.id, p_threshold, p_now) r
    join current_judgments cj on cj.post_id = r.id
    where r.leased_until is null or r.leased_until <= p_now or r.leased_session = p_session_id
    order by cj.score desc, r.id
    limit greatest(0, least(p_limit, 25))
  ), leased as (
    update posts p set leased_until = p_now + interval '10 minutes', leased_session = p_session_id
    from picked where p.id = picked.id
    returning p.*
  )
  select coalesce(jsonb_agg(post_for_model(l::posts, p_now) order by l.id), '[]') into v_posts from leased l;
  select count(*) into v_waiting from rescore_set(b.id, p_threshold, p_now) r
  where r.leased_until is null or r.leased_until <= p_now;
  return jsonb_build_object('versionId', b.id, 'posts', v_posts, 'waiting', v_waiting);
end $$;

-- POST /api/agent/learning/rescores: re-scores under the active version, only
-- for posts in its re-score set, once per version.
create function record_rescores(p_session_id text, p_model text, p_judgments jsonb, p_threshold integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_run learning_runs := learning_run_for(p_session_id);
  b brief_versions := active_brief();
  j jsonb;
  v_problem text;
  v_accepted integer := 0;
  v_rejected jsonb := '[]';
begin
  if v_run.id is null then return jsonb_build_object('error', 'not_learning_session'); end if;
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  for j in select * from jsonb_array_elements(p_judgments) loop
    v_problem := judgment_problem(j);
    if v_problem is null and exists (
      select 1 from judgments where post_id = j->>'postId' and kind = 'rescore' and brief_version_id = b.id) then
      v_problem := 'already_rescored';
    end if;
    if v_problem is null and not exists (select 1 from rescore_set(b.id, p_threshold, p_now) r where r.id = j->>'postId') then
      v_problem := 'not_in_rescore_set';
    end if;
    if v_problem is not null then
      v_rejected := v_rejected || jsonb_build_object('postId', j->'postId', 'error', v_problem);
      continue;
    end if;
    insert into judgments (post_id, kind, score, reason, brief_version_id, session_id, model, judged_at)
    values (j->>'postId', 'rescore', (j->>'score')::integer, j->>'reason', b.id, p_session_id, p_model, p_now);
    update posts set leased_until = null, leased_session = null where id = j->>'postId';
    v_accepted := v_accepted + 1;
  end loop;
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end $$;

-- ─── The owner's reads ─────────────────────────────────────────────────────

-- One feed card: the post, its current judgment and rank, and any feedback.
create function feed_item(p posts, cj current_judgments, f feedback, p_now timestamptz) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'authorHandle', p.author_handle, 'authorName', p.author_name,
    'authorFollowers', p.author_followers, 'text', p.text, 'createdAt', p.created_at,
    'context', p.context, 'metrics', p.metrics, 'openedAt', p.opened_at, 'searchId', p.search_id,
    'judgment', case when cj.id is null then null else jsonb_build_object(
      'score', cj.score, 'reason', cj.reason, 'kind', cj.kind, 'judgedAt', cj.judged_at,
      'briefVersionId', cj.brief_version_id) end,
    'rank', case when cj.id is null then null else post_rank(cj.score, p.created_at, p_now) end,
    'feedback', case when f.id is null then null else jsonb_build_object(
      'id', f.id, 'verdict', f.verdict, 'note', f.note, 'createdAt', f.created_at,
      'consolidated', f.consolidated_in is not null) end)
$$;

-- GET /api/feed: one page of Open (by rank), Filtered (by post time) or
-- Handled (by when it was handled). The cursor carries the clock of the first
-- page, so ranks stay comparable across pages.
create function feed_page(p_filter text, p_threshold integer, p_cursor jsonb, p_limit integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_now timestamptz := coalesce((p_cursor->>'at')::timestamptz, p_now);
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  if p_filter not in ('open', 'filtered', 'handled') then return jsonb_build_object('error', 'invalid_filter'); end if;
  with base as (
    select p, cj, f,
      post_rank(cj.score, p.created_at, v_now) as rank,
      greatest(p.opened_at, f.created_at) as handled_at
    from posts p
    join current_judgments cj on cj.post_id = p.id
    left join feedback f on f.post_id = p.id
  ), filtered as (
    select *,
      case p_filter
        when 'open' then rank
        when 'filtered' then extract(epoch from (b.p).created_at)
        else extract(epoch from b.handled_at) end as sort_key
    from base b
    where case p_filter
      when 'open' then (b.cj).score >= p_threshold and (b.p).created_at > v_now - interval '48 hours'
                       and (b.p).opened_at is null and (b.f).id is null
      when 'filtered' then (b.cj).score < p_threshold and (b.p).created_at > v_now - interval '48 hours'
                       and (b.p).opened_at is null and (b.f).id is null
      else (b.p).opened_at is not null or (b.f).id is not null end
  ), paged as (
    select * from filtered
    where p_cursor is null
       or sort_key < (p_cursor->>'key')::double precision
       or (sort_key = (p_cursor->>'key')::double precision and (p).id < p_cursor->>'id')
    order by sort_key desc, (p).id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(feed_item(p, cj, f, v_now) order by sort_key desc, (p).id desc), '[]'),
         count(*),
         (select jsonb_build_object('key', x.sort_key, 'id', (x.p).id, 'at', v_now)
          from paged x order by x.sort_key asc, (x.p).id asc limit 1)
  into v_rows, v_count, v_last
  from paged;
  return jsonb_build_object('items', v_rows, 'nextCursor', case when v_count = v_limit then v_last end, 'at', v_now);
end $$;

-- GET /api/feed/new-count: Open items whose current judgment is newer than p_since.
create function feed_new_count(p_since timestamptz, p_threshold integer, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object('count', count(*)) from posts p
  join current_judgments cj on cj.post_id = p.id
  where cj.judged_at > p_since and cj.score >= p_threshold
    and p.created_at > p_now - interval '48 hours' and p.opened_at is null
    and not exists (select 1 from feedback f where f.post_id = p.id)
$$;

-- GET /api/searches: each search with what it earned: fetched today, reached
-- Open today, and Not relevant marks in the last 7 days.
create function search_stats(p_threshold integer, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'label', s.label, 'query', s.query, 'everyMinutes', s.every_minutes, 'enabled', s.enabled,
    'lastRunAt', s.last_run_at,
    'fetchedToday', coalesce((select sum(r.fetched) from search_runs r
                              where r.search_id = s.id and utc_day(r.at) = utc_day(p_now)), 0),
    'openToday', (select count(*) from posts p join current_judgments cj on cj.post_id = p.id
                  where p.search_id = s.id and utc_day(p.fetched_at) = utc_day(p_now) and cj.score >= p_threshold),
    'notRelevant7d', (select count(*) from feedback f join posts p on p.id = f.post_id
                      where p.search_id = s.id and f.verdict = 'not_relevant' and f.created_at > p_now - interval '7 days')
  ) order by s.id), '[]') from searches s
$$;

create function create_search(p_id text, p_label text, p_query text, p_every_minutes integer, p_enabled boolean)
returns jsonb language plpgsql as $$
begin
  insert into searches (id, label, query, every_minutes, enabled) values (p_id, p_label, p_query, p_every_minutes, p_enabled);
  return jsonb_build_object('id', p_id);
exception
  when unique_violation then return jsonb_build_object('error', 'search_exists');
  when check_violation then return jsonb_build_object('error', 'invalid_search');
end $$;

-- PATCH /api/searches/:id: a changed query restarts its cursor, since the
-- old cursor belonged to a different set of posts.
create function update_search(p_id text, p_patch jsonb)
returns jsonb language plpgsql as $$
begin
  update searches set
    label = coalesce(p_patch->>'label', label),
    query = coalesce(p_patch->>'query', query),
    since_id = case when p_patch ? 'query' and p_patch->>'query' is distinct from query then null else since_id end,
    every_minutes = coalesce((p_patch->>'everyMinutes')::integer, every_minutes),
    enabled = coalesce((p_patch->>'enabled')::boolean, enabled)
  where id = p_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('id', p_id);
exception
  when check_violation then return jsonb_build_object('error', 'invalid_search');
end $$;

-- Seeding: the searches table of a brief, upserted and enabled.
create function upsert_searches(p_searches jsonb)
returns jsonb language plpgsql as $$
declare
  v_count integer;
begin
  insert into searches (id, label, query, every_minutes, enabled)
  select x.id, x.label, x.query, x."everyMinutes", true
  from jsonb_to_recordset(p_searches) as x(id text, label text, query text, "everyMinutes" integer)
  on conflict (id) do update set label = excluded.label, query = excluded.query,
    every_minutes = excluded.every_minutes, enabled = true,
    since_id = case when searches.query = excluded.query then searches.since_id end;
  get diagnostics v_count = row_count;
  return jsonb_build_object('upserted', v_count);
exception
  when check_violation then return jsonb_build_object('error', 'invalid_search');
end $$;

-- GET /api/brief: the active version with each learned rule's feedback (while
-- its posts are retained), the unconsolidated queue, and the version list.
create function brief_state()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'active', (select brief_json(b) || jsonb_build_object('learned', coalesce((
        select jsonb_agg(r || jsonb_build_object('feedback', coalesce((
            select jsonb_agg(jsonb_build_object('id', f.id, 'verdict', f.verdict, 'note', f.note,
                     'postId', p.id, 'authorHandle', p.author_handle, 'text', p.text) order by f.id)
            from feedback f join posts p on p.id = f.post_id
            where f.id in (select x::bigint from jsonb_array_elements_text(r->'feedbackIds') x)), '[]'))
          order by ord)
        from jsonb_array_elements(b.learned) with ordinality as t(r, ord)), '[]'))
      from brief_versions b where b.status = 'active'),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'verdict', f.verdict, 'note', f.note,
        'createdAt', f.created_at, 'postId', p.id, 'authorHandle', p.author_handle, 'text', p.text) order by f.created_at desc)
      from feedback f join posts p on p.id = f.post_id where f.consolidated_in is null), '[]'),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'createdBy', v.created_by,
        'createdAt', v.created_at, 'basedOn', v.based_on, 'rules', jsonb_array_length(v.learned)) order by v.id desc)
      from (select * from brief_versions order by id desc limit 50) v), '[]'))
$$;

-- GET /api/brief/versions/:id: one version in full, for the history's diff.
create function brief_version(p_version_id bigint)
returns jsonb language sql stable as $$
  select coalesce((select brief_json(b) || jsonb_build_object('status', b.status)
                   from brief_versions b where b.id = p_version_id),
                  jsonb_build_object('error', 'not_found'))
$$;

-- GET /api/status: the header's facts.
create function app_status(p_cap_usd numeric, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spend', coalesce((select jsonb_build_object('todayUsd', u.spend_usd, 'postReads', u.post_reads, 'userReads', u.user_reads)
                       from usage_daily u where u.day = utc_day(p_now)),
                      jsonb_build_object('todayUsd', 0, 'postReads', 0, 'userReads', 0)) || jsonb_build_object('capUsd', p_cap_usd),
    'learning', (select jsonb_build_object('id', r.id, 'startedAt', r.started_at) from learning_runs r
                 where r.finished_at is null and not r.abandoned and r.started_at > p_now - interval '15 minutes'),
    'lastLearning', (select jsonb_build_object('id', r.id, 'finishedAt', r.finished_at) from learning_runs r
                     where r.finished_at is not null order by r.finished_at desc limit 1),
    'brief', (select jsonb_build_object('versionId', b.id, 'createdAt', b.created_at, 'createdBy', b.created_by,
                     'rules', jsonb_array_length(b.learned)) from brief_versions b where b.status = 'active'),
    'unconsolidated', (select count(*) from feedback where consolidated_in is null))
$$;

-- ─── Access ────────────────────────────────────────────────────────────────
-- New Supabase projects grant nothing by default, and a missing grant fails
-- even for the secret key, so the Worker's role (service_role) is granted
-- exactly what it uses. The browser never reaches the database: anon and
-- authenticated get nothing, and row-level security is on with no policies.

alter table brief_versions enable row level security;
alter table searches enable row level security;
alter table scout_runs enable row level security;
alter table search_runs enable row level security;
alter table posts enable row level security;
alter table judgments enable row level security;
alter table feedback enable row level security;
alter table learning_runs enable row level security;
alter table usage_daily enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
