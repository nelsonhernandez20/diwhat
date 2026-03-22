"use client";

import { ThreadComposer } from "@/components/thread-composer";
import type { ReplySelection, ThreadMessageRow } from "@/components/thread-messages-live";
import { ThreadMessagesLive } from "@/components/thread-messages-live";
import { useCallback, useRef, useState } from "react";

export function ConversationThread({
  orgId,
  conversationId,
  initialMessages,
  initialNameById,
}: {
  orgId: string;
  conversationId: string;
  initialMessages: ThreadMessageRow[];
  initialNameById: Record<string, string>;
}) {
  const [replyTo, setReplyTo] = useState<ReplySelection | null>(null);
  const [appendClientMessage, setAppendClientMessage] = useState<{
    row: ThreadMessageRow;
    nonce: number;
  } | null>(null);
  const [externalRefetchNonce, setExternalRefetchNonce] = useState(0);

  const onOutboundMessageInserted = useCallback((row: ThreadMessageRow) => {
    setAppendClientMessage({ row, nonce: Date.now() });
  }, []);

  const bumpThreadRefetch = useCallback(() => {
    setExternalRefetchNonce((n) => n + 1);
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-4 sm:py-4"
      >
        <ThreadMessagesLive
          key={conversationId}
          appendClientMessage={appendClientMessage}
          conversationId={conversationId}
          externalRefetchNonce={externalRefetchNonce}
          initialMessages={initialMessages}
          initialNameById={initialNameById}
          onReply={setReplyTo}
          scrollContainerRef={scrollContainerRef}
        />
      </div>
      <div className="shrink-0 bg-[#f0f2f5] px-2 py-2 sm:px-3">
        <ThreadComposer
          bumpThreadRefetch={bumpThreadRefetch}
          conversationId={conversationId}
          onClearReply={() => setReplyTo(null)}
          onOutboundMessageInserted={onOutboundMessageInserted}
          orgId={orgId}
          replyTo={replyTo}
        />
      </div>
    </div>
  );
}
