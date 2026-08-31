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

