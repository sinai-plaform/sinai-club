-- SINAI Club 3.0 (applied to the live project as sc_3_0_part1_additive + sc_3_0_part2_child_protection) — development plans, monthly reports, protected messages, live exchange rates,
-- reasons on built sessions. Additive only: no existing column or row is changed.

-- ---------- one attribute score, the same formula as the app (core.js scoreFromObs) ----------
-- value = 1+(score-1)*4.75 · weight = source × weight × 0.5^(days/28) · score = (Σwv + 3·prior)/(Σw + 3)
create or replace function public.coach_attr_score(p_player uuid, p_attr text, p_asof timestamptz default now())
returns numeric language sql stable security definer set search_path = public as $$
  with o as (
    select o.attribute, 1 + (o.score - 1) * 4.75 as v,
      (case o.source when 'match' then 1.3 when 'test' then 1.5 when 'challenge' then 0.7 else 1.0 end)
        * coalesce(o.weight, 1) * power(0.5, extract(epoch from p_asof - o.at) / 86400.0 / 28.0) as wt
    from coach_observations o
    where o.player_id = p_player and o.voided is not true
      and o.at <= p_asof and o.at > p_asof - interval '400 days'
  ), p as (select (coalesce(sum(v*wt),0) + 5*10.5) / (coalesce(sum(wt),0) + 5) as prior from o)
  select case when count(o.*) = 0 then null
    else round((sum(o.v*o.wt) + 3*max(p.prior)) / (sum(o.wt) + 3), 1) end
  from p left join o on o.attribute = p_attr;
$$;
revoke all on function public.coach_attr_score(uuid, text, timestamptz) from public, anon;

-- ---------- development plan: goals linked to an attribute ----------
alter table public.coach_goals
  add column if not exists attribute text,
  add column if not exists baseline numeric,
  add column if not exists target numeric,
  add column if not exists season text,
  add column if not exists team_id uuid references public.coach_teams(id) on delete set null,
  add column if not exists set_by uuid default auth.uid(),
  add column if not exists reached_at timestamptz,
  add column if not exists archived_at timestamptz;

-- at most 3 open attribute goals per player per season
create or replace function public.coach_goals_limit() returns trigger language plpgsql as $$
begin
  if new.attribute is not null and new.done_at is null and new.archived_at is null then
    if (select count(*) from public.coach_goals g where g.player_id = new.player_id
          and coalesce(g.season,'') = coalesce(new.season,'') and g.attribute is not null
          and g.done_at is null and g.archived_at is null and g.id <> new.id) >= 3 then
      raise exception 'GOAL_LIMIT: לכל שחקן עד 3 יעדים פתוחים בעונה';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists coach_goals_limit on public.coach_goals;
create trigger coach_goals_limit before insert or update on public.coach_goals
  for each row execute function public.coach_goals_limit();

-- the child and the parents read the goals (until now only the club could)
drop policy if exists goals_family on public.coach_goals;
create policy goals_family on public.coach_goals for select to authenticated
  using (player_id in (select public.coach_my_player_ids()));

-- the goals with live progress, for the parent / child / coach. Numbers only when the coach opened them.
create or replace function public.coach_kid_goals(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare is_guardian boolean; is_self boolean; is_staff boolean; nums boolean; out jsonb;
begin
  select exists(select 1 from coach_guardian_players gp join coach_guardians g on g.id=gp.guardian_id
                where gp.player_id=p_player and g.user_id=auth.uid()) into is_guardian;
  select exists(select 1 from coach_players where id=p_player and user_id=auth.uid()) into is_self;
  select exists(select 1 from coach_players p where p.id=p_player and coach_is_staff(p.club_id)) into is_staff;
  if not (is_guardian or is_self or is_staff) then return '[]'::jsonb; end if;
  select is_staff or exists(select 1 from coach_team_players tp join coach_teams t on t.id=tp.team_id
     where tp.player_id=p_player and ((is_guardian and t.parent_sees_scores) or (is_self and t.show_scores_to_player)))
    into nums;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into out from (
    select jsonb_build_object(
      'id', g.id, 'text', g.text, 'attribute', g.attribute, 'season', g.season, 'due', g.due,
      'done_at', g.done_at, 'reached_at', g.reached_at, 'created_at', g.created_at,
      'pct', case when g.attribute is null or g.target is null or g.baseline is null then null
                  when g.target <= g.baseline then 100
                  else greatest(0, least(100, round((coalesce(public.coach_attr_score(g.player_id, g.attribute), g.baseline) - g.baseline)
                                                   / (g.target - g.baseline) * 100))) end,
      'baseline', case when nums then g.baseline end,
      'target', case when nums then g.target end,
      'current', case when nums and g.attribute is not null then public.coach_attr_score(g.player_id, g.attribute) end,
      'numbers', nums) as x
    from coach_goals g where g.player_id = p_player and g.archived_at is null
  ) s;
  return out;
end $$;
revoke all on function public.coach_kid_goals(uuid) from public, anon;
grant execute on function public.coach_kid_goals(uuid) to authenticated;

-- ---------- monthly progress reports ----------
create table if not exists public.coach_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.coach_clubs(id) on delete cascade,
  team_id uuid references public.coach_teams(id) on delete set null,
  player_id uuid not null references public.coach_players(id) on delete cascade,
  period text not null,                         -- 'YYYY-MM'
  body jsonb not null default '{}'::jsonb,      -- the snapshot the parent sees
  ai_line text,                                 -- what the AI suggested
  coach_line text,                              -- what the coach approved
  lang text default 'he',
  status text not null default 'draft' check (status in ('draft','approved','sent')),
  share_token text unique,
  approved_at timestamptz, approved_by uuid,
  sent_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (player_id, period)
);
alter table public.coach_reports enable row level security;
drop policy if exists reports_staff on public.coach_reports;
create policy reports_staff on public.coach_reports for all to authenticated
  using (public.coach_is_staff(club_id)) with check (public.coach_is_staff(club_id));
drop policy if exists reports_family on public.coach_reports;
create policy reports_family on public.coach_reports for select to authenticated
  using (status <> 'draft' and player_id in (select public.coach_my_player_ids()));

-- the link sent to the parent: only an approved report, only by its secret token
create or replace function public.coach_report_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('period', r.period, 'body', r.body, 'coach_line', r.coach_line, 'lang', r.lang,
                            'approved_at', r.approved_at)
  from coach_reports r
  where r.share_token = p_token and length(p_token) >= 20 and r.status in ('approved','sent')
    and r.approved_at > now() - interval '400 days';
$$;
revoke all on function public.coach_report_public(text) from public;
grant execute on function public.coach_report_public(text) to anon, authenticated;

-- ---------- messages: child protection + a log nobody can edit or delete ----------
alter table public.coach_messages
  add column if not exists thread_player_id uuid references public.coach_players(id) on delete restrict,
  add column if not exists sender_role text,
  add column if not exists recipients jsonb,
  add column if not exists minor boolean,
  add column if not exists to_guardian_id uuid;
alter table public.coach_messages alter column by_user set default auth.uid();

create or replace function public.coach_msg_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; staff_role text; is_guardian boolean; is_self boolean; g jsonb; n int;
begin
  if auth.uid() is not null then new.by_user := auth.uid(); end if;
  new.sent_at := coalesce(new.sent_at, now());
  if new.thread_player_id is not null then
    select id, club_id, birth_date, user_id into p from coach_players where id = new.thread_player_id;
    if p.id is null then raise exception 'CHILD_GUARD: שחקן לא קיים'; end if;
    new.club_id := p.club_id;
    select m.role into staff_role from coach_members m
      where m.user_id = new.by_user and m.club_id = p.club_id and m.role in ('coach','assistant','manager') limit 1;
    -- an unknown birth date counts as a minor
    new.minor := (p.birth_date is null or p.birth_date > (current_date - interval '18 years'));
    select exists(select 1 from coach_guardian_players gp join coach_guardians g2 on g2.id=gp.guardian_id
                  where gp.player_id=p.id and g2.user_id=new.by_user) into is_guardian;
    is_self := (p.user_id is not null and p.user_id = new.by_user);
    new.sender_role := case when staff_role is not null then staff_role
                            when is_guardian then 'parent' when is_self then 'player' else null end;
    if new.sender_role is null then raise exception 'CHILD_GUARD: אין הרשאה לשיחה הזו'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('guardian_id', g2.id, 'user_id', g2.user_id, 'name', g2.name, 'phone', g2.phone)), '[]'::jsonb),
           count(*)
      into g, n
      from coach_guardian_players gp join coach_guardians g2 on g2.id = gp.guardian_id where gp.player_id = p.id;
    -- an adult never writes to a minor without the parents in the conversation
    if new.minor and staff_role is not null and n = 0 then
      raise exception 'CHILD_GUARD: לשחקן אין הורה רשום. מוסיפים הורה לפני שכותבים לילד';
    end if;
    new.recipients := jsonb_build_object('player_id', p.id, 'player_user_id', p.user_id, 'guardians', g);
    new.channel := coalesce(new.channel, 'app');
  else
    select m.role into staff_role from coach_members m
      where m.user_id = new.by_user and m.club_id = new.club_id and m.role in ('coach','assistant','manager') limit 1;
    if staff_role is null then raise exception 'CHILD_GUARD: רק צוות המועדון'; end if;
    new.sender_role := staff_role;
  end if;
  return new;
end $$;
drop trigger if exists coach_msg_guard on public.coach_messages;
create trigger coach_msg_guard before insert on public.coach_messages
  for each row execute function public.coach_msg_guard();

create or replace function public.coach_msg_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'MSG_LOG: יומן ההודעות נשמר לתמיד — אי אפשר לערוך או למחוק הודעה';
end $$;
drop trigger if exists coach_msg_no_change on public.coach_messages;
create trigger coach_msg_no_change before update or delete on public.coach_messages
  for each row execute function public.coach_msg_immutable();
drop trigger if exists coach_msg_no_truncate on public.coach_messages;
create trigger coach_msg_no_truncate before truncate on public.coach_messages
  for each statement execute function public.coach_msg_immutable();

-- staff keep the existing p_msg rule (members of the club = staff only); the family gets its child's thread
drop policy if exists msg_family_read on public.coach_messages;
create policy msg_family_read on public.coach_messages for select to authenticated
  using (thread_player_id in (select public.coach_my_player_ids()));
drop policy if exists msg_family_insert on public.coach_messages;
create policy msg_family_insert on public.coach_messages for insert to authenticated
  with check (thread_player_id in (select public.coach_my_player_ids()));
create index if not exists coach_messages_thread on public.coach_messages(thread_player_id, sent_at);

-- ---------- live exchange rates (filled by the fx-rates function, read by everyone) ----------
create table if not exists public.coach_fx_rates (
  base text primary key,
  rates jsonb not null,
  provider text not null,
  as_of timestamptz not null,
  fetched_at timestamptz not null default now()
);
alter table public.coach_fx_rates enable row level security;
drop policy if exists fx_read on public.coach_fx_rates;
create policy fx_read on public.coach_fx_rates for select to anon, authenticated using (true);

-- ---------- why each drill was chosen ("בנה לי אימון") ----------
alter table public.coach_session_drills add column if not exists why text;
