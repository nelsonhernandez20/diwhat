"use client";

import type { InboxConversationRow } from "@/components/inbox-conversation-list-live";
import { InboxConversationListLive } from "@/components/inbox-conversation-list-live";
import { usePathname } from "next/navigation";

type Props = {
  orgId: string;
  initialConversations: InboxConversationRow[];
  children: React.ReactNode;
};

/** WhatsApp Web: contactos a la izquierda y chat a la derecha. En móvil: lista o chat a pantalla completa. */
export function InboxShell({ orgId, initialConversations, children }: Props) {
  const pathname = usePathname();
  const base = `/dashboard/${orgId}/inbox`;
  const normalized = pathname.replace(/\/$/, "") || pathname;
  const isIndex = normalized === base;
  const rest = normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : "";
  const conversationId = !isIndex && rest ? rest.split("/")[0] : null;
  const isChatOpen = Boolean(conversationId);

  return (
    <div
      className="flex h-[calc(100dvh-7rem)] w-full flex-col overflow-hidden bg-white md:h-[calc(100dvh-7rem)] md:flex-row"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/* Columna contactos */}
      <div
        className={
          isChatOpen
            ? "hidden h-full min-h-0 w-full flex-col md:flex md:w-[min(100%,380px)] md:shrink-0"
            : "flex h-full min-h-0 w-full flex-col md:w-[min(100%,380px)] md:shrink-0"
        }
      >
        <InboxConversationListLive
          key={orgId}
          activeConversationId={conversationId ?? null}
          initialConversations={initialConversations}
          orgId={orgId}
        />
      </div>

      {/* Columna chat / vacío */}
      <div
        className={
          isChatOpen
            ? "flex h-full min-h-0 min-w-0 flex-1 flex-col"
            : "hidden h-full min-h-0 min-w-0 flex-1 flex-col md:flex"
        }
      >
        {children}
      </div>
    </div>
  );
}
