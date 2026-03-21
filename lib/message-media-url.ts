/** URL pública del bucket `message_media` (Supabase). */
export function publicMessageMediaUrl(mediaPath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return "";
  const encoded = mediaPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/storage/v1/object/public/message_media/${encoded}`;
}
