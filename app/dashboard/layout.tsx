import { SignOutButton } from "@/components/sign-out-button";
import { requireProductAccess } from "@/lib/auth/org";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProductAccess();
  return (
    <div className="flex min-h-dvh flex-col bg-brand-bg text-brand-text">
      <header className="shrink-0 border-b border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link
            className="text-sm font-semibold text-brand-text transition hover:text-brand-primary"
            href="/dashboard"
          >
            Diwhat
          </Link>
          <SignOutButton />
        </div>
      </header>
      <div className="flex-1 bg-brand-chat">{children}</div>
    </div>
  );
}
