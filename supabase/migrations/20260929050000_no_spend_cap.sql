-- No daily spending cap. X's pay-per-use draws on prepaid credits, which is
-- its own limit; the app no longer refuses a search on spend or shows it.
-- Spend is still counted in usage_daily, for the record.

drop function begin_scout_run(text, numeric, timestamptz);
drop function claim_search(text, text, numeric, timestamptz);
drop function app_status(numeric, timestamptz);

create function begin_scout_run(p_session_id text, p_now timestamptz default now())
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
    'unconsolidated', (select count(*) from feedback where consolidated_in is null)
  );
end $$;

create function claim_search(p_search_id text, p_session_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  s searches;
begin
  if (active_brief()).id is null then return jsonb_build_object('error', 'no_brief'); end if;
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

create function app_status(p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spend', coalesce((select jsonb_build_object('todayUsd', u.spend_usd, 'postReads', u.post_reads, 'userReads', u.user_reads)
                       from usage_daily u where u.day = utc_day(p_now)),
                      jsonb_build_object('todayUsd', 0, 'postReads', 0, 'userReads', 0)),
    'learning', (select jsonb_build_object('id', r.id, 'startedAt', r.started_at) from learning_runs r
                 where r.finished_at is null and not r.abandoned and r.started_at > p_now - interval '15 minutes'),
    'lastLearning', (select jsonb_build_object('id', r.id, 'finishedAt', r.finished_at) from learning_runs r
                     where r.finished_at is not null order by r.finished_at desc limit 1),
    'brief', (select jsonb_build_object('versionId', b.id, 'createdAt', b.created_at, 'createdBy', b.created_by,
                     'rules', jsonb_array_length(b.learned)) from brief_versions b where b.status = 'active'),
    'unconsolidated', (select count(*) from feedback where consolidated_in is null))
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
