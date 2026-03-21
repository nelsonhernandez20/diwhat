import { inviteMember } from "@/lib/actions/team";
import { requireOrgAdmin } from "@/lib/auth/org";
import { getSiteBaseUrl } from "@/lib/site-url";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const sp = (await searchParams) ?? {};
  const invited = sp.invited === "1";
  const mailOk = sp.mail !== "0";
  const mailWhy = typeof sp.reason === "string" ? sp.reason : "";
  const { supabase } = await requireOrgAdmin(orgId);

  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  const ids = [...new Set((members ?? []).map((m) => m.user_id))];
  const { data: profiles } =
    ids.length > 0
      ? await supabase.from("profiles").select("id, email, display_name").in("id", ids)
      : { data: [] as { id: string; email: string | null; display_name: string | null }[] };

  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  const { data: invites } = await supabase
    .from("organization_invitations")
    .select("token, email, role, expires_at, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  async function inviteAction(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "employee") as "admin" | "employee";
    const { emailSent, mailFailure } = await inviteMember(orgId, email, role);
    const q = new URLSearchParams({ invited: "1", mail: emailSent ? "1" : "0" });
    if (!emailSent && mailFailure) q.set("reason", mailFailure);
    redirect(`/dashboard/${orgId}/team?${q.toString()}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Invita por email. La persona debe registrarse con ese email y abrir el enlace de
        invitación.
      </p>

      {invited && mailOk ? (
        <p
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
          role="status"
        >
          Invitación creada y correo enviado (revisa spam si no lo ve).
        </p>
      ) : null}
      {invited && !mailOk ? (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          {mailWhy === "no_site_url" ? (
            <>
              Invitación creada. Falta la URL del sitio en{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">.env.local</code>: añade{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">
                NEXT_PUBLIC_SITE_URL=http://localhost:3000
              </code>{" "}
              (o <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SITE_URL=…</code> solo
              servidor) y <strong>reinicia</strong>{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">npm run dev</code>. Copia el
              enlace de abajo mientras tanto.
            </>
          ) : mailWhy === "no_smtp" ? (
            <>
              Invitación creada. SMTP incompleto: define{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SMTP_HOST</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SMTP_PORT</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SMTP_USER</code> y{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SMTP_PASS</code>, reinicia Next y
              vuelve a invitar. Copia el enlace de abajo.
            </>
          ) : mailWhy === "smtp_send" ? (
            <>
              Invitación creada; el servidor no pudo enviar el correo (contraseña de aplicación, bloqueo de
              Gmail, etc.). Mira el error en la terminal donde corre{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">npm run dev</code>. Copia el
              enlace de abajo.
            </>
          ) : (
            <>
              Invitación creada, pero el correo no se envió. Revisa{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">NEXT_PUBLIC_SITE_URL</code> /{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">SITE_URL</code> y SMTP en{" "}
              <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/60">.env.local</code>, reinicia el
              dev server y vuelve a probar.
            </>
          )}
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Invitar</h2>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" action={inviteAction}>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Email
            <input
              required
              name="email"
              type="email"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
              placeholder="empleado@empresa.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rol
            <select
              name="role"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
              defaultValue="employee"
            >
              <option value="employee">Empleado</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            type="submit"
          >
            Crear invitación
          </button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Si SMTP está configurado, se envía el correo automáticamente; si no, copia el enlace de la
          tabla.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Invitaciones pendientes</h2>
        {!invites?.length ? (
          <p className="mt-2 text-sm text-zinc-500">Ninguna.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {invites.map((i) => {
              const base = getSiteBaseUrl();
              const path = `/join/${i.token}`;
              const link = base ? `${base}${path}` : path;
              return (
                <li
                  key={i.token}
                  className="flex flex-col gap-1 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="font-medium">{i.email}</span>
                  <span className="text-xs text-zinc-500">
                    Rol: {i.role} · Expira {new Date(i.expires_at).toLocaleDateString()}
                  </span>
                  <span className="break-all text-xs text-zinc-600 dark:text-zinc-400">
                    Enlace:{" "}
                    <Link className="underline" href={path}>
                      {link}
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Miembros</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {(members ?? []).map((m) => {
            const p = profileById[m.user_id];
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span>
                  {p?.display_name ?? p?.email ?? m.user_id.slice(0, 8)}
                  <span className="ml-2 text-xs text-zinc-500">{m.role}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
