/** Misma salida en Node (SSR) y en el navegador para evitar errores de hidratación. */
const dateTimeFmt = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}
