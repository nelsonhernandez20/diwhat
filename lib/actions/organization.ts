"use server";

import { requireProductAccess } from "@/lib/auth/org";
import { revalidatePath } from "next/cache";

export async function createOrganization(name: string) {
  const { supabase } = await requireProductAccess();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nombre requerido");

  const { data, error } = await supabase.rpc("create_organization_with_owner", {
    p_name: trimmed,
  });

  if (error) throw new Error(error.message);
  const orgId = data as string;
  revalidatePath("/dashboard");
  return orgId;
}
