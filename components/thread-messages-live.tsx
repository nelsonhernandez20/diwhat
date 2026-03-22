"use client";

import { THREAD_MESSAGES_PAGE_SIZE } from "@/lib/thread-messages-query";
import { formatDateTime } from "@/lib/format-date";
import { publicMessageMediaUrl } from "@/lib/message-media-url";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { FileText, Loader2, Reply } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type ThreadMessageRow = {
  id: string;
  body: string;
  direction: string;
  visibility: string;
  created_at: string;
  sender_user_id: string | null;
  content_type?: string | null;
  media_path?: string | null;
  reply_to_message_id?: string | null;
};

export type ReplySelection = {
  message: ThreadMessageRow;
  authorLabel: string;
};

type Props = {
  conversationId: string;
  initialMessages: ThreadMessageRow[];
  initialNameById: Record<string, string>;
  onReply?: (selection: ReplySelection) => void;
  /** Fila insertada en servidor (evita depender de RSC cache o Realtime). */
  appendClientMessage?: { row: ThreadMessageRow; nonce: number } | null;
  /** Incrementar tras enviar adjuntos/voz para forzar refetch cliente. */
  externalRefetchNonce?: number;
  /** Contenedor con scroll (lista del hilo) para restaurar posición al cargar mensajes viejos. */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
};

function mergeMessageLists(prev: ThreadMessageRow[], incoming: ThreadMessageRow[]): ThreadMessageRow[] {
  const map = new Map<string, ThreadMessageRow>();
  for (const m of prev) map.set(m.id, m);
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function replyAuthorLabel(
  parent: ThreadMessageRow,
  nameById: Record<string, string>,
): string {
  if (parent.visibility === "internal") return "Nota interna";
  if (parent.direction === "inbound") return "Cliente";
  return parent.sender_user_id ? (nameById[parent.sender_user_id] ?? "Equipo") : "Equipo";
}

/** Vista previa corta del texto citado (burbuja y compositor). */
export function replyPreviewText(parent: ThreadMessageRow): string {
  if (parent.content_type === "audio") return "Mensaje de voz";
  if (parent.content_type === "image") return "Imagen";
  if (parent.content_type === "sticker") return "Sticker";
  if (parent.content_type === "pdf") return "PDF";
  const t = parent.body ?? "";
  return t.length > 160 ? `${t.slice(0, 160)}…` : t;
}

export function ThreadMessagesLive({
  conversationId,
  initialMessages,
  initialNameById,
  onReply,
  appendClientMessage = null,
  externalRefetchNonce = 0,
  scrollContainerRef,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessageRow[]>(initialMessages);
  const [hasMoreOlder, setHasMoreOlder] = useState(
    () => initialMessages.length >= THREAD_MESSAGES_PAGE_SIZE,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nearTop, setNearTop] = useState(false);
  const [nameById, setNameById] = useState<Record<string, string>>(initialNameById);
  const prevConversationIdRef = useRef<string | null>(null);
  const skipScrollToEndRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  /** useLayoutEffect: evita un frame en blanco si el primer render llegó sin props del servidor. */
  useLayoutEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      prevConversationIdRef.current = conversationId;
      setMessages(initialMessages);
      setHasMoreOlder(initialMessages.length >= THREAD_MESSAGES_PAGE_SIZE);
      return;
    }
    setMessages((prev) => mergeMessageLists(prev, initialMessages));
  }, [conversationId, initialMessages]);

  useEffect(() => {
    setNameById((prev) => ({ ...initialNameById, ...prev }));
  }, [initialNameById]);

  const supabase = useMemo(() => createClient(), []);
  const scrollEndRef = useRef<HTMLLIElement>(null);
  /** null = aún no fijamos baseline para esta conversación (primer paint → ir al final). */
  const prevMessageCountRef = useRef<number | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    prevMessageCountRef.current = null;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const pending = pendingScrollRestoreRef.current;
    if (el && pending) {
      const delta = el.scrollHeight - pending.scrollHeight;
      el.scrollTop = pending.scrollTop + delta;
      pendingScrollRestoreRef.current = null;
    }
  }, [messages, scrollContainerRef]);

  useEffect(() => {
    const n = messages.length;
    const prev = prevMessageCountRef.current;
    if (prev === null) {
      prevMessageCountRef.current = n;
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    if (skipScrollToEndRef.current) {
      skipScrollToEndRef.current = false;
      prevMessageCountRef.current = n;
      return;
    }
    if (n > prev) {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevMessageCountRef.current = n;
  }, [messages]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 180;
    const onScroll = () => {
      setNearTop(el.scrollTop < threshold);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef, conversationId]);

  const scrollToQuotedMessage = useCallback((quotedId: string) => {
    const el = document.getElementById(`thread-msg-${quotedId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(quotedId);
    window.setTimeout(() => setHighlightedId(null), 2200);
  }, []);

  const mergeSenderNames = useCallback(async (rows: ThreadMessageRow[]) => {
    const ids = [
      ...new Set(rows.map((m) => m.sender_user_id).filter((id): id is string => Boolean(id))),
    ];
    if (!ids.length) return;
    setNameById((prev) => {
      const missing = ids.filter((id) => !prev[id]);
      if (!missing.length) return prev;
      void (async () => {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", missing);
        if (!profiles?.length) return;
        setNameById((p) => {
          const next = { ...p };
          for (const pr of profiles) {
            next[pr.id] = pr.display_name ?? "Equipo";
          }
          return next;
        });
      })();
      return prev;
    });
  }, [supabase]);

  /** Recarga desde DB (respaldo si Realtime no está activo o llega antes la sesión). Solo los N más recientes; el merge conserva bloques antiguos ya cargados con "Cargar más". */
  const refetchThread = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    // Sin JWT, RLS devuelve [] sin error y vaciaría el hilo aunque el SSR sí cargó mensajes.
    if (!session) return;

    const { data, error } = await supabase
      .from("messages")
      .select(
        "id, body, direction, visibility, created_at, sender_user_id, content_type, media_path, reply_to_message_id",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(THREAD_MESSAGES_PAGE_SIZE);
    if (error || !data) return;
    const rows = (data as ThreadMessageRow[]).slice().reverse();
    if (rows.length === 0) {
      setMessages((prev) => (prev.length > 0 ? prev : []));
      return;
    }
    setMessages((prev) => mergeMessageLists(prev, rows));
    void mergeSenderNames(rows);
  }, [supabase, conversationId, mergeSenderNames]);

  const loadOlderMessages = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || loadingOlder || !hasMoreOlder) return;
    const el = scrollContainerRef.current;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    setLoadingOlder(true);
    if (el) {
      pendingScrollRestoreRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    skipScrollToEndRef.current = true;

    const iso = oldest.created_at;
    const filter = `created_at.lt.${iso},and(created_at.eq.${iso},id.lt.${oldest.id})`;

    const { data, error } = await supabase
      .from("messages")
      .select(
        "id, body, direction, visibility, created_at, sender_user_id, content_type, media_path, reply_to_message_id",
      )
      .eq("conversation_id", conversationId)
      .or(filter)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(THREAD_MESSAGES_PAGE_SIZE);

    setLoadingOlder(false);

    if (error) {
      console.error("[ThreadMessagesLive] loadOlderMessages", error);
      pendingScrollRestoreRef.current = null;
      skipScrollToEndRef.current = false;
      return;
    }

    if (!data?.length) {
      setHasMoreOlder(false);
      pendingScrollRestoreRef.current = null;
      skipScrollToEndRef.current = false;
      return;
    }

    const rows = (data as ThreadMessageRow[]).slice().reverse();
    if (rows.length < THREAD_MESSAGES_PAGE_SIZE) setHasMoreOlder(false);
    setMessages((prev) => mergeMessageLists(prev, rows));
    void mergeSenderNames(rows);
  }, [
    conversationId,
    hasMoreOlder,
    loadingOlder,
    mergeSenderNames,
    messages,
    scrollContainerRef,
    supabase,
  ]);

  /** Evita que el efecto de Realtime se reinicie cuando cambia la identidad de refetchThread (pierde INSERT entrantes). */
  const refetchThreadRef = useRef(refetchThread);
  refetchThreadRef.current = refetchThread;

  /** Tras F5, el HTML del servidor a veces va justo antes que la réplica o la cookie; repetimos refetch en cliente. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t1 = window.setTimeout(() => void refetchThreadRef.current(), 400);
    return () => {
      clearTimeout(t1);
    };
  }, [conversationId]);

  useEffect(() => {
    if (!appendClientMessage) return;
    const { row } = appendClientMessage;
    setMessages((prev) => mergeMessageLists(prev, [row]));
    void mergeSenderNames([row]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append solo cuando cambia nonce
  }, [appendClientMessage?.nonce]);

  useEffect(() => {
    if (externalRefetchNonce <= 0) return;
    void refetchThreadRef.current();
  }, [externalRefetchNonce]);

  const messageById = useMemo(
    () => Object.fromEntries(messages.map((m) => [m.id, m])),
    [messages],
  );

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
        .channel(`thread:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          async (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            const raw = payload.new as Record<string, unknown> | null;
            if (!raw || typeof raw.id !== "string") return;
            const row = raw as unknown as ThreadMessageRow;
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              return [...prev, row].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              );
            });
            if (row.sender_user_id) {
              const { data: p } = await supabase
                .from("profiles")
                .select("id, display_name")
                .eq("id", row.sender_user_id)
                .maybeSingle();
              if (p?.id) {
                setNameById((prev) =>
                  prev[p.id] ? prev : { ...prev, [p.id]: p.display_name ?? "Equipo" },
                );
              }
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            const raw = payload.new as Record<string, unknown> | null;
            if (!raw || typeof raw.id !== "string") return;
            const row = raw as unknown as ThreadMessageRow;
            setMessages((prev) => {
              const i = prev.findIndex((m) => m.id === row.id);
              if (i === -1) return prev;
              const copy = [...prev];
              copy[i] = row;
              return copy.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              );
            });
          },
        )
        .subscribe((status) => {
          if (process.env.NODE_ENV === "development" && status === "SUBSCRIBED") {
            console.debug("[ThreadMessagesLive] Realtime suscrito", conversationId);
          }
        });

      if (cancelled || gen !== attachGeneration) {
        void supabase.removeChannel(next);
        return;
      }
      channel = next;
      void refetchThreadRef.current();
    };

    const pollMs = 3500;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refetchThreadRef.current();
    };
    const interval = setInterval(tick, pollMs);
    void refetchThreadRef.current();

    /** No llamar attachRealtime en cada TOKEN_REFRESHED: recrea el canal, cierra el WS y dispara el warning en consola. */
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        if (channel) void supabase.removeChannel(channel);
        channel = null;
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        void refetchThreadRef.current();
        return;
      }
      void attachRealtime();
      void refetchThreadRef.current();
    });

    return () => {
      cancelled = true;
      attachGeneration += 1;
      clearInterval(interval);
      authSub.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId]);

  const showLoadMoreBar = (nearTop && hasMoreOlder) || loadingOlder;

  return (
    <ul className="flex flex-col gap-2">
      {showLoadMoreBar ? (
        <li className="list-none py-1">
          <div className="flex justify-center">
            <button
              className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-primary shadow-sm transition hover:bg-brand-hover disabled:opacity-60"
              disabled={loadingOlder || !hasMoreOlder}
              type="button"
              onClick={() => void loadOlderMessages()}
            >
              {loadingOlder ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                  Cargando…
                </>
              ) : (
                "Cargar mensajes anteriores"
              )}
            </button>
          </div>
        </li>
      ) : null}
      {messages.map((m) => {
        const isInternal = m.visibility === "internal";
        const isInbound = m.direction === "inbound";
        const isOutbound = !isInbound && !isInternal;
        const parent = m.reply_to_message_id ? messageById[m.reply_to_message_id] : undefined;
        return (
          <li
            id={`thread-msg-${m.id}`}
            key={m.id}
            className={`flex w-full scroll-mt-4 rounded-xl transition-[box-shadow] duration-300 ${
              isInbound || isInternal ? "justify-start" : "justify-end"
            } ${highlightedId === m.id ? "ring-2 ring-brand-primary ring-offset-2 ring-offset-white" : ""}`}
          >
            <div
              className={`relative max-w-[min(85%,24rem)] rounded-2xl px-3 py-2 pr-10 shadow-sm ${
                isInternal
                  ? "border border-brand-internal-border bg-brand-internal-bg text-brand-text"
                  : isInbound
                    ? "border border-brand-border bg-brand-bubble-in text-brand-text"
                    : "bg-brand-primary text-white"
              }`}
            >
              {onReply ? (
                <button
                  className={`absolute right-1.5 top-1.5 rounded-md p-1.5 transition hover:bg-black/10 ${
                    isOutbound ? "text-white/85 hover:text-white" : "text-brand-muted hover:text-brand-primary"
                  }`}
                  type="button"
                  aria-label="Responder a este mensaje"
                  onClick={() =>
                    onReply({
                      authorLabel: replyAuthorLabel(m, nameById),
                      message: m,
                    })
                  }
                >
                  <Reply className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
              {parent && m.reply_to_message_id ? (
                <button
                  className={`mb-2 w-full rounded-md border-l-[3px] pl-2 text-left transition hover:opacity-90 active:opacity-100 ${
                    isOutbound
                      ? "border-white/70 bg-white/10"
                      : isInternal
                        ? "border-[#856404]/60 bg-black/[0.04]"
                        : "border-brand-primary/50 bg-black/[0.03]"
                  }`}
                  type="button"
                  title="Ir al mensaje citado"
                  onClick={(e) => {
                    e.stopPropagation();
                    scrollToQuotedMessage(m.reply_to_message_id!);
                  }}
                >
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      isOutbound ? "text-white/85" : isInternal ? "text-[#856404]" : "text-brand-primary"
                    }`}
                  >
                    {replyAuthorLabel(parent, nameById)}
                  </p>
                  <p
                    className={`mt-0.5 line-clamp-3 text-xs ${
                      isOutbound ? "text-white/90" : "text-brand-muted"
                    }`}
                  >
                    {replyPreviewText(parent)}
                  </p>
                </button>
              ) : null}
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${
                  isOutbound ? "text-white/90" : "text-brand-muted"
                }`}
              >
                {isInternal ? (
                  <span className="font-bold uppercase tracking-wide text-[#856404]">Nota interna</span>
                ) : isInbound ? (
                  <span className="font-medium">Cliente</span>
                ) : (
                  <span className="font-medium">
                    {m.sender_user_id ? nameById[m.sender_user_id] ?? "Tú" : "Equipo"}
                  </span>
                )}
                <span className={isOutbound ? "text-white/70" : ""}>·</span>
                <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time>
              </div>
              {m.content_type === "audio" && m.media_path ? (
                <audio
                  className={`mt-2 w-full max-w-full ${isOutbound ? "[color-scheme:light]" : ""}`}
                  controls
                  preload="metadata"
                  src={publicMessageMediaUrl(m.media_path)}
                />
              ) : m.content_type === "image" && m.media_path ? (
                <>
                  <a
                    className="mt-2 block overflow-hidden rounded-lg"
                    href={publicMessageMediaUrl(m.media_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="max-h-72 w-full max-w-full object-contain"
                      loading="lazy"
                      src={publicMessageMediaUrl(m.media_path)}
                    />
                  </a>
                  {m.body && m.body !== "📷 Imagen" ? (
                    <p
                      className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed ${
                        isOutbound ? "text-white" : "text-brand-text"
                      }`}
                    >
                      {m.body}
                    </p>
                  ) : null}
                </>
              ) : m.content_type === "sticker" && m.media_path ? (
                <>
                  <a
                    className="mt-2 inline-block max-w-[min(100%,220px)] overflow-hidden rounded-lg"
                    href={publicMessageMediaUrl(m.media_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="max-h-48 w-auto max-w-full object-contain"
                      loading="lazy"
                      src={publicMessageMediaUrl(m.media_path)}
                    />
                  </a>
                  {m.body?.trim() &&
                  !/^([^:]+:\s*)?🎨 Sticker$/u.test(m.body.trim()) ? (
                    <p
                      className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed ${
                        isOutbound ? "text-white" : "text-brand-text"
                      }`}
                    >
                      {m.body}
                    </p>
                  ) : null}
                </>
              ) : m.content_type === "pdf" && m.media_path ? (
                <>
                  <a
                    className={`mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90 ${
                      isOutbound
                        ? "border-white/40 bg-white/10 text-white"
                        : isInternal
                          ? "border-brand-internal-border bg-black/[0.04] text-brand-text"
                          : "border-brand-border bg-black/[0.03] text-brand-primary"
                    }`}
                    href={publicMessageMediaUrl(m.media_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">
                      {(() => {
                        const head = (m.body ?? "").split("\n\n")[0] ?? "";
                        return head.replace(/^📄\s*/, "").trim() || "Abrir PDF";
                      })()}
                    </span>
                  </a>
                  {(() => {
                    const parts = (m.body ?? "").split("\n\n");
                    const cap = parts.length > 1 ? parts.slice(1).join("\n\n").trim() : "";
                    if (!cap) return null;
                    return (
                      <p
                        className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed ${
                          isOutbound ? "text-white" : "text-brand-text"
                        }`}
                      >
                        {cap}
                      </p>
                    );
                  })()}
                </>
              ) : (
                <p
                  className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed ${
                    isOutbound ? "text-white" : "text-brand-text"
                  }`}
                >
                  {m.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
      <li ref={scrollEndRef} className="h-0 w-full shrink-0 list-none p-0" aria-hidden />
    </ul>
  );
}
