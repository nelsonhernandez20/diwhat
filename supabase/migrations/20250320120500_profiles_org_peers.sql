-- Permitir ver perfiles de compañeros del mismo negocio (nombres en el hilo)
create policy "profiles_select_org_peers"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.organization_members m_self
      join public.organization_members m_peer
        on m_peer.organization_id = m_self.organization_id
      where m_self.user_id = auth.uid()
        and m_peer.user_id = public.profiles.id
    )
  );
