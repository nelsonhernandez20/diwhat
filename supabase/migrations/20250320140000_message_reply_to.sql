-- Respuesta citada (reply) en el hilo
alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages (id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

comment on column public.messages.reply_to_message_id is 'Mensaje al que responde esta burbuja (UI + cita WA si aplica)';
