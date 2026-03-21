import { SALES_WHATSAPP_URL, TRIAL_DAYS } from "@/lib/sales";
import Link from "next/link";

const features = [
  {
    title: "Bandeja compartida",
    desc: "Todo tu equipo atiende WhatsApp desde una sola bandeja. Sin pelearse por el celular de la empresa.",
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
    ),
  },
  {
    title: "Notas internas",
    desc: "Coordina con tu equipo con mensajes que el cliente no ve. Contexto claro en cada conversación.",
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
  },
  {
    title: "Un WhatsApp por negocio",
    desc: "Multi-tenant: cada negocio con su espacio, su equipo y su conexión. Escala sin mezclar conversaciones.",
    icon: (
      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
  },
];

const highlights = [
  "Respuestas más rápidas con varios agentes en la misma bandeja",
  "Historial y contexto en un solo lugar",
  "Diseñado para equipos en LatAm",
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-brand-bg text-brand-text">
      <header className="sticky top-0 z-50 border-b border-black/6 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 md:px-8">
          <span className="text-lg font-bold tracking-tight text-brand-text">Diwhat</span>
          <nav className="flex shrink-0 items-center gap-2 sm:gap-3">
            <a
              className="btn-brand whitespace-nowrap px-3 py-2 text-xs sm:px-4 sm:text-sm"
              href={SALES_WHATSAPP_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              Hablar con Ventas
            </a>
            <Link
              className="btn-brand-outline whitespace-nowrap px-3 py-2 text-xs sm:px-4 sm:text-sm"
              href="/login"
            >
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(0,108,227,0.18),transparent)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 top-20 h-72 w-72 rounded-full bg-brand-primary/10 blur-3xl md:right-10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-brand-chat blur-2xl"
          />

          <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-14 md:px-8 md:pb-28 md:pt-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-primary">
                Inbox + WhatsApp para tu negocio
              </p>
              <h1 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight text-brand-text md:text-5xl md:leading-[1.08]">
                Convierte el caos de tus chats en{" "}
                <span className="bg-linear-to-r from-brand-primary to-[#0050b3] bg-clip-text text-transparent">
                  atención que vende
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-brand-muted md:text-xl">
                Centraliza WhatsApp con tu equipo, añade notas internas que el cliente no ve y deja de
                perder ventas por no responder a tiempo.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                <a
                  className="btn-brand inline-flex min-h-[48px] min-w-[200px] items-center justify-center px-8 text-base"
                  href={SALES_WHATSAPP_URL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Hablar con Ventas
                </a>
                <Link
                  className="btn-brand-outline inline-flex min-h-[48px] min-w-[160px] items-center justify-center px-8 text-base"
                  href="/signup"
                >
                  Crear cuenta
                </Link>
              </div>
              <p className="mt-4 text-sm text-brand-muted">
                ¿Ya tienes cuenta?{" "}
                <Link className="font-semibold text-brand-primary hover:underline" href="/login">
                  Iniciar sesión
                </Link>
              </p>
            </div>

            {/* Mock dashboard preview */}
            <div className="mx-auto mt-16 max-w-4xl">
              <div className="rounded-2xl border border-brand-border bg-white p-2 shadow-[0_20px_60px_-15px_rgba(0,32,66,0.15)] md:p-3">
                <div className="flex gap-2 rounded-xl bg-brand-chat/90 p-3 md:p-4">
                  <div className="hidden w-[38%] shrink-0 flex-col rounded-xl border border-brand-border bg-white p-3 shadow-sm sm:flex">
                    <div className="text-xs font-bold text-brand-text">Chats</div>
                    <div className="mt-3 space-y-2">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`rounded-lg px-2 py-2 text-xs ${i === 1 ? "bg-brand-hover" : "bg-white"}`}
                        >
                          <div className="font-semibold text-brand-text">Cliente {i}</div>
                          <div className="truncate text-brand-muted">Último mensaje…</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="min-h-[200px] flex-1 rounded-xl border border-brand-border bg-white p-4 shadow-sm md:min-h-[240px]">
                    <div className="flex items-center gap-2 border-b border-brand-border pb-3">
                      <div className="h-9 w-9 rounded-full bg-brand-primary/15 text-center text-sm font-bold leading-9 text-brand-primary">
                        C
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-brand-text">Cliente 1</div>
                        <div className="text-xs text-brand-muted">WhatsApp</div>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-brand-border bg-brand-bubble-in px-3 py-2 text-sm text-brand-text shadow-sm">
                        ¿Tienen envío a mi zona?
                      </div>
                      <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-primary px-3 py-2 text-sm text-white shadow-sm">
                        ¡Sí! Te paso el costo por interno.
                      </div>
                      <div className="max-w-[90%] rounded-lg border border-dashed border-brand-internal-border bg-brand-internal-bg px-3 py-2 text-xs text-brand-text">
                        <span className="font-semibold text-brand-muted">Nota interna · Ana</span>
                        <br />
                        Cliente VIP — aplicar descuento 10%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Periodo de prueba */}
        <section className="border-t border-brand-border bg-white py-12 md:py-16">
          <div className="mx-auto max-w-3xl px-4 md:px-8">
            <div className="rounded-2xl border border-brand-border bg-brand-chat/80 px-5 py-6 md:px-8 md:py-8">
              <h2 className="text-lg font-bold text-brand-text md:text-xl">
                Periodo de prueba de {TRIAL_DAYS} días
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-muted md:text-base">
                Puedes crear tu cuenta cuando quieras, pero el uso del producto se activa cuando el equipo
                de ventas lo habilita. Para obtener los <strong className="text-brand-text">{TRIAL_DAYS} días de prueba</strong>,{" "}
                <strong className="text-brand-text">escríbenos por WhatsApp</strong> y te damos de alta.
                Pasado el periodo de prueba, el acceso se desactiva salvo que acuerdes otro plan con nosotros.
              </p>
              <a
                className="btn-brand mt-5 inline-flex min-h-[44px] items-center justify-center px-6"
                href={SALES_WHATSAPP_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                Solicitar activación por WhatsApp
              </a>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="border-t border-brand-border bg-white py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-brand-text md:text-4xl">
                Tu centro de mando para atención y ventas
              </h2>
              <p className="mt-4 text-lg text-brand-muted">
                Herramientas pensadas para equipos que quieren responder rápido sin perder el control.
              </p>
            </div>
            <ul className="mt-14 grid gap-6 md:grid-cols-3">
              {features.map((f) => (
                <li
                  key={f.title}
                  className="group rounded-2xl border border-brand-border bg-brand-bg/50 p-6 shadow-[0_1px_3px_rgba(0,32,66,0.04)] transition hover:border-brand-primary/25 hover:shadow-[0_12px_40px_-12px_rgba(0,108,227,0.12)]"
                >
                  <div className="inline-flex rounded-xl bg-brand-primary/10 p-3 text-brand-primary transition group-hover:bg-brand-primary/15">
                    {f.icon}
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-brand-text">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-muted">{f.desc}</p>
                </li>
              ))}
            </ul>

            <ul className="mx-auto mt-16 flex max-w-2xl flex-col gap-4 md:mt-20">
              {highlights.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 rounded-xl border border-brand-border bg-brand-chat/60 px-4 py-3 text-sm font-medium text-brand-text md:text-base"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                    aria-hidden
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA final */}
        <section className="border-t border-brand-border bg-linear-to-b from-brand-hover/30 to-brand-chat py-20 md:py-24">
          <div className="mx-auto max-w-3xl px-4 text-center md:px-8">
            <h2 className="text-2xl font-bold tracking-tight text-brand-text md:text-3xl">
              ¿Listo para ordenar tu WhatsApp?
            </h2>
            <p className="mt-3 text-lg text-brand-muted">
              Crea tu cuenta y, cuando ventas active tu prueba de {TRIAL_DAYS} días, empezás a usar Diwhat.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                className="btn-brand inline-flex min-h-[48px] min-w-[220px] items-center justify-center px-8"
                href={SALES_WHATSAPP_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                Hablar con Ventas
              </a>
              <Link
                className="btn-brand-outline inline-flex min-h-[48px] min-w-[180px] items-center justify-center px-8"
                href="/signup"
              >
                Registrarse
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-brand-border bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 md:flex-row md:px-8">
          <div className="text-center md:text-left">
            <p className="font-bold text-brand-text">Diwhat</p>
            <p className="mt-1 text-sm text-brand-muted">Bandeja y WhatsApp para equipos que priorizan al cliente.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link className="text-brand-muted hover:text-brand-primary" href="/login">
              Entrar
            </Link>
            <Link className="text-brand-muted hover:text-brand-primary" href="/signup">
              Registrarse
            </Link>
            <a
              className="font-semibold text-brand-primary hover:underline"
              href={SALES_WHATSAPP_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              WhatsApp
            </a>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-brand-muted">
          © {new Date().getFullYear()} Diwhat. Construido para equipos que ponen al cliente primero.
        </p>
      </footer>
    </div>
  );
}
