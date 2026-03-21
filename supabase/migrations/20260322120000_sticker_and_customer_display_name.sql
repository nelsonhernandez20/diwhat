-- Parte 1/2: nombre visible opcional (tabla pequeña, lock breve).
-- Si hubo deadlock antes, ejecuta solo esta parte y luego la migración 20260322120100.

alter table public.conversations
  add column if not exists customer_display_name text;

comment on column public.conversations.customer_display_name is
  'Nombre visible opcional definido en Diwhat; si no es null, tiene prioridad sobre customer_label (sync WhatsApp).';
