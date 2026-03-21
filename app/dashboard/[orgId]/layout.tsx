import { requireOrgMember } from "@/lib/auth/org";
import Link from "next/link";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { role } = await requireOrgMember(orgId);
  const isAdmin = role === "owner" || role === "admin";

  return (
    <div className="min-h-full bg-brand-bg text-brand-text">
      <header className="border-b border-black/[0.06] bg-white">
        <div className="flex w-full flex-wrap items-center gap-2 px-4 py-3 md:px-6">
          <Link
            className="text-sm font-medium text-brand-muted hover:text-brand-primary"
            href="/dashboard"
          >
            Negocios
          </Link>
          <span className="text-brand-border">/</span>
          <nav className="flex flex-wrap gap-1 text-sm sm:gap-2">
            <Link
              className="rounded-full px-3 py-1.5 font-medium text-brand-text hover:bg-brand-hover"
              href={`/dashboard/${orgId}`}
            >
              Resumen
            </Link>
            <Link
              className="rounded-full px-3 py-1.5 font-medium text-brand-text hover:bg-brand-hover"
              href={`/dashboard/${orgId}/inbox`}
            >
              Bandeja
            </Link>
            {isAdmin ? (
              <>
                <Link
                  className="rounded-full px-3 py-1.5 font-medium text-brand-text hover:bg-brand-hover"
                  href={`/dashboard/${orgId}/team`}
                >
                  Equipo
                </Link>
                <Link
                  className="rounded-full px-3 py-1.5 font-medium text-brand-text hover:bg-brand-hover"
                  href={`/dashboard/${orgId}/whatsapp`}
                >
                  WhatsApp
                </Link>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <div className="w-full">{children}</div>
    </div>
  );
}
