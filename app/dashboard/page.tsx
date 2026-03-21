import { requireUser } from "@/lib/auth/org";
import Link from "next/link";

/** Reactivar en `true` cuando quieras mostrar de nuevo el CTA de crear negocio en el listado. */
const SHOW_CREATE_BUSINESS_BUTTON = false;

type OrgEmbed = { id: string; name: string; created_at: string };

type MembershipRow = {
  id: string;
  user_id: string;
  role: string;
  organization_id: string;
  organizations: OrgEmbed | OrgEmbed[] | null;
};

const ROLE_RANK: Record<string, number> = {
  owner: 0,
  admin: 1,
  employee: 2,
};

function dedupeByOrgId(rows: MembershipRow[]): MembershipRow[] {
  const best = new Map<string, MembershipRow>();
  for (const r of rows) {
    const prev = best.get(r.organization_id);
    if (!prev) {
      best.set(r.organization_id, r);
      continue;
    }
    const a = ROLE_RANK[r.role] ?? 99;
    const b = ROLE_RANK[prev.role] ?? 99;
    if (a < b) best.set(r.organization_id, r);
  }
  return [...best.values()];
}

function firstOrg(org: MembershipRow["organizations"]): OrgEmbed | null {
  if (!org) return null;
  return Array.isArray(org) ? (org[0] ?? null) : org;
}

export default async function DashboardPage() {
  const { supabase, user } = await requireUser();
  const { data: rows, error } = await supabase
    .from("organization_members")
    .select(
      `
      id,
      user_id,
      role,
      organization_id,
      organizations ( id, name, created_at )
    `,
    )
    .eq("user_id", user.id);

  if (error) {
    return (
      <div className="p-6 md:p-8">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Error cargando organizaciones: {error.message}
        </p>
      </div>
    );
  }

  const mine = ((rows ?? []) as MembershipRow[]).filter((m) => m.user_id === user.id);
  const list = dedupeByOrgId(mine);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-12">
      <div className="rounded-2xl border border-brand-border bg-white p-6 shadow-[0_1px_3px_rgba(0,32,66,0.06)] md:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-brand-text">Tus negocios</h1>
            <p className="mt-1 text-sm text-brand-muted">
              {SHOW_CREATE_BUSINESS_BUTTON
                ? "Elige un espacio o crea uno nuevo."
                : "Elige un espacio."}
            </p>
          </div>
          {SHOW_CREATE_BUSINESS_BUTTON ? (
            <Link className="btn-brand shrink-0 text-center" href="/dashboard/create">
              Nuevo negocio
            </Link>
          ) : null}
        </div>

        {list.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-brand-border bg-brand-bg/80 p-8 text-center">
            <p className="text-sm text-brand-muted">Aún no perteneces a ningún negocio.</p>
            <Link
              className="btn-brand-outline mt-5 inline-block"
              href="/dashboard/create"
            >
              Crear el primero
            </Link>
          </div>
        ) : (
          <ul className="mt-8 flex flex-col gap-2">
            {list.map((m) => {
              const org = firstOrg(m.organizations);
              if (!org) return null;
              return (
                <li key={m.id}>
                  <Link
                    className="flex items-center justify-between gap-3 rounded-xl border border-brand-border bg-white px-4 py-4 transition hover:border-brand-primary/30 hover:bg-brand-hover"
                    href={`/dashboard/${org.id}`}
                  >
                    <span className="font-semibold text-brand-text">{org.name}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
                      {m.role}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
