-- Mensajes de voz: tipo + ruta en Storage (bucket público; nombres con UUID).
alter table public.messages
  add column if not exists content_type text not null default 'text'
    check (content_type in ('text', 'audio'));

alter table public.messages
  add column if not exists media_path text;

comment on column public.messages.content_type is 'text | audio';
comment on column public.messages.media_path is 'Ruta en bucket message_media, p.ej. {org_id}/{uuid}.ogg';

insert into storage.buckets (id, name, public, file_size_limit)
values ('message_media', 'message_media', true, 26214400)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Subida solo por miembros de la org (primer segmento del path = organization_id).
create policy "message_media_insert_org_member"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message_media'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id::text = split_part(name, '/', 1)
    )
  );

create policy "message_media_update_org_member"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'message_media'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id::text = split_part(name, '/', 1)
    )
  );

create policy "message_media_delete_org_member"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'message_media'
    and exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.organization_id::text = split_part(name, '/', 1)
    )
  );
