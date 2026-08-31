alter table public.student_profiles
add column if not exists reading_level int not null default 1 check (reading_level >= 1),
add column if not exists vocabulary_level int not null default 1 check (vocabulary_level >= 1),
add column if not exists word_master_level int not null default 1 check (word_master_level >= 1),
add column if not exists comprehension_level int not null default 1 check (comprehension_level >= 1);
