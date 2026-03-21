"use client";

import { ThreadComposer } from "@/components/thread-composer";
import type { ReplySelection, ThreadMessageRow } from "@/components/thread-messages-live";
import { ThreadMessagesLive } from "@/components/thread-messages-live";
import { useState } from "react";

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

  return (
    <>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-4 sm:py-4">
        <ThreadMessagesLive
          conversationId={conversationId}
          initialMessages={initialMessages}
          initialNameById={initialNameById}
          onReply={setReplyTo}
        />
      </div>
      <div className="shrink-0 bg-[#f0f2f5] px-2 py-2 sm:px-3">
        <ThreadComposer
          conversationId={conversationId}
          onClearReply={() => setReplyTo(null)}
          orgId={orgId}
          replyTo={replyTo}
        />
      </div>
    </>
  );
}
