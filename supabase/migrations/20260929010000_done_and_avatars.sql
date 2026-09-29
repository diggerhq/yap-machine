-- Done: the owner can set a post aside without a verdict. A dismissed post
-- leaves Open and Filtered for Handled, is not judged or re-scored, and
-- teaches nothing: no feedback row, so no learning run sees it. Undo clears
-- it.
-- Avatars: the feed renders posts itself (X's embed is too heavy to read
-- quickly), so each post keeps its author's profile image URL.
-- The functions below are the first migration's, with both added.

alter table posts add column dismissed_at timestamptz;
alter table posts add column author_avatar text check (author_avatar is null or author_avatar ~ '^https://pbs\.twimg\.com/');


create or replace function record_candidates(
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
    from incoming i
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

create or replace function lease_posts(p_session_id text, p_limit integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_posts jsonb;
  v_waiting integer;
begin
  with picked as (
    select p.id from posts p
    where p.text is not null
      and p.created_at > p_now - interval '48 hours'
      and p.dismissed_at is null
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
    and p.dismissed_at is null
    and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'scout')
    and (p.leased_until is null or p.leased_until <= p_now);

  return jsonb_build_object('posts', v_posts, 'waiting', v_waiting);
end $$;

create or replace function rescore_set(p_version bigint, p_threshold integer, p_now timestamptz)
returns setof posts language sql stable as $$
  select p.* from posts p
  join current_judgments cj on cj.post_id = p.id
  where p.text is not null
    and p.created_at > p_now - interval '48 hours'
    and p.opened_at is null
    and p.dismissed_at is null
    and not exists (select 1 from feedback f where f.post_id = p.id)
    and cj.score >= p_threshold - 20
    and cj.brief_version_id <> p_version
    and not exists (select 1 from judgments j where j.post_id = p.id and j.kind = 'rescore' and j.brief_version_id = p_version)
$$;

create or replace function feed_item(p posts, cj current_judgments, f feedback, p_now timestamptz) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'authorHandle', p.author_handle, 'authorName', p.author_name, 'authorAvatar', p.author_avatar,
    'authorFollowers', p.author_followers, 'text', p.text, 'createdAt', p.created_at,
    'context', p.context, 'metrics', p.metrics, 'openedAt', p.opened_at, 'dismissedAt', p.dismissed_at, 'searchId', p.search_id,
    'judgment', case when cj.id is null then null else jsonb_build_object(
      'score', cj.score, 'reason', cj.reason, 'kind', cj.kind, 'judgedAt', cj.judged_at,
      'briefVersionId', cj.brief_version_id) end,
    'rank', case when cj.id is null then null else post_rank(cj.score, p.created_at, p_now) end,
    'feedback', case when f.id is null then null else jsonb_build_object(
      'id', f.id, 'verdict', f.verdict, 'note', f.note, 'createdAt', f.created_at,
      'consolidated', f.consolidated_in is not null) end)
$$;

create or replace function feed_page(p_filter text, p_threshold integer, p_cursor jsonb, p_limit integer, p_now timestamptz default now())
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
      greatest(p.opened_at, f.created_at, p.dismissed_at) as handled_at
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
                       and (b.p).opened_at is null and (b.p).dismissed_at is null and (b.f).id is null
      when 'filtered' then (b.cj).score < p_threshold and (b.p).created_at > v_now - interval '48 hours'
                       and (b.p).opened_at is null and (b.p).dismissed_at is null and (b.f).id is null
      else (b.p).opened_at is not null or (b.p).dismissed_at is not null or (b.f).id is not null end
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

create or replace function feed_new_count(p_since timestamptz, p_threshold integer, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select jsonb_build_object('count', count(*)) from posts p
  join current_judgments cj on cj.post_id = p.id
  where cj.judged_at > p_since and cj.score >= p_threshold
    and p.created_at > p_now - interval '48 hours' and p.opened_at is null and p.dismissed_at is null
    and not exists (select 1 from feedback f where f.post_id = p.id)
$$;

-- POST /api/posts/:id/dismiss: Done, without a verdict.
create function mark_dismissed(p_post_id text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
begin
  update posts set dismissed_at = coalesce(dismissed_at, p_now) where id = p_post_id;
  if not found then return jsonb_build_object('error', 'unknown_post'); end if;
  return jsonb_build_object('dismissed', p_post_id);
end $$;

-- DELETE /api/posts/:id/dismiss: undo Done.
create function undo_dismissed(p_post_id text)
returns jsonb language plpgsql as $$
begin
  update posts set dismissed_at = null where id = p_post_id;
  if not found then return jsonb_build_object('error', 'unknown_post'); end if;
  return jsonb_build_object('restored', p_post_id);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
