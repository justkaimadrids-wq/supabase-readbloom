# ReadBloom Supabase Backend

This folder contains the Phase 2 backend foundation for the three ReadBloom Flutter apps.

## Contents

- `migrations/202607170001_initial_schema.sql`
  - Creates the relational schema for profiles, sections, books, quizzes, submissions, transcripts, feedback, messages, badges, safety agreements, and activity logs.
- `migrations/202607170002_rls_policies.sql`
  - Enables Row Level Security and adds student/teacher/admin data-access policies.
- `migrations/202607170003_storage.sql`
  - Creates private Storage buckets and policies for avatars, reading videos, and reading audio.
- `migrations/202607170004_student_skill_levels.sql`
  - Adds numeric student skill levels for reading, vocabulary, word master, and comprehension.
- `migrations/202607250001_transcript_suggested_remarks.sql`
  - Adds transcript suggested-remark JSON and summary counts for omission, repetition, self-correction, and possible mispronunciation.
- `seed.sql`
  - Adds local development seed data.
- `functions/process-reading-submission`
  - Supabase Edge Function for Phase 7 speech-to-text processing with Google AI Studio/Gemini.
- `functions/generate-book-content`
  - Supabase Edge Function for AI-assisted teacher book draft generation with active-teacher and assigned-section validation.
- `functions/admin-create-user`
  - Supabase Edge Function for Phase 11 admin account creation with service-role Auth user creation, role-specific profile rows, section assignment, and audit logging.
- `functions/admin-delete-user`
  - Supabase Edge Function for Phase 11 student/teacher account deletion with active-admin validation and audit logging.

## Seeded Local Accounts

The seed file includes local development users with this password:

```text
ReadBloom123!
```

Seeded emails:

- `admin@readbloom.local`
- `teacher@readbloom.local`
- `kai@readbloom.local`
- `kira@readbloom.local`

For a hosted Supabase project, create users through the `admin-create-user` Edge Function or the Supabase dashboard instead of relying on seed users.

## Apply Locally

The Supabase CLI is not currently installed in this workspace. Once installed, the intended local workflow is:

```bash
supabase init
supabase start
supabase db reset
```

`supabase db reset` applies migrations and then runs `seed.sql`.

## Apply to Hosted Supabase

For a hosted project:

1. Review the migrations first.
2. Apply `202607170001_initial_schema.sql`.
3. Apply `202607170002_rls_policies.sql`.
4. Apply `202607170003_storage.sql`.
5. Apply `202607170004_student_skill_levels.sql`.
6. Apply `202607250001_transcript_suggested_remarks.sql`.
7. Deploy `admin-create-user`.
8. Create the first admin user manually in Supabase Auth and insert its matching `profiles` row with `role = 'admin'`.
9. Create student and teacher accounts from the Admin app.

Do not expose a Supabase service-role key in any Flutter app.

## Storage Path Conventions

Use these path formats:

- Avatar: `avatars/{profile_id}/{file_id}.jpg`
- Reading video: `reading-videos/{student_id}/{submission_id}/reading.webm`
- Reading audio: `reading-audio/{student_id}/{submission_id}/reading.m4a`

The first path segment must be the owner profile ID because Storage RLS policies use it for authorization.

## Edge Function Setup

Phase 7 adds `process-reading-submission`, Feature 1 adds `generate-book-content`, and Phase 11 adds `admin-create-user`.

Before deploying the function, set these Supabase Edge Function secrets:

```bash
supabase secrets set GEMINI_API_KEY=your_google_ai_studio_api_key
supabase secrets set GEMINI_MODEL=gemini-3.5-flash
supabase secrets set READBLOOM_AI_REMARK_REVIEW_ENABLED=true
```

`GEMINI_MODEL` is optional because the function defaults to `gemini-3.5-flash`.
`READBLOOM_AI_REMARK_REVIEW_ENABLED` is optional. When it is not set to `true`, reading remark suggestions use deterministic alignment only.

For larger reading recordings, `process-reading-submission` uploads the media to the Gemini File API and polls until the file becomes active before transcription. Optional tuning secrets:

```bash
supabase secrets set GEMINI_FILE_ACTIVE_MAX_ATTEMPTS=20
supabase secrets set GEMINI_FILE_ACTIVE_POLL_DELAY_MS=1500
```

Deploy the function:

```bash
supabase functions deploy process-reading-submission
supabase functions deploy generate-book-content
supabase functions deploy admin-create-user
supabase functions deploy admin-delete-user
```

The student app invokes this function after a successful reading video upload. The function validates the caller, downloads the private recording, sends smaller audio/video files inline to Gemini, uploads larger files to the Gemini File API first, stores `transcript_results`, adds suggested reading remarks from deterministic alignment, optionally asks Gemini to review those remarks when `READBLOOM_AI_REMARK_REVIEW_ENABLED=true`, updates `reading_submissions.status`, and writes an activity log.

The teacher app invokes `generate-book-content` from the Add Book form. The function validates that the caller is an active teacher assigned to the selected section, calls Gemini with a strict JSON prompt, validates the generated title, passage, questions, choices, and correct answer indexes, then returns draft content only. It does not insert books; the teacher must review and publish through the normal book creation flow so student and admin apps continue syncing from the persisted `books` and `book_questions` tables.

The admin app invokes `admin-create-user` from the Users screen. The function validates that the caller is an active admin, creates the Supabase Auth user with the service-role key, inserts `profiles` plus `student_profiles` or `teacher_profiles`/`teacher_sections`, and writes an `activity_logs` row. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Edge Function secrets; never put it in any Flutter app.

The admin app invokes `admin-delete-user` from the Users screen. The function validates that the caller is an active admin, blocks self-deletion and admin deletion, deletes the target student/teacher Auth user, and writes an `activity_logs` row.

## Phase 2 Limitations

This phase creates backend source files only. It does not yet:

- Connect Flutter apps to Supabase.
- Add Edge Functions.
- Run migrations against a live Supabase project.
- Replace mock repositories in the apps.
- Implement speech-to-text processing.

Those are later phases in `ROADMAP.md`.
