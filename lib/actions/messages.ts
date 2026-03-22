"use server";

import type { ThreadMessageRow } from "@/components/thread-messages-live";
import { requireOrgMember } from "@/lib/auth/org";
import { revalidatePath } from "next/cache";

type WaQuotePayload = {
  waMessageId: string;
  fromMe: boolean;
  body: string;
  isAudio: boolean;
  isImage?: boolean;
  isPdf?: boolean;
  isSticker?: boolean;
};

const PDF_MAX_BYTES = 5 * 1024 * 1024;

function isWorkerConfigured(): boolean {
  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  return Boolean(base && process.env.WHATSAPP_WORKER_SECRET);
}

async function notifyWorkerSend(payload: {
  organizationId: string;
  messageId: string;
  waChatId: string;
  body: string;
  quote?: WaQuotePayload | null;
}) {
  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!base || !secret) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }
  const res = await fetch(`${base}/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error enviando al worker");
  }
}

async function notifyWorkerSendImage(payload: {
  organizationId: string;
  messageId: string;
  waChatId: string;
  storagePath: string;
  mimeType: string;
  caption?: string | null;
  quote?: WaQuotePayload | null;
}) {
  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!base || !secret) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }
  const res = await fetch(`${base}/send-image`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error enviando imagen al worker");
  }
}

async function notifyWorkerSendPdf(payload: {
  organizationId: string;
  messageId: string;
  waChatId: string;
  storagePath: string;
  fileName: string;
  caption?: string | null;
  quote?: WaQuotePayload | null;
}) {
  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!base || !secret) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }
  const res = await fetch(`${base}/send-pdf`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error enviando PDF al worker");
  }
}

async function notifyWorkerSendVoice(payload: {
  organizationId: string;
  messageId: string;
  waChatId: string;
  storagePath: string;
  mimeType: string;
  seconds?: number;
  quote?: WaQuotePayload | null;
}) {
  const base = process.env.WHATSAPP_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!base || !secret) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }
  const res = await fetch(`${base}/send-audio`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error enviando audio al worker");
  }
}

export type PostStaffMessageResult =
  | { ok: true; message: ThreadMessageRow }
  | { ok: false; error: string };

export async function postStaffMessage(input: {
  orgId: string;
  conversationId: string;
  body: string;
  visibility: "public" | "internal";
  replyToMessageId?: string | null;
}): Promise<PostStaffMessageResult> {
  const { supabase, user } = await requireOrgMember(input.orgId);
  const text = input.body.trim();
  if (!text) return { ok: false, error: "Mensaje vacío" };

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, wa_chat_id, organization_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.orgId)
    .maybeSingle();

  if (convErr || !conv) return { ok: false, error: "Conversación no encontrada" };

  let replyToMessageId: string | null = null;
  let waQuote: WaQuotePayload | null = null;

  if (input.replyToMessageId?.trim()) {
    const { data: parent, error: parentErr } = await supabase
      .from("messages")
      .select("id, conversation_id, wa_message_id, direction, body, content_type")
      .eq("id", input.replyToMessageId.trim())
      .maybeSingle();

    if (parentErr || !parent) return { ok: false, error: "Mensaje citado no encontrado" };
    if (parent.conversation_id !== conv.id) return { ok: false, error: "Respuesta inválida" };

    replyToMessageId = parent.id;
    const wid = parent.wa_message_id?.trim();
    if (wid) {
      waQuote = {
        waMessageId: wid,
        fromMe: parent.direction === "outbound",
        body: typeof parent.body === "string" ? parent.body : "",
        isAudio: parent.content_type === "audio",
        isImage: parent.content_type === "image",
        isPdf: parent.content_type === "pdf",
        isSticker: parent.content_type === "sticker",
      };
    }
  }

  if (input.visibility === "public" && !isWorkerConfigured()) {
    return {
      ok: false,
      error:
        "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    };
  }

  const { data: row, error: insErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      visibility: input.visibility,
      sender_user_id: user.id,
      body: text,
      reply_to_message_id: replyToMessageId,
    })
    .select(
      "id, body, direction, visibility, created_at, sender_user_id, content_type, media_path, reply_to_message_id",
    )
    .single();

  if (insErr || !row) return { ok: false, error: insErr?.message ?? "No se pudo guardar" };
  const message = row as ThreadMessageRow;

  const { error: bumpErr } = await supabase
    .from("conversations")
    .update({ last_message_at: row.created_at as string })
    .eq("id", conv.id)
    .eq("organization_id", input.orgId);
  if (bumpErr) return { ok: false, error: bumpErr.message };

  if (input.visibility === "public") {
    /** No await: el envío por Baileys puede tardar minutos; bloquear la server action congela la UI y la navegación. */
    void notifyWorkerSend({
      organizationId: input.orgId,
      messageId: message.id,
      waChatId: conv.wa_chat_id,
      body: text,
      quote: waQuote,
    }).catch((e) => {
      console.error("[diwhat] notifyWorkerSend", e);
    });
  }

  revalidatePath(`/dashboard/${input.orgId}/inbox`, "layout");
  return { ok: true, message };
}

export async function postStaffImageMessage(input: {
  orgId: string;
  conversationId: string;
  visibility: "public" | "internal";
  storagePath: string;
  mimeType: string;
  caption?: string | null;
  replyToMessageId?: string | null;
}) {
  const { supabase, user } = await requireOrgMember(input.orgId);
  const path = input.storagePath.trim();
  if (path.includes("..") || !path.startsWith(`${input.orgId}/`)) {
    throw new Error("Ruta de imagen inválida");
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, wa_chat_id, organization_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.orgId)
    .maybeSingle();

  if (convErr || !conv) throw new Error("Conversación no encontrada");

  let replyToMessageId: string | null = null;
  let waQuote: WaQuotePayload | null = null;

  if (input.replyToMessageId?.trim()) {
    const { data: parent, error: parentErr } = await supabase
      .from("messages")
      .select("id, conversation_id, wa_message_id, direction, body, content_type")
      .eq("id", input.replyToMessageId.trim())
      .maybeSingle();

    if (parentErr || !parent) throw new Error("Mensaje citado no encontrado");
    if (parent.conversation_id !== conv.id) throw new Error("Respuesta inválida");

    replyToMessageId = parent.id;
    const wid = parent.wa_message_id?.trim();
    if (wid) {
      waQuote = {
        waMessageId: wid,
        fromMe: parent.direction === "outbound",
        body: typeof parent.body === "string" ? parent.body : "",
        isAudio: parent.content_type === "audio",
        isImage: parent.content_type === "image",
        isPdf: parent.content_type === "pdf",
        isSticker: parent.content_type === "sticker",
      };
    }
  }

  if (input.visibility === "public" && !isWorkerConfigured()) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }

  const cap = input.caption?.trim();
  const bodyText = cap && cap.length > 0 ? cap : "📷 Imagen";

  const { data: row, error: insErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      visibility: input.visibility,
      sender_user_id: user.id,
      body: bodyText,
      content_type: "image",
      media_path: path,
      reply_to_message_id: replyToMessageId,
    })
    .select("id, created_at")
    .single();

  if (insErr || !row) throw new Error(insErr?.message ?? "No se pudo guardar");

  const { error: bumpErr } = await supabase
    .from("conversations")
    .update({ last_message_at: row.created_at as string })
    .eq("id", conv.id)
    .eq("organization_id", input.orgId);
  if (bumpErr) throw new Error(bumpErr.message);

  if (input.visibility === "public") {
    void notifyWorkerSendImage({
      organizationId: input.orgId,
      messageId: row.id,
      waChatId: conv.wa_chat_id,
      storagePath: path,
      mimeType: input.mimeType,
      caption: cap && cap.length > 0 ? cap : null,
      quote: waQuote,
    }).catch((e) => console.error("[diwhat] notifyWorkerSendImage", e));
  }

  revalidatePath(`/dashboard/${input.orgId}/inbox`, "layout");
}

export async function postStaffPdfMessage(input: {
  orgId: string;
  conversationId: string;
  visibility: "public" | "internal";
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  caption?: string | null;
  replyToMessageId?: string | null;
}) {
  const { supabase, user } = await requireOrgMember(input.orgId);
  const path = input.storagePath.trim();
  if (path.includes("..") || !path.startsWith(`${input.orgId}/`)) {
    throw new Error("Ruta de PDF inválida");
  }
  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes < 1) {
    throw new Error("Tamaño de archivo inválido");
  }
  if (input.fileSizeBytes > PDF_MAX_BYTES) {
    throw new Error(`El PDF no puede superar ${PDF_MAX_BYTES / 1024 / 1024} MB`);
  }
  const mime = input.mimeType.trim().toLowerCase();
  if (mime !== "application/pdf" && !mime.startsWith("application/pdf;")) {
    throw new Error("Solo se permiten archivos PDF");
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, wa_chat_id, organization_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.orgId)
    .maybeSingle();

  if (convErr || !conv) throw new Error("Conversación no encontrada");

  let replyToMessageId: string | null = null;
  let waQuote: WaQuotePayload | null = null;

  if (input.replyToMessageId?.trim()) {
    const { data: parent, error: parentErr } = await supabase
      .from("messages")
      .select("id, conversation_id, wa_message_id, direction, body, content_type")
      .eq("id", input.replyToMessageId.trim())
      .maybeSingle();

    if (parentErr || !parent) throw new Error("Mensaje citado no encontrado");
    if (parent.conversation_id !== conv.id) throw new Error("Respuesta inválida");

    replyToMessageId = parent.id;
    const wid = parent.wa_message_id?.trim();
    if (wid) {
      waQuote = {
        waMessageId: wid,
        fromMe: parent.direction === "outbound",
        body: typeof parent.body === "string" ? parent.body : "",
        isAudio: parent.content_type === "audio",
        isImage: parent.content_type === "image",
        isPdf: parent.content_type === "pdf",
        isSticker: parent.content_type === "sticker",
      };
    }
  }

  if (input.visibility === "public" && !isWorkerConfigured()) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }

  const safeBase =
    input.fileName.trim().replace(/[/\\]/g, "_").slice(0, 200) || "document.pdf";
  const waFileName = safeBase.toLowerCase().endsWith(".pdf") ? safeBase : `${safeBase}.pdf`;
  const note = input.caption?.trim();
  const bodyText =
    note && note.length > 0 ? `📄 ${waFileName}\n\n${note}` : `📄 ${waFileName}`;

  const { data: row, error: insErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      visibility: input.visibility,
      sender_user_id: user.id,
      body: bodyText,
      content_type: "pdf",
      media_path: path,
      reply_to_message_id: replyToMessageId,
    })
    .select("id, created_at")
    .single();

  if (insErr || !row) throw new Error(insErr?.message ?? "No se pudo guardar");

  const { error: bumpErr } = await supabase
    .from("conversations")
    .update({ last_message_at: row.created_at as string })
    .eq("id", conv.id)
    .eq("organization_id", input.orgId);
  if (bumpErr) throw new Error(bumpErr.message);

  if (input.visibility === "public") {
    void notifyWorkerSendPdf({
      organizationId: input.orgId,
      messageId: row.id,
      waChatId: conv.wa_chat_id,
      storagePath: path,
      fileName: waFileName,
      caption: note && note.length > 0 ? note : null,
      quote: waQuote,
    }).catch((e) => console.error("[diwhat] notifyWorkerSendPdf", e));
  }

  revalidatePath(`/dashboard/${input.orgId}/inbox`, "layout");
}

export async function postStaffVoiceMessage(input: {
  orgId: string;
  conversationId: string;
  visibility: "public" | "internal";
  storagePath: string;
  mimeType: string;
  durationSeconds?: number;
  replyToMessageId?: string | null;
}) {
  const { supabase, user } = await requireOrgMember(input.orgId);
  const path = input.storagePath.trim();
  if (path.includes("..") || !path.startsWith(`${input.orgId}/`)) {
    throw new Error("Ruta de audio inválida");
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, wa_chat_id, organization_id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.orgId)
    .maybeSingle();

  if (convErr || !conv) throw new Error("Conversación no encontrada");

  let replyToMessageId: string | null = null;
  let waQuote: WaQuotePayload | null = null;

  if (input.replyToMessageId?.trim()) {
    const { data: parent, error: parentErr } = await supabase
      .from("messages")
      .select("id, conversation_id, wa_message_id, direction, body, content_type")
      .eq("id", input.replyToMessageId.trim())
      .maybeSingle();

    if (parentErr || !parent) throw new Error("Mensaje citado no encontrado");
    if (parent.conversation_id !== conv.id) throw new Error("Respuesta inválida");

    replyToMessageId = parent.id;
    const wid = parent.wa_message_id?.trim();
    if (wid) {
      waQuote = {
        waMessageId: wid,
        fromMe: parent.direction === "outbound",
        body: typeof parent.body === "string" ? parent.body : "",
        isAudio: parent.content_type === "audio",
        isImage: parent.content_type === "image",
        isPdf: parent.content_type === "pdf",
        isSticker: parent.content_type === "sticker",
      };
    }
  }

  if (input.visibility === "public" && !isWorkerConfigured()) {
    throw new Error(
      "WhatsApp worker no configurado (WHATSAPP_WORKER_URL / WHATSAPP_WORKER_SECRET).",
    );
  }

  const { data: row, error: insErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conv.id,
      direction: "outbound",
      visibility: input.visibility,
      sender_user_id: user.id,
      body: "🎤 Mensaje de voz",
      content_type: "audio",
      media_path: path,
      reply_to_message_id: replyToMessageId,
    })
    .select("id, created_at")
    .single();

  if (insErr || !row) throw new Error(insErr?.message ?? "No se pudo guardar");

  const { error: bumpErr } = await supabase
    .from("conversations")
    .update({ last_message_at: row.created_at as string })
    .eq("id", conv.id)
    .eq("organization_id", input.orgId);
  if (bumpErr) throw new Error(bumpErr.message);

  if (input.visibility === "public") {
    void notifyWorkerSendVoice({
      organizationId: input.orgId,
      messageId: row.id,
      waChatId: conv.wa_chat_id,
      storagePath: path,
      mimeType: input.mimeType,
      seconds: input.durationSeconds,
      quote: waQuote,
    }).catch((e) => console.error("[diwhat] notifyWorkerSendVoice", e));
  }

  revalidatePath(`/dashboard/${input.orgId}/inbox`, "layout");
}
