import { requireOrgMember } from "@/lib/auth/org";
import Link from "next/link";

export default async function OrgHomePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { supabase, role } = await requireOrgMember(orgId);

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("status")
    .eq("organization_id", orgId)
    .maybeSingle();

  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-brand-text md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{org?.name ?? "Negocio"}</h1>
      <p className="mt-1 text-sm text-brand-muted">
        Tu rol: <span className="font-semibold text-brand-text">{role}</span>
      </p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm">
          <dt className="text-xs font-bold uppercase tracking-wide text-brand-muted">WhatsApp</dt>
          <dd className="mt-2 text-lg font-semibold capitalize text-brand-text">
            {session?.status ?? "disconnected"}
          </dd>
          {isAdmin ? (
            <Link
              className="btn-brand mt-4 inline-block text-center no-underline"
              href={`/dashboard/${orgId}/whatsapp`}
            >
              Gestionar conexión
            </Link>
          ) : null}
        </div>
        <div className="rounded-2xl border border-brand-border bg-white p-5 shadow-sm">
          <dt className="text-xs font-bold uppercase tracking-wide text-brand-muted">Bandeja</dt>
          <dd className="mt-2 text-sm text-brand-muted">Chats con tus clientes.</dd>
          <Link
            className="btn-brand mt-4 inline-block text-center no-underline"
            href={`/dashboard/${orgId}/inbox`}
          >
            Abrir bandeja
          </Link>
        </div>
      </dl>
    </div>
  );
}
