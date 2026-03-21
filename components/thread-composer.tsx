"use client";

import { postStaffImageMessage, postStaffMessage, postStaffPdfMessage } from "@/lib/actions/messages";
import { replyPreviewText, type ReplySelection } from "@/components/thread-messages-live";
import { ThreadVoiceSend } from "@/components/thread-voice-send";
import { createClient } from "@/lib/supabase/client";
import { FileText, Image as ImageIcon, Loader2, Send, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const roundIcon =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export function ThreadComposer({
  orgId,
  conversationId,
  replyTo,
  onClearReply,
}: {
  orgId: string;
  conversationId: string;
  replyTo: ReplySelection | null;
  onClearReply: () => void;
}) {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState<"public" | "internal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const clearPdf = useCallback(() => {
    setPdfFile(null);
    if (pdfRef.current) pdfRef.current.value = "";
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  async function send(visibility: "public" | "internal") {
    setError(null);
    if (!imageFile && !pdfFile && !body.trim()) {
      setError("Escribe un mensaje o adjunta una imagen o un PDF.");
      return;
    }
    setLoading(visibility);
    try {
      if (imageFile) {
        const supabase = createClient();
        const ext = imageFile.name.split(".").pop()?.toLowerCase();
        const safeExt =
          ext && ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
        const path = `${orgId}/${crypto.randomUUID()}.${safeExt}`;
        const { error: upErr } = await supabase.storage.from("message_media").upload(path, imageFile, {
          contentType: imageFile.type || "image/jpeg",
          upsert: false,
        });
        if (upErr) throw new Error(upErr.message);
        await postStaffImageMessage({
          orgId,
          conversationId,
          visibility,
          storagePath: path,
          mimeType: imageFile.type || "image/jpeg",
          caption: body.trim() || null,
          replyToMessageId: replyTo?.message.id ?? null,
        });
        setBody("");
        clearImage();
        onClearReply();
        return;
      }
      if (pdfFile) {
        const supabase = createClient();
        const path = `${orgId}/${crypto.randomUUID()}.pdf`;
        const { error: upErr } = await supabase.storage.from("message_media").upload(path, pdfFile, {
          contentType: "application/pdf",
          upsert: false,
        });
        if (upErr) throw new Error(upErr.message);
        await postStaffPdfMessage({
          orgId,
          conversationId,
          visibility,
          storagePath: path,
          fileName: pdfFile.name || "document.pdf",
          fileSizeBytes: pdfFile.size,
          mimeType: pdfFile.type || "application/pdf",
          caption: body.trim() || null,
          replyToMessageId: replyTo?.message.id ?? null,
        });
        setBody("");
        clearPdf();
        onClearReply();
        return;
      }
      const textRes = await postStaffMessage({
        orgId,
        conversationId,
        body,
        visibility,
        replyToMessageId: replyTo?.message.id ?? null,
      });
      if (!textRes.ok) {
        setError(textRes.error);
        return;
      }
      setBody("");
      onClearReply();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setLoading(null);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("El archivo debe ser una imagen (JPEG, PNG, WebP o GIF).");
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setError("La imagen no puede superar 10 MB.");
      return;
    }
    setError(null);
    clearPdf();
    setImageFile(f);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }

  function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const okType = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!okType) {
      setError("El archivo debe ser un PDF.");
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      setError("El PDF no puede superar 5 MB.");
      return;
    }
    setError(null);
    clearImage();
    setPdfFile(f);
  }

  function onTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    if (loading !== null) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send("public");
  }

  const textInputSlot = (
    <div className="min-w-0 w-full flex-1 rounded-3xl bg-[#f0f2f5] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(0,0,0,0.03)] lg:py-2">
      <label className="sr-only" htmlFor="thread-reply">
        {imageFile ? "Leyenda opcional" : pdfFile ? "Nota opcional" : "Mensaje"}
      </label>
      <textarea
        id="thread-reply"
        className="max-h-40 min-h-[52px] w-full resize-none bg-transparent text-base leading-snug text-brand-text outline-none placeholder:text-[#8696a0] focus:outline-none lg:max-h-32 lg:min-h-[44px] lg:text-[15px]"
        placeholder={
          imageFile
            ? "Leyenda opcional junto a la imagen…"
            : pdfFile
              ? "Mensaje opcional junto al PDF (se envía como leyenda en WhatsApp)"
              : "Escribe un mensaje"
        }
        rows={1}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onTextKeyDown}
      />
    </div>
  );

  const beforeMicSlot = (
    <>
      <input
        ref={fileRef}
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        type="file"
        onChange={onFileChange}
      />
      <input
        ref={pdfRef}
        accept="application/pdf,.pdf"
        className="sr-only"
        type="file"
        onChange={onPdfChange}
      />
      <button
        className={`${roundIcon} bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-[#ebebeb]`}
        disabled={loading !== null}
        type="button"
        title="Adjuntar imagen"
        onClick={() => fileRef.current?.click()}
      >
        <ImageIcon className="h-5 w-5 shrink-0" aria-hidden />
      </button>
      <button
        className={`${roundIcon} bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-[#ebebeb]`}
        disabled={loading !== null}
        type="button"
        title="Adjuntar PDF (máx. 5 MB)"
        onClick={() => pdfRef.current?.click()}
      >
        <FileText className="h-5 w-5 shrink-0" aria-hidden />
      </button>
    </>
  );

  const actionSlot = (
    <>
      <button
        className={`${roundIcon} border-2 border-brand-primary bg-white text-brand-primary hover:bg-brand-hover`}
        disabled={loading !== null}
        type="button"
        title="Solo equipo (nota interna)"
        onClick={() => send("internal")}
      >
        {loading === "internal" ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Users className="h-5 w-5" aria-hidden />
        )}
      </button>
      <button
        className={`${roundIcon} bg-brand-primary text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:brightness-95`}
        disabled={loading !== null}
        type="button"
        title="Enviar al cliente (WhatsApp)"
        onClick={() => send("public")}
      >
        {loading === "public" ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Send className="h-5 w-5" aria-hidden />
        )}
      </button>
    </>
  );

  return (
    <div className="text-brand-text">
      {replyTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 shadow-sm">
          <div
            className="mt-0.5 h-9 w-1 shrink-0 rounded-full bg-brand-primary"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">
              Respondiendo a {replyTo.authorLabel}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-brand-muted">
              {replyPreviewText(replyTo.message)}
            </p>
          </div>
          <button
            className="shrink-0 rounded-full p-1.5 text-brand-muted hover:bg-black/[0.06] hover:text-brand-text"
            type="button"
            aria-label="Cancelar respuesta"
            onClick={onClearReply}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {imagePreview ? (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-black/[0.08] bg-white p-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="max-h-28 max-w-[min(100%,200px)] rounded-lg object-cover"
            src={imagePreview}
          />
          <button
            className="shrink-0 rounded-full p-1.5 text-brand-muted hover:bg-black/[0.06] hover:text-brand-text"
            type="button"
            aria-label="Quitar imagen"
            onClick={clearImage}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {pdfFile ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 shadow-sm">
          <FileText className="h-8 w-8 shrink-0 text-red-700/90" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-brand-text">{pdfFile.name}</p>
          <span className="shrink-0 text-[11px] text-brand-muted">{(pdfFile.size / 1024).toFixed(0)} KB</span>
          <button
            className="shrink-0 rounded-full p-1.5 text-brand-muted hover:bg-black/[0.06] hover:text-brand-text"
            type="button"
            aria-label="Quitar PDF"
            onClick={clearPdf}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <ThreadVoiceSend
        actionSlot={actionSlot}
        beforeMicSlot={beforeMicSlot}
        conversationId={conversationId}
        disabled={loading !== null}
        orgId={orgId}
        replyToMessageId={replyTo?.message.id ?? null}
        textInputSlot={textInputSlot}
        onVoiceSent={onClearReply}
      />

      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <p className="mt-2 hidden text-center text-[11px] leading-snug text-[#8696a0] lg:block">
        Enter envía al cliente; Mayús+Enter nueva línea. Las notas internas no se envían por WhatsApp;
        solo las ve tu equipo.
      </p>
    </div>
  );
}
