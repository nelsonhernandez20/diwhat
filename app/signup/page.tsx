import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-brand-chat px-6 text-sm text-brand-muted">
          Cargando…
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
