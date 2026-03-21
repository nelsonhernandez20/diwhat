import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";

export type OrgRole = "owner" | "admin" | "employee";

export function isProfileTrialActive(trialEndsAt: string | null | undefined): boolean {
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Acceso al producto: perfil con trial_ends_at futuro (activado manualmente, p. ej. 7 días). */
export async function requireProductAccess() {
  const ctx = await requireUser();
  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("trial_ends_at")
    .eq("id", ctx.user.id)
    .maybeSingle();

  if (isProfileTrialActive(profile?.trial_ends_at ?? null)) {
    return ctx;
  }

  const reason = profile?.trial_ends_at ? "expired" : "pending";
  redirect(`/access-pending?reason=${reason}`);
}

/** Para route handlers: 403 si no hay trial activo. */
export async function requireProductAccessApi(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: 403 }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("trial_ends_at")
    .eq("id", userId)
    .maybeSingle();

  if (isProfileTrialActive(profile?.trial_ends_at ?? null)) {
    return { ok: true };
  }
  return { ok: false, status: 403 };
}

export async function requireOrgMember(orgId: string) {
  const { supabase, user } = await requireProductAccess();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) notFound();
  return { supabase, user, role: data.role as OrgRole };
}

export async function requireOrgAdmin(orgId: string) {
  const ctx = await requireOrgMember(orgId);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  return ctx;
}
