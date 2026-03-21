import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-brand-chat px-6 text-sm text-brand-muted">
          Cargando…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
