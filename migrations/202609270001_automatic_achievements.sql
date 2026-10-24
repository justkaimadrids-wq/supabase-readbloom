-- Migration: 202609270001_automatic_achievements.sql
-- Description: Seed 10 sequential achievement badges, allow students to earn badges and update their skill level, and award the starting badge to all student profiles.

-- 1. Insert the 10 official achievement badges if not already present
insert into public.badges (name, description)
values
  ('📖 Reading Explorer', 'Starting achievement for all students exploring reading.'),
  ('🌟 Reading Star', 'Awarded for passing 1 reading quiz with at most 1 mistake.'),
  ('🏆 Reading Champion', 'Awarded for passing 2 distinct reading quizzes with at most 1 mistake.'),
  ('🔍 Word Detective', 'Awarded for passing 3 distinct reading quizzes with at most 1 mistake.'),
  ('🧠 Vocabulary Builder', 'Awarded for passing 4 distinct reading quizzes with at most 1 mistake.'),
  ('👑 Word Master', 'Awarded for passing 5 distinct reading quizzes with at most 1 mistake.'),
  ('💡 Story Thinker', 'Awarded for passing 6 distinct reading quizzes with at most 1 mistake.'),
  ('🔎 Reading Detective', 'Awarded for passing 7 distinct reading quizzes with at most 1 mistake.'),
  ('🏅 Comprehension Wonderer', 'Awarded for passing 8 distinct reading quizzes with at most 1 mistake.'),
  ('✨ Word Wizard', 'Awarded for passing 9 or more distinct reading quizzes with at most 1 mistake.')
on conflict (name) do nothing;

-- 2. Award the starting badge '📖 Reading Explorer' to all existing student profiles
insert into public.student_badges (student_id, badge_id)
select sp.profile_id, b.id
from public.student_profiles sp
cross join public.badges b
where b.name = '📖 Reading Explorer'
on conflict (student_id, badge_id) do nothing;

-- 3. RLS Policies: Allow students to update their own skill level upon earning achievements
drop policy if exists "students can update own skill level" on public.student_profiles;
create policy "students can update own skill level"
on public.student_profiles for update
to authenticated
using (profile_id = auth.uid() and public.is_student())
with check (profile_id = auth.uid() and public.is_student());

-- 4. RLS Policies: Allow students to record their own earned badges
drop policy if exists "students can record own earned badges" on public.student_badges;
create policy "students can record own earned badges"
on public.student_badges for insert
to authenticated
with check (student_id = auth.uid() and public.is_student());

-- 5. RLS Policies: Allow creation of missing achievement badges if needed
drop policy if exists "authenticated users can create achievement badges" on public.badges;
create policy "authenticated users can create achievement badges"
on public.badges for insert
to authenticated
with check (true);
