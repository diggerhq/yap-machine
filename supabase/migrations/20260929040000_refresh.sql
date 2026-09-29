-- Refresh: the owner starts a scout run from the app and watches it.
-- A manual run works every enabled search not run in the last five minutes,
-- whatever its interval; the budget cap applies as always. The run records
-- how many searches it planned, so the app can show progress from its own
-- tables: searches run, posts judged, posts waiting.

alter table scout_runs add column manual boolean not null default false;
alter table scout_runs add column planned integer;

-- Whether a search is due: its interval has passed (one minute early, so a
-- five-minute schedule never skips a beat), or five minutes for a manual run.
create function search_due(s searches, p_manual boolean, p_now timestamptz) returns boolean
language sql stable as $$
  select s.last_run_at is null
      or s.last_run_at <= p_now - make_interval(mins => (case when p_manual then least(s.every_minutes, 5) else s.every_minutes end) - 1)
$$;

create or replace function begin_scout_run(p_session_id text, p_cap_usd numeric, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  b brief_versions;
  v_manual boolean;
begin
  insert into scout_runs (session_id, started_at) values (p_session_id, p_now) on conflict do nothing;
  select manual into v_manual from scout_runs where session_id = p_session_id;
  b := active_brief();
  if b.id is null then return jsonb_build_object('error', 'no_brief'); end if;
  -- The number of searches this run will work, for the Refresh progress.
  update scout_runs set planned = (select count(*) from searches s where s.enabled and search_due(s, v_manual, p_now))
  where session_id = p_session_id and planned is null;
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
      where s.enabled and search_due(s, v_manual, p_now)), '[]'),
    'spend', jsonb_build_object(
      'todayUsd', coalesce((select spend_usd from usage_daily where day = utc_day(p_now)), 0),
      'capUsd', p_cap_usd),
    'unconsolidated', (select count(*) from feedback where consolidated_in is null)
  );
end $$;

drop function claim_search(text, numeric, timestamptz);

create function claim_search(p_search_id text, p_session_id text, p_cap_usd numeric, p_now timestamptz default now())
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
  if not s.enabled or not search_due(s, coalesce((select manual from scout_runs where session_id = p_session_id), false), p_now) then
    return jsonb_build_object('error', 'not_due');
  end if;
  update searches set last_run_at = p_now where id = s.id;
  return jsonb_build_object(
    'query', s.query,
    'sinceId', case when s.last_run_at is null or s.last_run_at < p_now - interval '6 days' then null else s.since_id end);
end $$;

-- POST /api/refresh: records the session the app just created as a manual
-- scout run, before its first turn is sent.
create function begin_manual_scout(p_session_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
begin
  insert into scout_runs (session_id, started_at, manual) values (p_session_id, p_now, true)
  on conflict (session_id) do update set manual = true;
  return jsonb_build_object('sessionId', p_session_id);
end $$;

-- GET /api/refresh: the latest scout run and how far it has got. A run that
-- has not finished within 15 minutes is reported as stalled.
create function scout_progress(p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce((
    select jsonb_build_object(
      'sessionId', r.session_id,
      'manual', r.manual,
      'startedAt', r.started_at,
      'finishedAt', r.finished_at,
      'stalled', r.finished_at is null and r.started_at <= p_now - interval '15 minutes',
      'planned', r.planned,
      'searched', (select count(*) from search_runs sr where sr.session_id = r.session_id),
      'stored', coalesce((select sum(stored) from search_runs sr where sr.session_id = r.session_id), 0),
      'judged', (select count(*) from judgments j where j.session_id = r.session_id),
      'waiting', (select count(*) from posts p
                  where p.text is not null and p.created_at > p_now - interval '48 hours' and p.dismissed_at is null
                    and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'scout')),
      'report', r.report)
    from scout_runs r order by r.started_at desc, r.manual desc limit 1), 'null'::jsonb)
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
