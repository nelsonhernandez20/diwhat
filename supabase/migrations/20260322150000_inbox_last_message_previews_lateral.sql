-- Evita timeouts: la versión con DISTINCT ON + ANY(array) puede escanear todos los
-- mensajes de cientos de chats a la vez. LATERAL hace un índice (conversation_id, created_at)
-- por conversación: O(conversaciones en el chunk), no O(mensajes totales).

create or replace function public.inbox_last_message_previews(
  p_org_id uuid,
  p_conversation_ids uuid[]
)
returns table (conversation_id uuid, body text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
    lm.body
  from unnest(p_conversation_ids) as u(cid)
  inner join public.conversations c
    on c.id = u.cid
   and c.organization_id = p_org_id
  cross join lateral (
    select m.body
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm
  where public.is_org_member(p_org_id);
$$;

comment on function public.inbox_last_message_previews(uuid, uuid[]) is
  'Último body por conversación (LATERAL + índice); bandeja inbox.';
