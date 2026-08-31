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

