-- Two fixes after the first live runs.
-- 1. record_candidates keeps one row per post id: X returned a post on both
--    pages of one search, and the upsert failed the whole batch.
-- 2. reset_judgments lets the owner re-score the feed after the scoring
--    instructions change (npm run rejudge): it removes the scout judgments of
--    posts still in the feed window that nobody has handled, and the next
--    scout run judges them again. Handled posts, feedback and learned rules
--    are untouched.

create or replace function record_candidates(
  p_search_id text, p_session_id text, p_newest_id text, p_posts jsonb,
  p_post_reads integer, p_user_reads integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_fetched integer := (select count(distinct x->>'id') from jsonb_array_elements(p_posts) x);
  v_stored integer;
begin
  perform 1 from searches where id = p_search_id for update;
  if not found then return jsonb_build_object('error', 'unknown_search'); end if;

  with incoming as (
    select * from jsonb_to_recordset(p_posts) as x(
      id text, "authorId" text, "authorHandle" text, "authorName" text, "authorFollowers" integer, "authorAvatar" text,
      text text, "createdAt" timestamptz, "conversationId" text, context jsonb, metrics jsonb)
  ), inserted as (
    insert into posts (id, search_id, author_id, author_handle, author_name, author_followers, author_avatar, text,
                       created_at, conversation_id, context, metrics, fetched_at)
    select i.id, p_search_id, i."authorId", i."authorHandle", i."authorName", i."authorFollowers", i."authorAvatar",
           case when i."createdAt" > p_now - interval '48 hours' then i.text end,
           i."createdAt", i."conversationId",
           case when i."createdAt" > p_now - interval '48 hours' then i.context end,
           i.metrics, p_now
    -- X can return a post on two pages of one search; keep one of each, or
    -- the upsert would touch a row twice and fail the whole batch.
    from (select distinct on (id) * from incoming order by id) i
    on conflict (id) do update set metrics = excluded.metrics, author_followers = excluded.author_followers,
      author_avatar = coalesce(excluded.author_avatar, posts.author_avatar)
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

create function reset_judgments(p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_count integer;
begin
  delete from judgments j using posts p
  where j.post_id = p.id
    and p.created_at > p_now - interval '48 hours' and p.text is not null
    and p.opened_at is null and p.dismissed_at is null
    and not exists (select 1 from feedback f where f.post_id = p.id);
  get diagnostics v_count = row_count;
  update posts set leased_until = null, leased_session = null where leased_until is not null;
  return jsonb_build_object('reset', v_count);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
