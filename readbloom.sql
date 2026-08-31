-- ReadBloom final consolidated Supabase SQL
-- Generated from supabase/migrations/*.sql and supabase/seed.sql.
-- Intended for a fresh ReadBloom Supabase project. Edge Functions must still be deployed from supabase/functions/.


-- ============================================================
-- Source: supabase/migrations/202607170001_initial_schema.sql
-- ============================================================

-- ReadBloom Phase 2 initial schema.
-- This migration assumes it runs inside a Supabase project where auth.users,
-- storage, and the auth helper functions already exist.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'teacher', 'admin')),
  email text not null unique,
  full_name text not null,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  grade_level text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, grade_level, name)
);

create table public.student_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  student_number text unique,
  grade_level text not null,
  section_id uuid references public.sections(id) on delete set null,
  current_skill_level text not null default 'Reading Explorer',
  days_streak int not null default 0 check (days_streak >= 0),
  last_login_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_student_profiles_updated_at
before update on public.student_profiles
for each row execute function public.set_updated_at();

create table public.teacher_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  employee_number text unique,
  school_id uuid references public.schools(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_teacher_profiles_updated_at
before update on public.teacher_profiles
for each row execute function public.set_updated_at();

create table public.teacher_sections (
  teacher_id uuid references public.profiles(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, section_id)
);

create table public.safety_agreements (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index one_active_safety_agreement
on public.safety_agreements (is_active)
where is_active;

create table public.profile_safety_acceptances (
  profile_id uuid references public.profiles(id) on delete cascade,
  agreement_id uuid references public.safety_agreements(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  accepted_from text,
  primary key (profile_id, agreement_id)
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  grade_level text not null,
  title text not null,
  passage_text text not null,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_books_updated_at
before update on public.books
for each row execute function public.set_updated_at();

create table public.book_questions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  question_text text not null,
  options jsonb not null,
  correct_option_index int not null check (correct_option_index >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint book_questions_options_array check (jsonb_typeof(options) = 'array'),
  constraint book_questions_min_options check (jsonb_array_length(options) >= 2)
);

create table public.reading_submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  book_title_snapshot text not null,
  passage_text_snapshot text not null,
  video_path text,
  audio_path text,
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  time_limit_seconds int not null default 300 check (time_limit_seconds > 0),
  is_overtime boolean not null default false,
  status text not null default 'draft' check (
    status in ('draft', 'uploading', 'uploaded', 'processing', 'processed', 'submitted', 'failed')
  ),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_reading_submissions_updated_at
before update on public.reading_submissions
for each row execute function public.set_updated_at();

create table public.transcript_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.reading_submissions(id) on delete cascade,
  raw_transcript text,
  normalized_transcript text,
  normalized_expected_text text,
  alignment_json jsonb,
  match_count int not null default 0 check (match_count >= 0),
  missing_count int not null default 0 check (missing_count >= 0),
  extra_count int not null default 0 check (extra_count >= 0),
  substitution_count int not null default 0 check (substitution_count >= 0),
  overall_accuracy numeric check (overall_accuracy is null or (overall_accuracy >= 0 and overall_accuracy <= 1)),
  processing_provider text,
  processing_model text,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_transcript_results_updated_at
before update on public.transcript_results
for each row execute function public.set_updated_at();

create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.reading_submissions(id) on delete cascade,
  question_id uuid references public.book_questions(id) on delete set null,
  selected_option_index int not null check (selected_option_index >= 0),
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

create table public.teacher_feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.reading_submissions(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  feedback_text text not null,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('teacher_feedback', 'system')),
  title text not null,
  body text not null,
  related_submission_id uuid references public.reading_submissions(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  icon_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.student_badges (
  student_id uuid references public.profiles(id) on delete cascade,
  badge_id uuid references public.badges(id) on delete cascade,
  awarded_by uuid references public.profiles(id) on delete set null,
  awarded_at timestamptz not null default now(),
  primary key (student_id, badge_id)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_profiles_role on public.profiles(role);
create index idx_student_profiles_section on public.student_profiles(section_id);
create index idx_teacher_sections_section on public.teacher_sections(section_id);
create index idx_books_section_status on public.books(section_id, status);
create index idx_book_questions_book_order on public.book_questions(book_id, sort_order);
create index idx_reading_submissions_student on public.reading_submissions(student_id);
create index idx_reading_submissions_book on public.reading_submissions(book_id);
create index idx_reading_submissions_status on public.reading_submissions(status);
create index idx_quiz_answers_submission on public.quiz_answers(submission_id);
create index idx_teacher_feedback_student on public.teacher_feedback(student_id);
create index idx_messages_recipient on public.messages(recipient_id, created_at desc);
create index idx_activity_logs_created_at on public.activity_logs(created_at desc);


-- ============================================================
-- Source: supabase/migrations/202607170002_rls_policies.sql
-- ============================================================

-- ReadBloom Row Level Security policies.

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'teacher', false)
$$;

create or replace function public.is_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'student', false)
$$;

create or replace function public.teacher_can_access_section(target_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_sections ts
    where ts.teacher_id = auth.uid()
      and ts.section_id = target_section_id
  )
$$;

create or replace function public.teacher_can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.student_profiles sp
    join public.teacher_sections ts on ts.section_id = sp.section_id
    where sp.profile_id = target_student_id
      and ts.teacher_id = auth.uid()
  )
$$;

create or replace function public.can_access_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reading_submissions rs
    where rs.id = target_submission_id
      and (
        rs.student_id = auth.uid()
        or public.is_admin()
        or public.teacher_can_access_student(rs.student_id)
      )
  )
$$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.sections enable row level security;
alter table public.student_profiles enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.teacher_sections enable row level security;
alter table public.safety_agreements enable row level security;
alter table public.profile_safety_acceptances enable row level security;
alter table public.books enable row level security;
alter table public.book_questions enable row level security;
alter table public.reading_submissions enable row level security;
alter table public.transcript_results enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.teacher_feedback enable row level security;
alter table public.messages enable row level security;
alter table public.badges enable row level security;
alter table public.student_badges enable row level security;
alter table public.activity_logs enable row level security;

create policy "admins can manage schools"
on public.schools for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated users can view schools"
on public.schools for select
to authenticated
using (true);

create policy "users can view own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "teachers can view assigned student profiles"
on public.profiles for select
to authenticated
using (public.is_teacher() and public.teacher_can_access_student(id));

create policy "admins can view all profiles"
on public.profiles for select
to authenticated
using (public.is_admin());

create policy "users can update limited own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = public.current_profile_role());

create policy "admins can manage profiles"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users can view relevant sections"
on public.sections for select
to authenticated
using (
  public.is_admin()
  or public.teacher_can_access_section(id)
  or exists (
    select 1 from public.student_profiles sp
    where sp.profile_id = auth.uid() and sp.section_id = sections.id
  )
);

create policy "admins can manage sections"
on public.sections for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "students can view own student profile"
on public.student_profiles for select
to authenticated
using (profile_id = auth.uid());

create policy "teachers can view assigned students"
on public.student_profiles for select
to authenticated
using (public.is_teacher() and public.teacher_can_access_student(profile_id));

create policy "admins can manage student profiles"
on public.student_profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "teachers can update assigned student skill data"
on public.student_profiles for update
to authenticated
using (public.is_teacher() and public.teacher_can_access_student(profile_id))
with check (public.is_teacher() and public.teacher_can_access_student(profile_id));

create policy "teachers can view own teacher profile"
on public.teacher_profiles for select
to authenticated
using (profile_id = auth.uid());

create policy "admins can manage teacher profiles"
on public.teacher_profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "teachers can view own section assignments"
on public.teacher_sections for select
to authenticated
using (teacher_id = auth.uid() or public.is_admin());

create policy "admins can manage teacher sections"
on public.teacher_sections for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated users can view active safety agreement"
on public.safety_agreements for select
to authenticated
using (is_active or public.is_admin());

create policy "admins can manage safety agreements"
on public.safety_agreements for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "students can view own safety acceptances"
on public.profile_safety_acceptances for select
to authenticated
using (profile_id = auth.uid() or public.is_admin());

create policy "students can accept safety agreement"
on public.profile_safety_acceptances for insert
to authenticated
with check (profile_id = auth.uid() and public.is_student());

create policy "students can view assigned published books"
on public.books for select
to authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.student_profiles sp
    where sp.profile_id = auth.uid()
      and sp.section_id = books.section_id
      and sp.grade_level = books.grade_level
  )
);

create policy "teachers can view assigned section books"
on public.books for select
to authenticated
using (public.is_teacher() and public.teacher_can_access_section(section_id));

create policy "teachers can create assigned section books"
on public.books for insert
to authenticated
with check (
  public.is_teacher()
  and created_by = auth.uid()
  and public.teacher_can_access_section(section_id)
);

create policy "teachers can update own assigned section books"
on public.books for update
to authenticated
using (
  public.is_teacher()
  and created_by = auth.uid()
  and public.teacher_can_access_section(section_id)
)
with check (
  public.is_teacher()
  and created_by = auth.uid()
  and public.teacher_can_access_section(section_id)
);

create policy "admins can manage books"
on public.books for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "students can view questions for assigned books"
on public.book_questions for select
to authenticated
using (
  exists (
    select 1 from public.books b
    where b.id = book_questions.book_id
      and b.status = 'published'
      and exists (
        select 1 from public.student_profiles sp
        where sp.profile_id = auth.uid()
          and sp.section_id = b.section_id
          and sp.grade_level = b.grade_level
      )
  )
);

create policy "teachers can manage questions for assigned books"
on public.book_questions for all
to authenticated
using (
  exists (
    select 1 from public.books b
    where b.id = book_questions.book_id
      and public.is_teacher()
      and b.created_by = auth.uid()
      and public.teacher_can_access_section(b.section_id)
  )
)
with check (
  exists (
    select 1 from public.books b
    where b.id = book_questions.book_id
      and public.is_teacher()
      and b.created_by = auth.uid()
      and public.teacher_can_access_section(b.section_id)
  )
);

create policy "admins can manage questions"
on public.book_questions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "students can manage own submissions"
on public.reading_submissions for all
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid() and public.is_student());

create policy "teachers can view assigned student submissions"
on public.reading_submissions for select
to authenticated
using (public.is_teacher() and public.teacher_can_access_student(student_id));

create policy "admins can view submissions"
on public.reading_submissions for select
to authenticated
using (public.is_admin());

create policy "authorized users can view transcript results"
on public.transcript_results for select
to authenticated
using (public.can_access_submission(submission_id));

create policy "admins can manage transcript results"
on public.transcript_results for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "students can insert own quiz answers"
on public.quiz_answers for insert
to authenticated
with check (
  exists (
    select 1 from public.reading_submissions rs
    where rs.id = quiz_answers.submission_id
      and rs.student_id = auth.uid()
  )
);

create policy "students can update own quiz answers"
on public.quiz_answers for update
to authenticated
using (
  exists (
    select 1 from public.reading_submissions rs
    where rs.id = quiz_answers.submission_id
      and rs.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.reading_submissions rs
    where rs.id = quiz_answers.submission_id
      and rs.student_id = auth.uid()
  )
);

create policy "students can delete own quiz answers"
on public.quiz_answers for delete
to authenticated
using (
  exists (
    select 1 from public.reading_submissions rs
    where rs.id = quiz_answers.submission_id
      and rs.student_id = auth.uid()
  )
);

create policy "teachers and admins can view quiz answers"
on public.quiz_answers for select
to authenticated
using (public.can_access_submission(submission_id));

create policy "teachers can create feedback for assigned submissions"
on public.teacher_feedback for insert
to authenticated
with check (
  public.is_teacher()
  and teacher_id = auth.uid()
  and public.teacher_can_access_student(student_id)
  and public.can_access_submission(submission_id)
);

create policy "feedback visible to involved users"
on public.teacher_feedback for select
to authenticated
using (
  student_id = auth.uid()
  or teacher_id = auth.uid()
  or public.is_admin()
);

create policy "users can view own messages"
on public.messages for select
to authenticated
using (recipient_id = auth.uid() or public.is_admin());

create policy "teachers can send assigned student messages"
on public.messages for insert
to authenticated
with check (
  public.is_teacher()
  and sender_id = auth.uid()
  and public.teacher_can_access_student(recipient_id)
);

create policy "users can mark own messages read"
on public.messages for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

create policy "authenticated users can view badges"
on public.badges for select
to authenticated
using (true);

create policy "teachers and admins can create badges"
on public.badges for insert
to authenticated
with check ((public.is_teacher() and created_by = auth.uid()) or public.is_admin());

create policy "students can view own awarded badges"
on public.student_badges for select
to authenticated
using (
  student_id = auth.uid()
  or public.is_admin()
  or (public.is_teacher() and public.teacher_can_access_student(student_id))
);

create policy "teachers can award assigned student badges"
on public.student_badges for insert
to authenticated
with check (
  public.is_teacher()
  and awarded_by = auth.uid()
  and public.teacher_can_access_student(student_id)
);

create policy "admins can manage student badges"
on public.student_badges for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins can view all activity logs"
on public.activity_logs for select
to authenticated
using (public.is_admin());

create policy "teachers can view assigned activity logs"
on public.activity_logs for select
to authenticated
using (
  public.is_teacher()
  and (
    actor_id = auth.uid()
    or public.teacher_can_access_student(actor_id)
  )
);

create policy "users can insert own activity logs"
on public.activity_logs for insert
to authenticated
with check (actor_id = auth.uid());

create policy "admins can insert activity logs"
on public.activity_logs for insert
to authenticated
with check (public.is_admin());

-- ============================================================
-- Source: supabase/migrations/202607170003_storage.sql
-- ============================================================

-- ReadBloom Storage buckets and policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'avatars',
    'avatars',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'reading-videos',
    'reading-videos',
    false,
    314572800,
    array['video/webm', 'video/mp4', 'video/quicktime']
  ),
  (
    'reading-audio',
    'reading-audio',
    false,
    104857600,
    array['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/wav', 'audio/webm']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users can upload own avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can update own avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can view own avatar"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or public.teacher_can_access_student(((storage.foldername(name))[1])::uuid)
  )
);

create policy "students can upload own reading videos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reading-videos'
  and public.is_student()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "students can view own reading videos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'reading-videos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or public.teacher_can_access_student(((storage.foldername(name))[1])::uuid)
  )
);

create policy "students can delete draft own reading videos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'reading-videos'
  and public.is_student()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "students can upload own reading audio"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reading-audio'
  and public.is_student()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "authorized users can view reading audio"
on storage.objects for select
to authenticated
using (
  bucket_id = 'reading-audio'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or public.teacher_can_access_student(((storage.foldername(name))[1])::uuid)
  )
);

create policy "students can delete draft own reading audio"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'reading-audio'
  and public.is_student()
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- Source: supabase/migrations/202607170004_student_skill_levels.sql
-- ============================================================

alter table public.student_profiles
add column if not exists reading_level int not null default 1 check (reading_level >= 1),
add column if not exists vocabulary_level int not null default 1 check (vocabulary_level >= 1),
add column if not exists word_master_level int not null default 1 check (word_master_level >= 1),
add column if not exists comprehension_level int not null default 1 check (comprehension_level >= 1);

-- ============================================================
-- Source: supabase/migrations/202607250001_transcript_suggested_remarks.sql
-- ============================================================

alter table public.transcript_results
add column if not exists suggested_remarks_json jsonb,
add column if not exists suggested_omission_count int not null default 0,
add column if not exists suggested_repetition_count int not null default 0,
add column if not exists suggested_self_correction_count int not null default 0,
add column if not exists suggested_mispronunciation_count int not null default 0;

-- ============================================================
-- Source: supabase/seed.sql
-- ============================================================

-- ReadBloom local development seed data.
-- Password for seeded users: ReadBloom123!
--
-- In a hosted Supabase project, prefer creating real users through the
-- admin-create-user Edge Function. This seed is intended for local reset/dev.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'admin@readbloom.local',
    crypt('ReadBloom123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"ReadBloom Admin"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'teacher@readbloom.local',
    crypt('ReadBloom123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ana Mirandilla"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'kai@readbloom.local',
    crypt('ReadBloom123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Kai Adamson"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'kira@readbloom.local',
    crypt('ReadBloom123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Kira Jhonson"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.schools (id, name)
values
  ('01000000-0000-0000-0000-000000000001', 'Sample Primary Elementary School')
on conflict (id) do nothing;

insert into public.sections (id, school_id, grade_level, name)
values
  (
    '02000000-0000-0000-0000-000000000001',
    '01000000-0000-0000-0000-000000000001',
    'Grade 4',
    'Mabini'
  ),
  (
    '02000000-0000-0000-0000-000000000002',
    '01000000-0000-0000-0000-000000000001',
    'Grade 5',
    'Bonifacio'
  ),
  (
    '02000000-0000-0000-0000-000000000003',
    '01000000-0000-0000-0000-000000000001',
    'Grade 6',
    'Rizal'
  )
on conflict (id) do nothing;

insert into public.profiles (id, role, email, full_name, status)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'admin',
    'admin@readbloom.local',
    'ReadBloom Admin',
    'active'
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    'teacher',
    'teacher@readbloom.local',
    'Ana Mirandilla',
    'active'
  ),
  (
    '30000000-0000-0000-0000-000000000001',
    'student',
    'kai@readbloom.local',
    'Kai Adamson',
    'active'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'student',
    'kira@readbloom.local',
    'Kira Jhonson',
    'active'
  )
on conflict (id) do update set
  role = excluded.role,
  email = excluded.email,
  full_name = excluded.full_name,
  status = excluded.status;

insert into public.teacher_profiles (profile_id, employee_number, school_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'T-0001',
    '01000000-0000-0000-0000-000000000001'
  )
on conflict (profile_id) do nothing;

insert into public.teacher_sections (teacher_id, section_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '02000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    '02000000-0000-0000-0000-000000000002'
  )
on conflict do nothing;

insert into public.student_profiles (
  profile_id,
  student_number,
  grade_level,
  section_id,
  current_skill_level,
  days_streak,
  last_login_date
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    'S-0001',
    'Grade 4',
    '02000000-0000-0000-0000-000000000001',
    'Reading Explorer',
    7,
    current_date
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'S-0002',
    'Grade 4',
    '02000000-0000-0000-0000-000000000001',
    'Growing Reader',
    3,
    current_date
  )
on conflict (profile_id) do nothing;

insert into public.safety_agreements (id, version, title, body, is_active)
values (
  '03000000-0000-0000-0000-000000000001',
  '2026-07-v1',
  'ReadBloom Safety Agreement',
  'I agree to use ReadBloom for reading practice and understand that my reading video and audio will be reviewed by my teacher.',
  true
)
on conflict (version) do update set
  title = excluded.title,
  body = excluded.body,
  is_active = excluded.is_active;

insert into public.books (
  id,
  created_by,
  section_id,
  grade_level,
  title,
  passage_text,
  status
)
values
  (
    '04000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '02000000-0000-0000-0000-000000000001',
    'Grade 4',
    'The Two Best Friends',
    'Once there were two friends a squirrel and a puppy. They used to live and play together. The squirrel was very sporty and always won the game. The puppy used to feel bad and thought that it was of no use. One day, it started raining heavily. The squirrel was in high spirits. He started doing antics but suddenly lost his balance and fell in the rain water. He called his friend, the puppy for help. The puppy came to his rescue. The squirrel climbed on its back and reached a safe place. He thanked his friend for saving his life.',
    'published'
  ),
  (
    '04000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '02000000-0000-0000-0000-000000000002',
    'Grade 5',
    'Space Exploration',
    'Human beings have always looked up at the stars and wondered. Space exploration began in the mid twentieth century. Today, robotic rovers explore Mars and astronomers look for distant habitable planets.',
    'published'
  )
on conflict (id) do update set
  title = excluded.title,
  passage_text = excluded.passage_text,
  status = excluded.status;

insert into public.book_questions (
  id,
  book_id,
  question_text,
  options,
  correct_option_index,
  sort_order
)
values
  (
    '05000000-0000-0000-0000-000000000001',
    '04000000-0000-0000-0000-000000000001',
    'Who are the two best friends in the story?',
    '["Squirrel and Puppy", "Cat and Donkey", "Turtle and Rabbit"]'::jsonb,
    0,
    1
  ),
  (
    '05000000-0000-0000-0000-000000000002',
    '04000000-0000-0000-0000-000000000001',
    'Which animal fell in the rain water and needed rescue?',
    '["Puppy", "Cat", "Squirrel", "Turtle"]'::jsonb,
    2,
    2
  ),
  (
    '05000000-0000-0000-0000-000000000003',
    '04000000-0000-0000-0000-000000000002',
    'What do robotic rovers explore?',
    '["Mars", "The ocean", "Forests", "Clouds"]'::jsonb,
    0,
    1
  )
on conflict (id) do nothing;

insert into public.badges (id, name, description, created_by)
values
  (
    '06000000-0000-0000-0000-000000000001',
    'Growing Reader',
    'Awarded for steady reading progress.',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    '06000000-0000-0000-0000-000000000002',
    'Try Hard',
    'Awarded for consistent effort.',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    '06000000-0000-0000-0000-000000000003',
    'Keep Going',
    'Awarded for completing reading practice.',
    '20000000-0000-0000-0000-000000000001'
  )
on conflict (id) do nothing;

insert into public.student_badges (student_id, badge_id, awarded_by)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '06000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001'
  ),
  (
    '30000000-0000-0000-0000-000000000001',
    '06000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001'
  )
on conflict do nothing;

insert into public.activity_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'teacher',
    'teacher.created_book',
    'book',
    '04000000-0000-0000-0000-000000000001',
    '{"seed":true}'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000001',
    'student',
    'student.logged_in',
    'profile',
    '30000000-0000-0000-0000-000000000001',
    '{"seed":true}'::jsonb
  );

