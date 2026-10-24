-- ============================================================
-- Code Lab database setup.
-- Paste this whole file into Supabase → SQL Editor → Run.
-- BEFORE running: change the teacher email at the bottom.
-- ============================================================

-- People allowed to use the site. Nobody else can sign up.
create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  full_name  text not null default '',
  role       text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text not null default '',
  language     text not null check (language in ('python', 'javascript')),
  starter_code text not null default '',
  -- [{ "name": "...", "type": "assert", "code": "..." }
  --  { "name": "...", "type": "output", "input": "...", "expected": "..." }]
  tests        jsonb not null default '[]',
  published    boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------- helpers (used by the security rules) ----------

create function public.current_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_emails where email = current_email())
$$;

create function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_emails where email = current_email() and role = 'teacher')
$$;

create table public.submissions (
  id         bigint generated always as identity primary key,
  task_id    bigint not null references public.tasks (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email      text not null default public.current_email(),
  code       text not null,
  passed     int not null,
  total      int not null,
  created_at timestamptz not null default now()
);
create index submissions_task_user on public.submissions (task_id, user_id);

-- ---------- block sign-ups from emails not on the list ----------

create function public.check_signup_allowed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'EMAIL_NOT_ALLOWED';
  end if;
  return new;
end
$$;

create trigger only_allowed_emails_can_sign_up
  before insert on auth.users
  for each row execute function public.check_signup_allowed();

-- ---------- row level security ----------

alter table public.allowed_emails enable row level security;
alter table public.tasks          enable row level security;
alter table public.submissions    enable row level security;

-- allowed_emails: you can see your own row; the teacher manages the list
create policy "see own row or teacher" on public.allowed_emails
  for select to authenticated using (email = public.current_email() or public.is_teacher());
create policy "teacher adds" on public.allowed_emails
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.allowed_emails
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.allowed_emails
  for delete to authenticated using (public.is_teacher());

-- tasks: students on the list see published tasks; the teacher manages all
create policy "students read published" on public.tasks
  for select to authenticated using (public.is_teacher() or (published and public.is_allowed()));
create policy "teacher adds" on public.tasks
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.tasks
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.tasks
  for delete to authenticated using (public.is_teacher());

-- submissions: students save and read their own; the teacher reads all
create policy "read own or teacher" on public.submissions
  for select to authenticated
  using (public.is_teacher() or (user_id = auth.uid() and public.is_allowed()));
create policy "students submit" on public.submissions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and email = public.current_email()
    and public.is_allowed()
    and exists (select 1 from public.tasks t where t.id = task_id and (t.published or public.is_teacher()))
  );
create policy "teacher removes" on public.submissions
  for delete to authenticated using (public.is_teacher());

-- the sign-up check is only for the trigger; the access helpers are only for logged-in users
revoke execute on function public.check_signup_allowed() from public, anon, authenticated;
revoke execute on function public.is_allowed() from public, anon;
revoke execute on function public.is_teacher() from public, anon;
grant execute on function public.is_allowed() to authenticated;
grant execute on function public.is_teacher() to authenticated;

-- ---------- the teacher account ----------
-- CHANGE THIS to the email you will log in with:
insert into public.allowed_emails (email, full_name, role)
values (lower('minanasserwanaszero@gmail.com'), 'Teacher', 'teacher');

-- ============================================================
-- Materials (PDFs students can open and download)
-- ============================================================

create table public.materials (
  id          bigint generated always as identity primary key,
  title       text not null,
  file_path   text not null unique,
  file_name   text not null,
  size_bytes  bigint not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.materials enable row level security;

create policy "students read published" on public.materials
  for select to authenticated using (public.is_teacher() or (published and public.is_allowed()));
create policy "teacher adds" on public.materials
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.materials
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.materials
  for delete to authenticated using (public.is_teacher());

-- private bucket: PDFs only, 50 MB max
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 52428800, array['application/pdf']);

create policy "materials: class reads visible files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and (
      public.is_teacher()
      or (public.is_allowed() and exists (
        select 1 from public.materials m where m.file_path = storage.objects.name and m.published))
    )
  );
create policy "materials: teacher uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'materials' and public.is_teacher());
create policy "materials: teacher replaces" on storage.objects
  for update to authenticated using (bucket_id = 'materials' and public.is_teacher());
create policy "materials: teacher deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'materials' and public.is_teacher());

-- ============================================================
-- Chapters (tasks and PDFs can belong to one)
-- ============================================================

create table public.chapters (
  id          bigint generated always as identity primary key,
  title       text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.chapters enable row level security;

create policy "class reads chapters" on public.chapters
  for select to authenticated using (public.is_allowed());
create policy "teacher adds" on public.chapters
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.chapters
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.chapters
  for delete to authenticated using (public.is_teacher());

-- deleting a chapter keeps its tasks and PDFs; they just move to "Other"
alter table public.tasks     add column chapter_id bigint references public.chapters (id) on delete set null;
alter table public.materials add column chapter_id bigint references public.chapters (id) on delete set null;
create index tasks_chapter on public.tasks (chapter_id);
create index materials_chapter on public.materials (chapter_id);

-- ============================================================
-- Quizzes (marks the teacher types in) and the Top 3 leaderboard
-- ============================================================

create table public.quizzes (
  id          bigint generated always as identity primary key,
  title       text not null,
  max_score   numeric not null check (max_score > 0),
  quiz_date   date not null default current_date,
  chapter_id  bigint references public.chapters (id) on delete set null,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index quizzes_chapter on public.quizzes (chapter_id);

-- one mark per student per quiz; no row = no mark yet
create table public.quiz_scores (
  quiz_id     bigint not null references public.quizzes (id) on delete cascade,
  email       text not null references public.allowed_emails (email) on delete cascade on update cascade,
  score       numeric not null check (score >= 0),
  updated_at  timestamptz not null default now(),
  primary key (quiz_id, email)
);
create index quiz_scores_email on public.quiz_scores (email);

alter table public.quizzes     enable row level security;
alter table public.quiz_scores enable row level security;

create policy "students read published" on public.quizzes
  for select to authenticated using (public.is_teacher() or (published and public.is_allowed()));
create policy "teacher adds" on public.quizzes
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.quizzes
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.quizzes
  for delete to authenticated using (public.is_teacher());

-- students see only their own marks, and only for visible quizzes
create policy "read own or teacher" on public.quiz_scores
  for select to authenticated using (
    public.is_teacher()
    or (email = public.current_email() and public.is_allowed()
        and exists (select 1 from public.quizzes q where q.id = quiz_id and q.published))
  );
create policy "teacher adds" on public.quiz_scores
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.quiz_scores
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.quiz_scores
  for delete to authenticated using (public.is_teacher());

-- Points = sum of marks on visible quizzes. Returns the top 3 places (ties share a place)
-- plus the caller's own row, so nobody sees the rest of the class's marks.
create function public.leaderboard()
returns table (place int, full_name text, points numeric, quizzes int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with totals as (
    select a.email, a.full_name, sum(s.score) as points, count(*)::int as quizzes
    from quiz_scores s
    join quizzes q on q.id = s.quiz_id and q.published
    join allowed_emails a on a.email = s.email and a.role = 'student'
    group by a.email, a.full_name
  ), ranked as (
    select t.*, (rank() over (order by t.points desc))::int as place from totals t
  )
  select r.place, coalesce(nullif(r.full_name, ''), 'Student'), r.points, r.quizzes,
         r.email = current_email()
  from ranked r
  where is_allowed() and ((r.place <= 3 and r.points > 0) or r.email = current_email())
  order by r.place, r.full_name
$$;
revoke execute on function public.leaderboard() from public, anon;
grant execute on function public.leaderboard() to authenticated;

-- ============================================================
-- Extra points (bonus the teacher gives, counted in the Top 3)
-- ============================================================

create table public.extra_points (
  id          bigint generated always as identity primary key,
  email       text not null references public.allowed_emails (email) on delete cascade on update cascade,
  points      numeric not null check (points <> 0), -- a minus number takes points away
  reason      text not null default '',
  given_on    date not null default current_date,
  created_at  timestamptz not null default now()
);
create index extra_points_email on public.extra_points (email);

alter table public.extra_points enable row level security;

create policy "read own or teacher" on public.extra_points
  for select to authenticated using (public.is_teacher() or (email = public.current_email() and public.is_allowed()));
create policy "teacher adds" on public.extra_points
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.extra_points
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.extra_points
  for delete to authenticated using (public.is_teacher());

-- leaderboard points now = quiz marks on visible quizzes + extra points
create or replace function public.leaderboard()
returns table (place int, full_name text, points numeric, quizzes int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with earned as (
    select s.email, s.score as pts, 1 as is_quiz
    from quiz_scores s join quizzes q on q.id = s.quiz_id and q.published
    union all
    select e.email, e.points, 0 from extra_points e
  ), totals as (
    select a.email, a.full_name, sum(x.pts) as points, sum(x.is_quiz)::int as quizzes
    from earned x
    join allowed_emails a on a.email = x.email and a.role = 'student'
    group by a.email, a.full_name
  ), ranked as (
    select t.*, (rank() over (order by t.points desc))::int as place from totals t
  )
  select r.place, coalesce(nullif(r.full_name, ''), 'Student'), r.points, r.quizzes,
         r.email = current_email()
  from ranked r
  where is_allowed() and ((r.place <= 3 and r.points > 0) or r.email = current_email())
  order by r.place, r.full_name
$$;
revoke execute on function public.leaderboard() from public, anon;
grant execute on function public.leaderboard() to authenticated;

-- ============================================================
-- Rank levels (Codeforces-style colours by total points; the teacher edits them)
-- ============================================================

create table public.rank_levels (
  id          bigint generated always as identity primary key,
  title       text not null,
  min_points  numeric not null unique,
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now()
);

alter table public.rank_levels enable row level security;

create policy "class reads levels" on public.rank_levels
  for select to authenticated using (public.is_allowed());
create policy "teacher adds" on public.rank_levels
  for insert to authenticated with check (public.is_teacher());
create policy "teacher edits" on public.rank_levels
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher removes" on public.rank_levels
  for delete to authenticated using (public.is_teacher());

insert into public.rank_levels (title, min_points, color) values
  ('Beginner',            0, '#808080'),
  ('Rising Star',            10, '#008000'),
  ('Achiever',        25, '#03a89e'),
  ('Excellent',            50, '#0000ff'),
  ('Outstanding',  80, '#aa00aa'),
  ('Champion',           120, '#ff8c00'),
  ('Legend',      170, '#ff0000');
