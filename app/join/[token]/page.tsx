import { createClient } from "@/lib/supabase/server";
import { AcceptInvite } from "@/components/accept-invite";
import Link from "next/link";

type PeekRow = {
  organization_name: string;
  invite_email: string;
  role: string;
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: peekRaw, error: peekErr } = await supabase.rpc("peek_invitation", {
    p_token: token,
  });

  if (peekErr) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-red-600">Error: {peekErr.message}</p>
      </div>
    );
  }

  const rows = (peekRaw ?? []) as PeekRow[];
  const row = rows[0];
  if (!row) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold">Invitación no válida</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Puede haber expirado o el enlace es incorrecto.
        </p>
        <Link className="mt-6 inline-block text-sm underline" href="/login">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Unirte al equipo</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {row.organization_name}
        </span>{" "}
        te invita como <span className="font-medium">{row.role}</span>. La cuenta debe usar el
        email <span className="font-medium">{row.invite_email}</span>.
      </p>

      {!user ? (
        <div className="mt-8 flex flex-col gap-3">
          <Link
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
          >
            Iniciar sesión para aceptar
          </Link>
          <Link
            className="text-center text-sm underline"
            href={`/signup?next=${encodeURIComponent(`/join/${token}`)}`}
          >
            Crear cuenta
          </Link>
        </div>
      ) : (
        <div className="mt-8">
          <AcceptInvite token={token} />
        </div>
      )}
    </div>
  );
}
