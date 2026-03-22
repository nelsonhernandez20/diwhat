"use client";

import { conversationDisplayTitle } from "@/lib/conversation-title";
import { formatDateTime } from "@/lib/format-date";
import { sortInboxConversations } from "@/lib/inbox-sort";
import { WaAvatar } from "@/components/wa-avatar";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type InboxConversationRow = {
  id: string;
  customer_label: string | null;
  customer_display_name?: string | null;
  wa_chat_id: string;
  last_message_at: string;
  last_inbound_at?: string | null;
  last_read_at?: string | null;
  wa_avatar_path?: string | null;
};

type Props = {
  orgId: string;
  initialConversations: InboxConversationRow[];
  /** Resalta la fila del chat abierto (panel derecho en escritorio). */
  activeConversationId?: string | null;
};

function waPhoneFromChatId(waChatId: string) {
  return waChatId.split("@")[0] ?? waChatId;
}

function inboxChatTitle(
  customerDisplayName: string | null | undefined,
  customerLabel: string | null,
  waChatId: string,
) {
  return conversationDisplayTitle(customerDisplayName, customerLabel, waChatId);
}

function normalizeSearch(s: string) {
  return s.trim().toLowerCase();
}

function hasUnreadInbound(c: InboxConversationRow): boolean {
  if (!c.last_inbound_at) return false;
  if (!c.last_read_at) return true;
  return new Date(c.last_inbound_at).getTime() > new Date(c.last_read_at).getTime();
}

export function InboxConversationListLive({
  orgId,
  initialConversations,
  activeConversationId = null,
}: Props) {
  const [rows, setRows] = useState<InboxConversationRow[]>(() =>
    sortInboxConversations(initialConversations),
  );
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncHint, setSyncHint] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const notifiedMessageIds = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playInboundSound = useCallback(() => {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AC();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.19);
  }, []);

  const sortDesc = useCallback((list: InboxConversationRow[]) => sortInboxConversations(list), []);

  const fetchPreview = useCallback(
    async (conversationId: string) => {
      const { data } = await supabase
        .from("messages")
        .select("body")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.body) {
        setPreviews((prev) => ({ ...prev, [conversationId]: data.body }));
      }
    },
    [supabase],
  );

  /** Carga masiva vía RPC: un último mensaje por conversación (evita cientos de SELECT). */
  const refetchPreviewsForRows = useCallback(
    async (list: InboxConversationRow[]) => {
      const ids = list.map((r) => r.id);
      if (!ids.length) return;

      const chunkSize = 200;
      const merged: Record<string, string> = {};

      for (let offset = 0; offset < ids.length; offset += chunkSize) {
        const slice = ids.slice(offset, offset + chunkSize);
        const { data, error } = await supabase.rpc("inbox_last_message_previews", {
          p_org_id: orgId,
          p_conversation_ids: slice,
        });
        if (error) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[inbox] inbox_last_message_previews", error.message);
          }
          continue;
        }
        for (const row of data ?? []) {
          const r = row as { conversation_id: string; body: string | null };
          if (typeof r.body === "string" && r.body.length > 0) {
            merged[r.conversation_id] = r.body;
          }
        }
      }

      setPreviews((prev) => ({ ...prev, ...merged }));
    },
    [supabase, orgId],
  );

  const refetchInbox = useCallback(async () => {
    const { data: convs, error } = await supabase
      .from("conversations")
      .select(
        "id, customer_label, customer_display_name, wa_chat_id, last_message_at, wa_avatar_path, last_inbound_at, last_read_at",
      )
      .eq("organization_id", orgId)
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false });
    if (error || !convs) return;
    const sorted = sortDesc(convs);
    setRows(sorted);
    await refetchPreviewsForRows(sorted);
  }, [supabase, orgId, sortDesc, refetchPreviewsForRows]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let attachGeneration = 0;

    const attachRealtime = async () => {
      attachGeneration += 1;
      const gen = attachGeneration;
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || gen !== attachGeneration) return;
      if (!session) return;

      const next = supabase
        .channel(`inbox-org:${orgId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `organization_id=eq.${orgId}`,
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (payload.eventType === "INSERT" && payload.new && typeof payload.new === "object") {
              const n = payload.new as InboxConversationRow;
              // Eco LID suele fusionarse en segundos con el chat por número; insertar la fila LID aquí
              // provoca un duplicado visual hasta el siguiente evento. Refrescar lista en su lugar.
              if (n.wa_chat_id?.endsWith("@lid")) {
                void refetchInbox();
                return;
              }
              setRows((prev) => sortDesc([...prev.filter((r) => r.id !== n.id), n]));
              void fetchPreview(n.id);
              return;
            }
            if (payload.eventType === "UPDATE" && payload.new && typeof payload.new === "object") {
              const n = payload.new as InboxConversationRow;
              setRows((prev) =>
                sortDesc(prev.map((r) => (r.id === n.id ? { ...r, ...n } : r))),
              );
              void fetchPreview(n.id);
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            const row = payload.new as Record<string, unknown> | null;
            if (
              !row ||
              typeof row.id !== "string" ||
              typeof row.conversation_id !== "string" ||
              typeof row.body !== "string" ||
              typeof row.created_at !== "string"
            ) {
              return;
            }
            const msgId = row.id;
            const convId = row.conversation_id;
            const body = row.body;
            const createdAt = row.created_at;
            const direction = typeof row.direction === "string" ? row.direction : "";
            const visibility = typeof row.visibility === "string" ? row.visibility : "";
            const isInboundPublic = direction === "inbound" && visibility === "public";
            if (isInboundPublic && !notifiedMessageIds.current.has(msgId)) {
              notifiedMessageIds.current.add(msgId);
              void playInboundSound();
              if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                if ("Notification" in window && Notification.permission === "granted") {
                  const title = "Nuevo mensaje en Diwhat";
                  new Notification(title, { body: body.slice(0, 140) || "Mensaje entrante" });
                } else if ("Notification" in window && Notification.permission === "default") {
                  void Notification.requestPermission();
                }
              }
            }
            setPreviews((prev) => ({ ...prev, [convId]: body }));
            setRows((prev) => {
              const idx = prev.findIndex((r) => r.id === convId);
              if (idx === -1) {
                void supabase
                  .from("conversations")
                  .select(
        "id, customer_label, customer_display_name, wa_chat_id, last_message_at, wa_avatar_path, last_inbound_at, last_read_at",
      )
                  .eq("id", convId)
                  .eq("organization_id", orgId)
                  .maybeSingle()
                  .then(({ data: conv }) => {
                    if (!conv) return;
                    setRows((p) => sortDesc([...p.filter((r) => r.id !== conv.id), conv]));
                  });
                return prev;
              }
              const nextRows = [...prev];
              nextRows[idx] = {
                ...nextRows[idx],
                last_message_at: createdAt,
                ...(isInboundPublic ? { last_inbound_at: createdAt } : {}),
                ...(activeConversationId === convId ? { last_read_at: createdAt } : {}),
              };
              return sortDesc(nextRows);
            });
            if (isInboundPublic && activeConversationId === convId) {
              void supabase
                .from("conversations")
                .update({ last_read_at: createdAt })
                .eq("id", convId)
                .eq("organization_id", orgId);
            }
          },
        )
        .subscribe((status) => {
          if (process.env.NODE_ENV === "development" && status === "SUBSCRIBED") {
            console.debug("[InboxConversationListLive] Realtime suscrito", orgId);
          }
        });

      if (cancelled || gen !== attachGeneration) {
        void supabase.removeChannel(next);
        return;
      }
      channel = next;
    };

    void attachRealtime();

    const pollMs = 3500;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refetchInbox();
    };
    const interval = setInterval(tick, pollMs);
    void refetchInbox();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (channel) void supabase.removeChannel(channel);
        channel = null;
        return;
      }
      void attachRealtime();
    });

    return () => {
      cancelled = true;
      attachGeneration += 1;
      clearInterval(interval);
      authSub.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, orgId, sortDesc, fetchPreview, refetchInbox, activeConversationId, playInboundSound]);

  useEffect(() => {
    let mounted = true;
    const ping = async () => {
      if (!mounted) return;
      await fetch("/api/inbox/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      }).catch(() => null);
    };
    void ping();
    const interval = window.setInterval(() => void ping(), 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [orgId]);

  const syncChats = useCallback(async () => {
    setSyncBusy(true);
    setSyncHint(null);
    try {
      const res = await fetch("/api/whatsapp/sync-chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = (await res.json().catch(() => null)) as {
        error?: string;
        hint?: string;
      } | null;
      if (!res.ok) {
        throw new Error(j?.error ?? "No se pudo sincronizar");
      }
      const text =
        typeof j?.hint === "string" && j.hint.trim()
          ? j.hint
          : "Sincronización correcta. La lista se actualizará en unos segundos.";
      setSyncHint({ kind: "ok", text });
      window.setTimeout(() => void refetchInbox(), 2000);
      window.setTimeout(() => void refetchInbox(), 8000);
      window.setTimeout(() => setSyncHint(null), 20_000);
    } catch (e) {
      setSyncHint({
        kind: "err",
        text: e instanceof Error ? e.message : "Error al sincronizar",
      });
    } finally {
      setSyncBusy(false);
    }
  }, [orgId, refetchInbox]);

  const q = normalizeSearch(search);
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((c) => {
      const phone = waPhoneFromChatId(c.wa_chat_id);
      const title = inboxChatTitle(c.customer_display_name, c.customer_label, c.wa_chat_id);
      const hay = `${title} ${phone}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, q]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 px-3 py-3 md:px-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-brand-text">Chats</h2>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-3 py-1.5 text-xs font-semibold text-brand-text shadow-sm hover:bg-brand-hover disabled:opacity-50"
            disabled={syncBusy}
            type="button"
            title="Traer chats y contactos desde WhatsApp (sesión conectada en el worker)"
            onClick={() => void syncChats()}
          >
            <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${syncBusy ? "animate-spin" : ""}`} />
            Sincronizar
          </button>
        </div>
        {syncHint ? (
          <p
            className={`mt-2 text-xs ${syncHint.kind === "ok" ? "text-emerald-800" : "text-red-600"}`}
            role="status"
          >
            {syncHint.text}
          </p>
        ) : null}
        <label className="sr-only" htmlFor="inbox-contact-search">
          Buscar contacto
        </label>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted"
            aria-hidden
          />
          <input
            id="inbox-contact-search"
            autoComplete="off"
            className="w-full rounded-xl border border-brand-border bg-[#f6f8fa] py-2.5 pl-9 pr-3 text-sm text-brand-text outline-none ring-brand-primary/25 placeholder:text-brand-muted focus:border-brand-primary focus:ring-2"
            placeholder="Buscar por nombre o teléfono…"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {!rows.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-brand-muted">
          <p>
            No hay conversaciones en Diwhat todavía. Conecta WhatsApp en Ajustes y pulsa{" "}
            <span className="font-semibold text-brand-text">Sincronizar</span> para traer chats desde
            tu cuenta (contactos y última actividad).
          </p>
          <p className="max-w-sm text-xs">
            El texto previo de cada chat aparece cuando hay mensajes guardados; los nuevos chats
            pueden mostrarse primero solo con nombre o teléfono.
          </p>
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-brand-muted">
          No hay contactos que coincidan con «{search.trim()}».
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-black/6 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
          {filtered.map((c) => {
            const phone = waPhoneFromChatId(c.wa_chat_id);
            const title = inboxChatTitle(c.customer_display_name, c.customer_label, c.wa_chat_id);
            const preview = previews[c.id];
            const href = `/dashboard/${orgId}/inbox/${c.id}`;
            const active = activeConversationId === c.id;
            const unread = !active && hasUnreadInbound(c);
            return (
              <li key={c.id}>
                <Link
                  className={`flex gap-3 px-3 py-3 transition md:px-4 ${
                    active ? "bg-brand-hover" : "hover:bg-brand-hover/70"
                  }`}
                  href={href}
                  prefetch={false}
                  scroll={false}
                >
                  <WaAvatar label={title} size="md" waAvatarPath={c.wa_avatar_path} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${unread ? "font-bold text-brand-text" : "font-semibold text-brand-text"}`}>
                        {title}
                      </span>
                      <time
                        className={`shrink-0 text-xs ${unread ? "font-semibold text-brand-primary" : "text-brand-muted"}`}
                        dateTime={c.last_message_at}
                      >
                        {formatDateTime(c.last_message_at)}
                      </time>
                    </div>
                    {title !== phone ? (
                      <span className="mt-0.5 block truncate text-xs text-brand-muted">
                        {phone}
                      </span>
                    ) : null}
                    {preview ? (
                      <span className={`mt-1 line-clamp-2 text-sm ${unread ? "text-brand-text" : "text-brand-muted"}`}>
                        {preview}
                      </span>
                    ) : null}
                    {unread ? (
                      <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-brand-primary" aria-label="No leído" />
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
