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
