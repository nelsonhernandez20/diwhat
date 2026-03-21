-- Estado de lectura simple para bandeja (no leído/leído).
alter table public.conversations
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_read_at timestamptz;

comment on column public.conversations.last_inbound_at is
  'Timestamp del último mensaje inbound público recibido en el chat.';

comment on column public.conversations.last_read_at is
  'Última vez que un usuario abrió el chat desde la web (estado leído en bandeja).';
