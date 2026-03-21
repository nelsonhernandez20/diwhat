"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignOut() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();
    setLoading(false);
    if (signOutError) {
      setError(signOutError.message);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onSignOut}
        disabled={loading}
        className="rounded-full border border-brand-border bg-white px-3 py-1.5 text-xs font-semibold text-brand-text shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
      >
        {loading ? "Cerrando…" : "Cerrar sesión"}
      </button>
      {error ? <p className="max-w-xs text-right text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
