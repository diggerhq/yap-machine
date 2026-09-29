-- Filling in avatars for posts stored before posts kept them. The backfill
-- script (npm run avatars) reads the authors without one, looks them up on
-- X, and writes the pictures back; the lookup's user reads count against
-- today's X spend like any other.

-- Authors of posts still in the feed window that have no avatar.
create function authors_without_avatar(p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(distinct author_id), '[]') from posts
  where author_avatar is null and created_at > p_now - interval '48 hours'
$$;

-- [{ authorId, avatar }] from a lookup of p_user_reads users.
create function set_author_avatars(p_avatars jsonb, p_user_reads integer, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_updated integer;
begin
  update posts p set author_avatar = x.avatar
  from jsonb_to_recordset(p_avatars) as x("authorId" text, avatar text)
  where p.author_id = x."authorId" and p.author_avatar is null
    and x.avatar ~ '^https://pbs\.twimg\.com/';
  get diagnostics v_updated = row_count;
  insert into usage_daily (day, spend_usd, post_reads, user_reads)
  values (utc_day(p_now), p_user_reads * 0.010, 0, p_user_reads)
  on conflict (day) do update set
    spend_usd = usage_daily.spend_usd + excluded.spend_usd,
    user_reads = usage_daily.user_reads + excluded.user_reads;
  return jsonb_build_object('posts', v_updated);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
