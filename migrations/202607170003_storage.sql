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

