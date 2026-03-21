-- Diwhat: multi-tenant inbox + WhatsApp (worker usa service role para inserts inbound)

create extension if not exists "pgcrypto";

-- Perfiles (email para invitaciones)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'employee')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'employee')) default 'employee',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index organization_invitations_token_idx on public.organization_invitations (token);

create table public.whatsapp_sessions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'qr', 'connected', 'error')),
  qr_payload text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  wa_chat_id text not null,
  customer_label text,
  last_message_at timestamptz not null default now(),
  unique (organization_id, wa_chat_id)
);

create index conversations_org_idx on public.conversations (organization_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  wa_message_id text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  sender_user_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- --- Funciones RLS ---

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- Sincronizar perfil al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- RLS ---

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- profiles
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- organizations
create policy "orgs_select_member"
  on public.organizations for select
  using (public.is_org_member(id));

-- members
create policy "members_select_same_org"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy "members_insert_admin"
  on public.organization_members for insert
  with check (public.is_org_admin(organization_id));

create policy "members_delete_admin"
  on public.organization_members for delete
  using (public.is_org_admin(organization_id));

-- invitations
create policy "invites_select_admin"
  on public.organization_invitations for select
  using (public.is_org_admin(organization_id));

create policy "invites_insert_admin"
  on public.organization_invitations for insert
  with check (public.is_org_admin(organization_id));

create policy "invites_delete_admin"
  on public.organization_invitations for delete
  using (public.is_org_admin(organization_id));

-- whatsapp_sessions (todos los miembros leen; admin puede “tocar” desde app con política amplia)
create policy "wa_sessions_select_member"
  on public.whatsapp_sessions for select
  using (public.is_org_member(organization_id));

create policy "wa_sessions_upsert_admin"
  on public.whatsapp_sessions for insert
  with check (public.is_org_admin(organization_id));

create policy "wa_sessions_update_admin"
  on public.whatsapp_sessions for update
  using (public.is_org_admin(organization_id));

-- conversations
create policy "conv_select_member"
  on public.conversations for select
  using (public.is_org_member(organization_id));

create policy "conv_insert_member"
  on public.conversations for insert
  with check (public.is_org_member(organization_id));

create policy "conv_update_member"
  on public.conversations for update
  using (public.is_org_member(organization_id));

-- messages
create policy "msg_select_member"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_org_member(c.organization_id)
    )
  );

create policy "msg_insert_member"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and public.is_org_member(c.organization_id)
    )
    and (
      direction = 'outbound'
      and sender_user_id = auth.uid()
    )
  );

-- El worker (service role) no usa RLS.

-- Tras crear org, el primer miembro debe ser owner: lo hace la app con RPC o dos pasos.
-- Función: crear organización y membresía owner en una transacción
create or replace function public.create_organization_with_owner(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations (name)
  values (p_name)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, auth.uid(), 'owner');

  insert into public.whatsapp_sessions (organization_id, status)
  values (v_org, 'disconnected')
  on conflict (organization_id) do nothing;

  return v_org;
end;
$$;

grant execute on function public.create_organization_with_owner(text) to authenticated;

-- Aceptar invitación por token (email debe coincidir)
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.organization_invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  select * into v_inv
  from public.organization_invitations
  where token = p_token
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'invalid_or_expired_invitation';
  end if;

  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'email_mismatch';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_inv.organization_id, auth.uid(), v_inv.role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role;

  delete from public.organization_invitations where id = v_inv.id;

  return v_inv.organization_id;
end;
$$;

grant execute on function public.accept_invitation(text) to authenticated;

-- Vista previa de invitación (org + email) sin filtrar por token en políticas
create or replace function public.peek_invitation(p_token text)
returns table (organization_name text, invite_email text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select o.name, i.email, i.role
  from public.organization_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token
    and i.expires_at > now()
  limit 1;
end;
$$;

grant execute on function public.peek_invitation(text) to anon, authenticated;

create policy "invites_select_by_token_holder"
  on public.organization_invitations for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(p.email) = lower(organization_invitations.email)
    )
    and expires_at > now()
  );
