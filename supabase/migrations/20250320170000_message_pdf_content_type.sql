-- PDF en mensajes (documentMessage application/pdf)
alter table public.messages drop constraint if exists messages_content_type_check;

alter table public.messages
  add constraint messages_content_type_check
  check (content_type in ('text', 'audio', 'image', 'pdf'));

comment on column public.messages.content_type is 'text | audio | image | pdf';
