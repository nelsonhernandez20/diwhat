-- Parte 2/2: permitir content_type = sticker en mensajes.
-- Ejecutar en un momento de poco tráfico si falla por locks (Realtime, muchas lecturas).

alter table public.messages drop constraint if exists messages_content_type_check;

alter table public.messages
  add constraint messages_content_type_check
  check (content_type in ('text', 'audio', 'image', 'pdf', 'sticker'));

comment on column public.messages.content_type is 'text | audio | image | pdf | sticker';
