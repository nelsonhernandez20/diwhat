-- Presencia web por organización (heartbeat desde la UI) para evitar alertas email
-- cuando hay alguien con Diwhat abierto recientemente.
create table if not exists public.organization_web_presence (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.organization_web_presence enable row level security;

create policy "org_web_presence_select_member"
  on public.organization_web_presence for select
  using (public.is_org_member(organization_id));

create policy "org_web_presence_upsert_member"
  on public.organization_web_presence for insert
  with check (
    public.is_org_member(organization_id)
    and auth.uid() = updated_by
  );

create policy "org_web_presence_update_member"
  on public.organization_web_presence for update
  using (public.is_org_member(organization_id))
  with check (
    public.is_org_member(organization_id)
    and auth.uid() = updated_by
  );
