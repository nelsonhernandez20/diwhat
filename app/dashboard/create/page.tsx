import { createOrganization } from "@/lib/actions/organization";
import Link from "next/link";
import { redirect } from "next/navigation";

export default function CreateOrgPage() {
  async function action(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    const orgId = await createOrganization(name);
    redirect(`/dashboard/${orgId}`);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8 md:px-6 md:py-12">
      <div className="rounded-2xl border border-brand-border bg-white p-6 shadow-[0_1px_3px_rgba(0,32,66,0.06)] md:p-8">
        <Link
          className="text-sm font-medium text-brand-muted transition hover:text-brand-primary"
          href="/dashboard"
        >
          ← Volver
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-brand-text">Nuevo negocio</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Serás el propietario (<code className="rounded bg-brand-chat px-1 py-0.5 text-xs text-brand-text">owner</code>) de
          este espacio.
        </p>
        <form className="mt-8 flex flex-col gap-4" action={action}>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-brand-text">
            Nombre del negocio
            <input
              required
              name="name"
              className="rounded-xl border border-brand-border bg-[#f6f8fa] px-3 py-2.5 text-brand-text outline-none ring-brand-primary/25 placeholder:text-brand-muted focus:border-brand-primary focus:ring-2"
              placeholder="Ej. Cafetería Central"
            />
          </label>
          <button className="btn-brand w-full sm:w-auto" type="submit">
            Crear
          </button>
        </form>
      </div>
    </div>
  );
}
