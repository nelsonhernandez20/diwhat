import { requireOrgAdmin } from "@/lib/auth/org";
import { WhatsAppConnect } from "@/components/whatsapp-connect";

export default async function WhatsAppPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgAdmin(orgId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-brand-text md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
      <p className="mt-1 text-sm text-brand-muted">
        Inicia el worker local, pulsa el botón y escanea el QR. Los mensajes entrantes aparecerán en
        la bandeja.
      </p>
      <div className="mt-8">
        <WhatsAppConnect orgId={orgId} />
      </div>
    </div>
  );
}
