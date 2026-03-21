import { requireProductAccessApi } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const orgId = body?.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "orgId requerido" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const access = await requireProductAccessApi(supabase, user.id);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Tu periodo de prueba no está activo o expiró. Contacta a ventas." },
      { status: 403 },
    );
  }

  const { data: member, error: memErr } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!base || !secret) {
    return NextResponse.json(
      { error: "Worker no configurado en el servidor" },
      { status: 503 },
    );
  }

  const res = await fetch(`${base}/session/${orgId}/start`, {
    method: "POST",
    headers: {
      "x-worker-secret": secret,
    },
  });

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: t || "Worker rechazó la petición" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
