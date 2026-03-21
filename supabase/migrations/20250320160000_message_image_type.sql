-- Imágenes en mensajes (WhatsApp imageMessage)
alter table public.messages drop constraint if exists messages_content_type_check;

alter table public.messages
  add constraint messages_content_type_check
  check (content_type in ('text', 'audio', 'image'));

comment on column public.messages.content_type is 'text | audio | image';
