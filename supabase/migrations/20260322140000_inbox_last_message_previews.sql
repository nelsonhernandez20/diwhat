-- Un round-trip para previews de bandeja: último mensaje por conversación (evita N consultas desde el cliente).

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
  select distinct on (m.conversation_id)
    m.conversation_id,
    m.body
  from public.messages m
  inner join public.conversations c on c.id = m.conversation_id
  where public.is_org_member(p_org_id)
    and c.organization_id = p_org_id
    and m.conversation_id = any(p_conversation_ids)
  order by m.conversation_id, m.created_at desc;
$$;

comment on function public.inbox_last_message_previews(uuid, uuid[]) is
  'Último body de mensaje por conversación para la bandeja; respeta membresía de org.';

grant execute on function public.inbox_last_message_previews(uuid, uuid[]) to authenticated;
