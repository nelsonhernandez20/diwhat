/** Título visible: nombre manual en Diwhat, luego etiqueta de WhatsApp, luego teléfono del JID. */
export function conversationDisplayTitle(
  customerDisplayName: string | null | undefined,
  customerLabel: string | null | undefined,
  waChatId: string,
): string {
  const phone = waChatId.split("@")[0] ?? waChatId;
  const manual = customerDisplayName?.trim();
  if (manual) return manual;
  const label = customerLabel?.trim();
  return label || phone;
}
