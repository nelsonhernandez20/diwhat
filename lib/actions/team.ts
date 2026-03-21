"use server";

import { sendInviteEmail, isSmtpConfigured } from "@/lib/email/smtp";
import { requireOrgAdmin, requireUser } from "@/lib/auth/org";
import { getSiteBaseUrl } from "@/lib/site-url";
import { revalidatePath } from "next/cache";

export type InviteMailFailure = "no_site_url" | "no_smtp" | "smtp_send";

export type InviteMemberResult = {
  token: string;
  emailSent: boolean;
  /** Si `emailSent` es false, indica el motivo (para mostrar en UI). */
  mailFailure?: InviteMailFailure;
};

export async function inviteMember(
  orgId: string,
  email: string,
  role: "admin" | "employee",
): Promise<InviteMemberResult> {
  const { supabase, user } = await requireOrgAdmin(orgId);
  const clean = email.trim().toLowerCase();
  if (!clean) throw new Error("Email requerido");

  const { data, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: orgId,
      email: clean,
      role,
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (error) throw new Error(error.message);
  const token = data?.token;
  if (!token) throw new Error("No se obtuvo token de invitación");

  revalidatePath(`/dashboard/${orgId}/team`);

  let emailSent = false;
  let mailFailure: InviteMailFailure | undefined;
  const base = getSiteBaseUrl();

  if (!base) {
    mailFailure = "no_site_url";
  } else if (!isSmtpConfigured()) {
    mailFailure = "no_smtp";
  } else {
    const { data: org } = await supabase.from("organizations").select("name").eq("id", orgId).single();
    const orgName = org?.name ?? "tu negocio";
    const roleLabel = role === "admin" ? "Administrador" : "Empleado";
    const inviteUrl = `${base}/join/${token}`;
    try {
      await sendInviteEmail({
        to: clean,
        inviteUrl,
        orgName,
        roleLabel,
      });
      emailSent = true;
    } catch (e) {
      mailFailure = "smtp_send";
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[inviteMember] envío SMTP falló:", msg, e);
    }
  }

  return { token, emailSent, mailFailure };
}

export async function acceptInvitation(token: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  const orgId = data as string;
  revalidatePath("/dashboard");
  return orgId;
}
