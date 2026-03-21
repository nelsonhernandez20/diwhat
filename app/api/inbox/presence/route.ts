import { requireOrgMember } from "@/lib/auth/org";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { orgId?: string } | null;
    const orgId = body?.orgId?.trim();
    if (!orgId) {
      return NextResponse.json({ error: "orgId requerido" }, { status: 400 });
    }

    const { supabase, user } = await requireOrgMember(orgId);
    const { error } = await supabase.from("organization_web_presence").upsert(
      {
        organization_id: orgId,
        last_seen_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "organization_id" },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
