-- Foto de perfil de WhatsApp (preview) guardada en Storage por el worker.
alter table public.conversations
  add column if not exists wa_avatar_path text;

comment on column public.conversations.wa_avatar_path is
  'Ruta en bucket message_media (p.ej. {org_id}/wa-avatar-{uuid}.jpg), foto de perfil o de grupo WA';
