"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const origin = window.location.origin;
    const nextPath = next && next.startsWith("/") ? next : "/dashboard";
    const { error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    setInfo(
      "Revisa tu correo para confirmar la cuenta (si tienes confirmación activada en Supabase).",
    );
    router.refresh();
  }

  const inputClass =
    "rounded-xl border border-brand-border bg-[#f6f8fa] px-3 py-2.5 text-base text-brand-text outline-none ring-brand-primary/25 placeholder:text-brand-muted focus:border-brand-primary focus:ring-2";

  return (
    <div className="flex min-h-dvh flex-col bg-brand-chat px-4 py-10 md:px-6 md:py-16">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="rounded-2xl border border-brand-border bg-white p-6 shadow-[0_1px_3px_rgba(0,32,66,0.06)] md:p-8">
          <Link
            className="text-sm font-semibold text-brand-text transition hover:text-brand-primary"
            href="/"
          >
            Diwhat
          </Link>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-brand-text">Crear cuenta</h1>
          <p className="mt-2 text-sm text-brand-muted">
            ¿Ya tienes cuenta?{" "}
            <Link className="font-semibold text-brand-primary hover:underline" href="/login">
              Entrar
            </Link>
          </p>
          <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-text">
              Nombre visible
              <input
                className={inputClass}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej. Ana"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-text">
              Email
              <input
                required
                autoComplete="email"
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-text">
              Contraseña
              <input
                required
                minLength={6}
                autoComplete="new-password"
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error ? (
              <p
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {info ? (
              <p
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                role="status"
              >
                {info}
              </p>
            ) : null}
            <button className="btn-brand w-full" disabled={loading} type="submit">
              {loading ? "Creando…" : "Registrarse"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
