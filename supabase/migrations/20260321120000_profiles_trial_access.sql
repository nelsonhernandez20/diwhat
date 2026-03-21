-- Periodo de prueba: solo personal interno (SQL / service role) puede fijar trial_ends_at.
-- Acceso al producto: trial_ends_at IS NOT NULL AND trial_ends_at > now()

alter table public.profiles
  add column if not exists trial_ends_at timestamptz;

comment on column public.profiles.trial_ends_at is
  'Fin del periodo de prueba. NULL = sin acceso hasta activación manual (p. ej. 7 días desde ventas).';

create or replace function public.profiles_lock_trial_ends_at_for_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update'
     and new.trial_ends_at is distinct from old.trial_ends_at
     and auth.uid() is not null
     and auth.uid() = new.id
  then
    new.trial_ends_at := old.trial_ends_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_trial_ends_at on public.profiles;
create trigger profiles_lock_trial_ends_at
  before update on public.profiles
  for each row
  execute procedure public.profiles_lock_trial_ends_at_for_self_update();

-- Activación manual (7 días desde ahora), ej. tras hablar con ventas:
-- update public.profiles
--   set trial_ends_at = now() + interval '7 days'
--   where id = '<uuid auth.users>';
