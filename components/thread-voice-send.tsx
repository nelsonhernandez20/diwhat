"use client";

import { postStaffVoiceMessage } from "@/lib/actions/messages";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mic, Send, Square, Trash2, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

const MAX_SECONDS = 120;
const PREFERRED_MIME = "audio/webm;codecs=opus";

const iconBtn =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50";

export function ThreadVoiceSend({
  orgId,
  conversationId,
  disabled,
  /** Fila principal: campo de texto + mic + acciones (solo en idle). */
  textInputSlot,
  /** Entre el texto y el micrófono (p. ej. adjuntar imagen). */
  beforeMicSlot,
  actionSlot,
  replyToMessageId = null,
  onVoiceSent,
}: {
  orgId: string;
  conversationId: string;
  disabled?: boolean;
  textInputSlot: ReactNode;
  beforeMicSlot?: ReactNode;
  actionSlot: ReactNode;
  replyToMessageId?: string | null;
  /** Tras enviar nota de voz correctamente (p. ej. limpiar cita). */
  onVoiceSent?: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendingTarget, setSendingTarget] = useState<"public" | "internal" | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const chunksRef = useRef<Blob[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const cancelRecordingRef = useRef(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const resetLocal = useCallback(() => {
    clearTick();
    recRef.current = null;
    stopStream();
    blobRef.current = null;
    setPreviewSrc((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setPhase("idle");
    setElapsed(0);
  }, [clearTick, stopStream]);

  const stopRecording = useCallback(() => {
    clearTick();
    try {
      recRef.current?.stop();
    } catch {
      /* ya parado */
    }
    recRef.current = null;
  }, [clearTick]);

  const startRecording = async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Tu navegador no permite grabar audio desde aquí.");
      return;
    }
    setError(null);
    cancelRecordingRef.current = false;
    resetLocal();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(PREFERRED_MIME)
          ? PREFERRED_MIME
          : undefined;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => setError("Error al grabar.");
      rec.onstop = () => {
        stopStream();
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        if (cancelRecordingRef.current) {
          cancelRecordingRef.current = false;
          chunksRef.current = [];
          setPhase("idle");
          setElapsed(0);
          return;
        }
        const blobType = rec.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreviewSrc((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setPhase("ready");
      };
      recRef.current = rec;
      rec.start(250);
      setElapsed(0);
      setPhase("recording");
      tickRef.current = setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= MAX_SECONDS) {
            try {
              recRef.current?.stop();
            } catch {
              /* */
            }
            return MAX_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch {
      setError("No se pudo acceder al micrófono.");
      resetLocal();
    }
  };

  const discard = () => {
    if (phase === "ready") {
      resetLocal();
      return;
    }
    if (phase === "recording") {
      cancelRecordingRef.current = true;
      clearTick();
      try {
        recRef.current?.stop();
      } catch {
        /* */
      }
      recRef.current = null;
    }
  };

  const sendVoice = async (visibility: "public" | "internal") => {
    const blob = blobRef.current;
    if (!blob || blob.size < 1) {
      setError("No hay audio para enviar.");
      return;
    }
    setSending(true);
    setSendingTarget(visibility);
    setError(null);
    try {
      const supabase = createClient();
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "m4a" : "bin";
      const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("message_media").upload(path, blob, {
        contentType: blob.type || "audio/webm",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);
      await postStaffVoiceMessage({
        orgId,
        conversationId,
        visibility,
        storagePath: path,
        mimeType: blob.type || "audio/webm",
        durationSeconds: elapsed > 0 ? elapsed : undefined,
        replyToMessageId: replyToMessageId ?? undefined,
      });
      discard();
      onVoiceSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al enviar audio");
    } finally {
      setSending(false);
      setSendingTarget(null);
    }
  };

  const busy = disabled || sending;

  return (
    <div className="flex w-full flex-col gap-2">
      {phase === "idle" ? (
        <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-end lg:gap-2">
          <div className="min-w-0 w-full shrink-0 lg:min-w-0 lg:flex-1">{textInputSlot}</div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 sm:justify-end lg:w-auto lg:flex-nowrap lg:items-end">
            {beforeMicSlot}
            <button
              className={`${iconBtn} bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-[#ebebeb]`}
              disabled={busy}
              type="button"
              onClick={() => void startRecording()}
              aria-label="Grabar nota de voz"
            >
              <Mic className="h-5 w-5 shrink-0" aria-hidden />
            </button>
            {actionSlot}
          </div>
        </div>
      ) : null}

      {phase === "recording" ? (
        <div className="flex items-center gap-2 rounded-3xl bg-[#f0f2f5] px-3 py-2">
          <span className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />
          <span className="min-w-0 flex-1 text-sm tabular-nums text-brand-text">
            Grabando… {elapsed}s / {MAX_SECONDS}s
          </span>
          <button
            className={`${iconBtn} h-10 w-10 bg-transparent text-brand-muted hover:bg-black/6`}
            type="button"
            onClick={discard}
            aria-label="Cancelar grabación"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary text-white shadow-sm hover:brightness-95"
            type="button"
            onClick={stopRecording}
            aria-label="Parar y previsualizar"
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          </button>
        </div>
      ) : null}

      {phase === "ready" && previewSrc ? (
        <div className="flex flex-col gap-2 rounded-3xl bg-[#f0f2f5] p-3">
          <audio className="w-full rounded-lg" controls src={previewSrc} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className={`${iconBtn} h-10 w-10 border-2 border-brand-border bg-white text-brand-muted hover:bg-white`}
              disabled={busy}
              type="button"
              onClick={discard}
              aria-label="Descartar audio"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
            <button
              className={`${iconBtn} h-10 w-10 border-2 border-brand-primary bg-white text-brand-primary hover:bg-brand-hover`}
              disabled={busy}
              type="button"
              onClick={() => void sendVoice("internal")}
              aria-label="Guardar solo para el equipo"
            >
              {sendingTarget === "internal" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Users className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              className={`${iconBtn} h-10 w-10 bg-brand-primary text-white shadow-sm hover:brightness-95`}
              disabled={busy}
              type="button"
              onClick={() => void sendVoice("public")}
              aria-label="Enviar nota de voz al cliente"
            >
              {sendingTarget === "public" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
