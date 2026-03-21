"use client";

import { updateConversationDisplayName } from "@/lib/actions/conversations";
import { conversationDisplayTitle } from "@/lib/conversation-title";
import { WaAvatar } from "@/components/wa-avatar";
import { ArrowLeft, Check, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

function waPhoneFromChatId(waChatId: string) {
  return waChatId.split("@")[0] ?? waChatId;
}

export function ConversationDisplayNameHeader({
  orgId,
  conversationId,
  waChatId,
  customerLabel,
  customerDisplayName,
  waAvatarPath,
}: {
  orgId: string;
  conversationId: string;
  waChatId: string;
  customerLabel: string | null;
  customerDisplayName: string | null;
  waAvatarPath: string | null;
}) {
  const router = useRouter();
  const phone = waPhoneFromChatId(waChatId);
  const title = conversationDisplayTitle(customerDisplayName, customerLabel, waChatId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(customerDisplayName?.trim() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(customerDisplayName?.trim() ?? "");
  }, [customerDisplayName, editing]);

  const openEdit = useCallback(() => {
    setDraft(customerDisplayName?.trim() ?? "");
    setError(null);
    setEditing(true);
  }, [customerDisplayName]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const res = await updateConversationDisplayName({
      orgId,
      conversationId,
      customerDisplayName: draft.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }, [conversationId, draft, orgId, router]);

  return (
    <header className="flex shrink-0 items-start gap-3 bg-[#fafbfc] px-3 py-3 sm:items-center sm:px-4">
      <Link
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-brand-primary hover:bg-brand-hover md:mt-0 md:hidden"
        href={`/dashboard/${orgId}/inbox`}
        aria-label="Volver a la bandeja"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
      <WaAvatar label={title} size="sm" waAvatarPath={waAvatarPath} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="w-full min-w-0 rounded-lg border border-brand-border bg-white px-3 py-2 text-base text-brand-text outline-none focus:border-brand-primary"
              placeholder="Nombre para identificar al cliente"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              maxLength={120}
              aria-label="Nombre visible"
            />
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary text-white hover:brightness-95 disabled:opacity-50"
                disabled={saving}
                onClick={() => void save()}
                aria-label="Guardar nombre"
              >
                <Check className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-border bg-white text-brand-muted hover:bg-brand-hover"
                disabled={saving}
                onClick={cancel}
                aria-label="Cancelar"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-brand-text">{title}</h1>
            <button
              type="button"
              className="shrink-0 rounded-full p-1.5 text-brand-muted hover:bg-black/5 hover:text-brand-text"
              onClick={openEdit}
              aria-label="Editar nombre visible"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        <p className="truncate text-xs text-brand-muted">{phone}</p>
        {error ? (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {!editing ? (
          <p className="mt-0.5 hidden text-[11px] text-brand-muted/90 sm:block">
            Nombre opcional en Diwhat; si lo dejas vacío, usamos WhatsApp o el número.
          </p>
        ) : null}
      </div>
    </header>
  );
}
