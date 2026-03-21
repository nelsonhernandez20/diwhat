/** Grupos estándar de WhatsApp (Baileys `isJidGroup`). */
export function waChatIsGroup(waChatId: string): boolean {
  return waChatId.endsWith("@g.us");
}

export type InboxConversationSortable = {
  id: string;
  wa_chat_id: string;
  last_message_at: string;
};

/**
 * 1) Chats privados (1:1) arriba, grupos debajo.
 * 2) Dentro de cada bloque: más reciente primero (`last_message_at` desc).
 * 3) Empate: `id` desc (estable).
 */
export function sortInboxConversations<T extends InboxConversationSortable>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ga = waChatIsGroup(a.wa_chat_id);
    const gb = waChatIsGroup(b.wa_chat_id);
    if (ga !== gb) return ga ? 1 : -1;
    const tb = new Date(b.last_message_at).getTime();
    const ta = new Date(a.last_message_at).getTime();
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
}
