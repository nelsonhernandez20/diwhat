"use server";

import { requireOrgMember } from "@/lib/auth/org";
import { revalidatePath } from "next/cache";

export async function updateConversationDisplayName(input: {
  orgId: string;
  conversationId: string;
  /** null o string vacío = quitar nombre manual */
  customerDisplayName: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireOrgMember(input.orgId);
  const raw = input.customerDisplayName?.trim();
  const value = raw && raw.length > 0 ? raw : null;

  const { error } = await supabase
    .from("conversations")
    .update({ customer_display_name: value })
    .eq("id", input.conversationId)
    .eq("organization_id", input.orgId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/${input.orgId}/inbox`);
  revalidatePath(`/dashboard/${input.orgId}/inbox/${input.conversationId}`);
  return { ok: true };
}
