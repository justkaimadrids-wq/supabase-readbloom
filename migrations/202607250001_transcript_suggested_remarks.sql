alter table public.transcript_results
add column if not exists suggested_remarks_json jsonb,
add column if not exists suggested_omission_count int not null default 0,
add column if not exists suggested_repetition_count int not null default 0,
add column if not exists suggested_self_correction_count int not null default 0,
add column if not exists suggested_mispronunciation_count int not null default 0;
