-- Realtime para bandeja: el cliente recibe INSERT/UPDATE con RLS aplicada.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
