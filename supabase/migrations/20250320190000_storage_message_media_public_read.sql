-- Bucket `message_media` es público; sin política SELECT, RLS puede bloquear las URLs en el navegador.
drop policy if exists "message_media_select_public" on storage.objects;

create policy "message_media_select_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'message_media');
