/**
 * URL pública del sitio (enlaces en correos, etc.).
 * - `NEXT_PUBLIC_SITE_URL`: cliente + servidor (recomendado).
 * - `SITE_URL`: solo servidor (útil si olvidaste el prefijo NEXT_PUBLIC_ para invitaciones).
 */
export function getSiteBaseUrl(): string {
  const a = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (a) return a;
  const b = process.env.SITE_URL?.replace(/\/$/, "");
  if (b) return b;
  if (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "";
}
