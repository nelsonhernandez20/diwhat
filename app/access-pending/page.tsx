import { SignOutButton } from "@/components/sign-out-button";
import { isProfileTrialActive, requireUser } from "@/lib/auth/org";
import { SALES_WHATSAPP_URL, TRIAL_DAYS } from "@/lib/sales";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Acceso pendiente — Diwhat",
  description: "Activa tu periodo de prueba con el equipo de ventas.",
};

type Props = { searchParams: Promise<{ reason?: string }> };

export default async function AccessPendingPage({ searchParams }: Props) {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("trial_ends_at")
    .eq("id", user.id)
    .maybeSingle();
  if (isProfileTrialActive(profile?.trial_ends_at ?? null)) {
    redirect("/dashboard");
  }

  const { reason } = await searchParams;
  const expired = reason === "expired";

  return (
    <div className="flex min-h-dvh flex-col bg-brand-chat">
      <header className="border-b border-black/6 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link
            className="text-sm font-semibold text-brand-text hover:text-brand-primary"
            href="/"
          >
            Diwhat
          </Link>
          <SignOutButton />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
        <div className="w-full max-w-lg rounded-2xl border border-brand-border bg-white p-6 shadow-[0_1px_3px_rgba(0,32,66,0.06)] md:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-brand-text">
            {expired ? "Tu periodo de prueba terminó" : "Activa tu acceso a Diwhat"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-brand-muted">
            {expired ? (
              <>
                El acceso de prueba ya no está disponible. Si quieres seguir usando Diwhat, escríbenos
                por WhatsApp y te ayudamos con un nuevo plan o extensión.
              </>
            ) : (
              <>
                Tras registrarte, el producto queda en espera hasta que ventas active tu cuenta. Ofrecemos{" "}
                <strong className="text-brand-text">{TRIAL_DAYS} días de prueba</strong> una vez
                habilitado el acceso. Para obtener el periodo de prueba, debes{" "}
                <strong className="text-brand-text">contactar a ventas por WhatsApp</strong>.
              </>
            )}
          </p>

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">¿Cómo activo los {TRIAL_DAYS} días?</p>
            <p className="mt-1 text-amber-900/90">
              Escríbenos a ventas; cuando validemos tu caso, activamos tu prueba desde nuestro sistema
              (no hace falta que cambies nada en la app).
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              className="btn-brand inline-flex min-h-[44px] flex-1 items-center justify-center px-6 text-center"
              href={SALES_WHATSAPP_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              Hablar con Ventas (WhatsApp)
            </a>
            <Link
              className="btn-brand-outline inline-flex min-h-[44px] flex-1 items-center justify-center px-6 text-center"
              href="/"
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
