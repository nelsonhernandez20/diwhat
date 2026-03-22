export default function ConversationLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div
        className="flex shrink-0 items-center gap-3 border-b border-brand-border px-3 py-3 md:px-4"
        aria-hidden
      >
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-black/10" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 w-40 max-w-[60%] animate-pulse rounded bg-black/10" />
          <div className="h-3 w-24 animate-pulse rounded bg-black/5" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-brand-chat">
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-14 max-w-[85%] animate-pulse rounded-2xl bg-black/6 ${i % 2 === 0 ? "self-end" : "self-start"}`}
              />
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t border-brand-border bg-white px-3 py-2 sm:px-4">
          <div className="h-11 w-full animate-pulse rounded-xl bg-black/5" />
        </div>
      </div>
    </div>
  );
}
