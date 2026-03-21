"use client";

import { acceptInvitation } from "@/lib/actions/team";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setError(null);
    setLoading(true);
    try {
      const orgId = await acceptInvitation(token);
      router.push(`/dashboard/${orgId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aceptar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        disabled={loading}
        type="button"
        onClick={onAccept}
      >
        {loading ? "Uniendo…" : "Aceptar invitación"}
      </button>
      {error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
