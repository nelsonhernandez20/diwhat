import { MessageCircle } from "lucide-react";

export default function InboxIndexPage() {
  return (
    <div className="flex h-full min-h-[50dvh] flex-col items-center justify-center gap-2 px-6 py-12 text-center md:min-h-0">
      <MessageCircle
        className="h-14 w-14 text-brand-primary/35"
        strokeWidth={1.25}
        aria-hidden
      />
      <p className="max-w-xs text-base font-semibold text-brand-text">Diwhat</p>
      <p className="max-w-sm text-sm text-brand-muted">
        Elige un chat en la lista para leer y responder los mensajes.
      </p>
    </div>
  );
}
