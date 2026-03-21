/**
 * Proceso aparte de Next.js: Baileys + HTTP mínimo.
 * Env: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_WORKER_SECRET, PORT
 *
 * Carga automática: raíz del repo `../.env.local` y, si existe, `whatsapp-worker/.env` (sobrescribe).
 *
 * WHATSAPP_SYNC_FULL_HISTORY=0 desactiva la petición de historial al móvil (por defecto activo).
 * WHATSAPP_HISTORY_SYNC_WAIT_MS — ms de espera del sync inicial (parche Baileys; default 120000).
 * WHATSAPP_INBOUND_EMAIL_ALERTS=1 activa email SMTP por mensaje inbound en tiempo real.
 */
import { createClient } from "@supabase/supabase-js";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  extensionForMediaMessage,
  extractMessageContent,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isJidUser,
  isLidUser,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import type { WAMessage } from "@whiskeysockets/baileys";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import nodemailer from "nodemailer";
import path from "path";
import pino from "pino";
import { fileURLToPath } from "url";

import { browserRecordedExt, transcodeToOggOpus } from "./convert-audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(workerRoot, "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(workerRoot, ".env"), override: true });

const logger = pino({
  level: process.env.WORKER_DEBUG === "1" ? "info" : "silent",
});
const sockets = new Map<string, ReturnType<typeof makeWASocket>>();

/**
 * Baileys ya ejecuta `resyncAppState(ALL_WA_PATCH_NAMES, true)` durante el sync inicial (tras el history).
 * Si el endpoint manual corre en paralelo, dos transacciones pisan `app-state-sync-version` y aparece
 * `tried remove, but no previous op` en decodeSyncdMutations. Serializamos por org.
 */
const resyncAppStateChains = new Map<string, Promise<void>>();

async function runResyncAppStateSerialized(orgId: string, fn: () => Promise<void>): Promise<void> {
  const prev = resyncAppStateChains.get(orgId) ?? Promise.resolve();
  const p = prev.then(() => fn());
  resyncAppStateChains.set(orgId, p.catch(() => {}));
  await p;
}

/**
 * No usar `ALL_WA_PATCH_NAMES` aquí: la colección `regular_low` a veces devuelve parches que con el
 * LTHash en disco disparan `tried remove, but no previous op` (Baileys decodeSyncdMutations). El sync
 * inicial completo lo hace Baileys al conectar; este subconjunto basta para refrescar sin romper.
 */
const MANUAL_RESYNC_PATCH_NAMES = [
  "critical_block",
  "critical_unblock_low",
  "regular_high",
  "regular",
] as const;

/** Borra caché de versiones syncd en disco (worker parado). Útil si sigue fallando el app state. */
function removeAppStateSyncVersionFiles(orgId: string): number {
  const dir = path.join(process.cwd(), "sessions", orgId);
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith("app-state-sync-version-") && f.endsWith(".json")) {
      try {
        fs.unlinkSync(path.join(dir, f));
        n += 1;
      } catch (e) {
        console.error("[whatsapp-worker] removeAppStateSyncVersionFiles:", f, e);
      }
    }
  }
  if (n && process.env.WORKER_DEBUG === "1") {
    console.log("[whatsapp-worker] eliminados", n, "ficheros app-state-sync-version para org", orgId);
  }
  return n;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY son obligatorias");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
};

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const rawPass = process.env.SMTP_PASS;
  if (!host || !user || rawPass === undefined || rawPass === "") return null;
  const pass = rawPass.replace(/\s/g, "");
  if (!pass) return null;
  const port = Number(process.env.SMTP_PORT ?? "587");
  if (!Number.isFinite(port)) return null;
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  return { host, port, user, pass, secure };
}

function shouldSendInboundEmailAlerts(): boolean {
  const raw = process.env.WHATSAPP_INBOUND_EMAIL_ALERTS?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assertSecret(req: express.Request) {
  const secret = process.env.WHATSAPP_WORKER_SECRET;
  if (!secret || req.headers["x-worker-secret"] !== secret) {
    const err = new Error("unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}

async function patchSession(
  orgId: string,
  patch: Record<string, string | null | undefined>,
) {
  const sb = getSupabase();
  const row = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error: upErr } = await sb
    .from("whatsapp_sessions")
    .update(row)
    .eq("organization_id", orgId)
    .select("organization_id");

  if (upErr) {
    console.error("[whatsapp-worker] patchSession update failed:", upErr.message, upErr);
    throw upErr;
  }
  if (updated?.length) return;

  const { error: insErr } = await sb.from("whatsapp_sessions").insert({
    organization_id: orgId,
    status: "disconnected",
    ...row,
  });
  if (insErr) {
    console.error("[whatsapp-worker] patchSession insert failed:", insErr.message, insErr);
    throw insErr;
  }
}

function textFromMessage(message: Parameters<typeof extractMessageContent>[0]): string | null {
  const c = extractMessageContent(message);
  if (!c) return null;
  if ("conversation" in c && typeof c.conversation === "string" && c.conversation) {
    return c.conversation;
  }
  if ("extendedTextMessage" in c && c.extendedTextMessage?.text) {
    return c.extendedTextMessage.text;
  }
  if ("imageMessage" in c && c.imageMessage?.caption) return String(c.imageMessage.caption);
  if ("videoMessage" in c && c.videoMessage?.caption) return String(c.videoMessage.caption);
  if ("documentMessage" in c && c.documentMessage?.caption) {
    return String(c.documentMessage.caption);
  }
  return null;
}

function waPhoneFromChatId(waChatId: string): string {
  return waChatId.split("@")[0] ?? waChatId;
}

/** Timestamps de WA suelen ir en segundos; a veces en ms. */
function waTimestampToIso(ts: unknown): string {
  if (ts == null) return new Date().toISOString();
  let n: number;
  if (typeof ts === "object" && ts !== null && typeof (ts as { toNumber?: () => number }).toNumber === "function") {
    n = (ts as { toNumber: () => number }).toNumber();
  } else if (typeof ts === "bigint") n = Number(ts);
  else n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function isDirectChatJid(jid: string | undefined | null): jid is string {
  return Boolean(jid && (isJidUser(jid) || isLidUser(jid)));
}

/** Chats que guardamos en la bandeja: 1:1 y grupos (@g.us). */
function isPersistableChatJid(jid: string | undefined | null): jid is string {
  return Boolean(jid && (isJidUser(jid) || isLidUser(jid) || isJidGroup(jid)));
}

function isNoiseJid(jid: string | undefined | null): boolean {
  if (!jid) return true;
  if (isJidStatusBroadcast(jid)) return true;
  if (isJidBroadcast(jid)) return true;
  if (isJidNewsletter(jid)) return true;
  return false;
}

/**
 * Baileys suele mandar `chats.update` / `chats.upsert` con el JID LID (`...@lid`) al enviar/recibir,
 * en paralelo al hilo canónico por número. Eso volvía a insertar la conversación “fantasma” en BD.
 * No hacemos upsert desde la lista de chats para 1:1 LID; la fila canónica viene de mensajes + PN o relink.
 */
function skipBaileysLidDirectChatUpsert(jid: string | undefined | null): boolean {
  return Boolean(jid && isLidUser(jid) && !isJidGroup(jid));
}

/** Convierte un PN de WA (solo dígitos o `...@s.whatsapp.net`) a JID de usuario. */
function normalizeToUserJid(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.includes("@")) {
    return isJidUser(t) ? t : null;
  }
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 8 && /^\d+$/.test(digits)) {
    return `${digits}@s.whatsapp.net`;
  }
  return null;
}

/**
 * Chats 1:1: si WA envía el chat como LID (@lid) pero incluye el número en la clave (sender_pn / participant_pn),
 * usamos el JID de teléfono como canal canónico para no duplicar conversaciones.
 */
function canonicalWaChatIdForDm(remoteJid: string, key: WAMessage["key"]): string {
  if (isJidGroup(remoteJid) || !isLidUser(remoteJid)) {
    return remoteJid;
  }
  const k = key as { senderPn?: string; participantPn?: string };
  for (const candidate of [k.senderPn, k.participantPn]) {
    if (typeof candidate !== "string") continue;
    const phone = normalizeToUserJid(candidate);
    if (phone) return phone;
  }
  return remoteJid;
}

function mergeCustomerLabelForRelink(
  lidLab: string | null | undefined,
  phoneLab: string | null | undefined,
  phoneJid: string,
): string {
  const phoneNum = waPhoneFromChatId(phoneJid);
  const readable = (s: string | null | undefined) => {
    const t = s?.trim();
    if (!t || t === phoneNum) return null;
    return t;
  };
  return readable(phoneLab) ?? readable(lidLab) ?? phoneNum;
}

/**
 * Une la fila `...@lid` con la de número `...@s.whatsapp.net` si ya existían dos conversaciones para el mismo contacto.
 */
async function relinkLidConversationToPhone(
  orgId: string,
  lidJid: string,
  phoneJid: string,
  debug: boolean,
) {
  if (!isLidUser(lidJid) || !isJidUser(phoneJid)) return;
  if (lidJid === phoneJid) return;

  const sb = getSupabase();

  const { data: lidRow } = await sb
    .from("conversations")
    .select("id, customer_label, customer_display_name, wa_avatar_path, last_message_at")
    .eq("organization_id", orgId)
    .eq("wa_chat_id", lidJid)
    .maybeSingle();

  const { data: phoneRow } = await sb
    .from("conversations")
    .select("id, customer_label, customer_display_name, wa_avatar_path, last_message_at")
    .eq("organization_id", orgId)
    .eq("wa_chat_id", phoneJid)
    .maybeSingle();

  if (!lidRow) return;

  if (!phoneRow) {
    const { error } = await sb
      .from("conversations")
      .update({ wa_chat_id: phoneJid })
      .eq("id", lidRow.id)
      .eq("organization_id", orgId);
    if (error) {
      console.error("[whatsapp-worker] relink LID→PN (renombrar):", error);
      return;
    }
    if (debug) {
      console.log("[whatsapp-worker]", `[org ${orgId}]`, "relink: LID →", phoneJid, "(wa_chat_id renombrado)");
    }
    return;
  }

  const { error: updMsgErr } = await sb
    .from("messages")
    .update({ conversation_id: phoneRow.id })
    .eq("conversation_id", lidRow.id);
  if (updMsgErr) {
    console.error("[whatsapp-worker] relink: mover mensajes:", updMsgErr);
    return;
  }

  const lastL = lidRow.last_message_at ? new Date(lidRow.last_message_at).getTime() : 0;
  const lastP = phoneRow.last_message_at ? new Date(phoneRow.last_message_at).getTime() : 0;
  const last_message_at = new Date(Math.max(lastL, lastP)).toISOString();
  const mergedLabel = mergeCustomerLabelForRelink(lidRow.customer_label, phoneRow.customer_label, phoneJid);
  const mergedAvatar = phoneRow.wa_avatar_path ?? lidRow.wa_avatar_path;
  const mergedDisplay =
    phoneRow.customer_display_name?.trim() || lidRow.customer_display_name?.trim() || null;

  const { error: updConvErr } = await sb
    .from("conversations")
    .update({
      customer_label: mergedLabel,
      customer_display_name: mergedDisplay,
      ...(mergedAvatar ? { wa_avatar_path: mergedAvatar } : {}),
      last_message_at,
    })
    .eq("id", phoneRow.id)
    .eq("organization_id", orgId);
  if (updConvErr) {
    console.error("[whatsapp-worker] relink: actualizar conversación PN:", updConvErr);
    return;
  }

  const { error: delErr } = await sb.from("conversations").delete().eq("id", lidRow.id).eq("organization_id", orgId);
  if (delErr) {
    console.error("[whatsapp-worker] relink: borrar fila LID:", delErr);
    return;
  }

  if (debug) {
    console.log("[whatsapp-worker]", `[org ${orgId}]`, "relink: fusionado LID en", phoneJid);
  }
}

/** Misma “persona” en UI (etiqueta o ambos sin nombre real, solo “.”). */
function labelsCompatibleForLidMerge(
  a: { customer_label: string | null; wa_chat_id: string },
  b: { customer_label: string | null; wa_chat_id: string },
): boolean {
  const ta = a.customer_label?.trim();
  const tb = b.customer_label?.trim();
  if (ta && tb && ta === tb) return true;
  const dotish = (t: string | undefined | null) => {
    const x = t?.trim();
    return !x || x === ".";
  };
  if (dotish(ta) && dotish(tb)) return true;
  const na = ta || waPhoneFromChatId(a.wa_chat_id);
  const nb = tb || waPhoneFromChatId(b.wa_chat_id);
  return na === nb;
}

/**
 * Fusiona pares huérfanos LID + número ya guardados en BD (misma etiqueta / “.” y actividad reciente cercana).
 * No sustituye el mapeo real de WA; sirve para limpiar duplicados viejos al pulsar Sincronizar.
 */
async function mergeLidDuplicateConversationsHeuristic(orgId: string, debug: boolean) {
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from("conversations")
    .select("id, wa_chat_id, customer_label, last_message_at")
    .eq("organization_id", orgId);
  if (error || !rows?.length) return;

  const pairs: { lid: string; phone: string }[] = [];
  const usedLids = new Set<string>();
  const dotish = (t: string | null | undefined) => {
    const x = t?.trim();
    return !x || x === ".";
  };

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      const aLid = Boolean(a.wa_chat_id?.endsWith("@lid"));
      const bLid = Boolean(b.wa_chat_id?.endsWith("@lid"));
      if (aLid === bLid) continue;
      const lidRow = aLid ? a : bLid ? b : null;
      const phoneRow =
        lidRow === a
          ? b.wa_chat_id && isJidUser(b.wa_chat_id)
            ? b
            : null
          : a.wa_chat_id && isJidUser(a.wa_chat_id)
            ? a
            : null;
      if (!lidRow || !phoneRow) continue;
      if (!labelsCompatibleForLidMerge(lidRow, phoneRow)) continue;

      const t1 = new Date(lidRow.last_message_at as string).getTime();
      const t2 = new Date(phoneRow.last_message_at as string).getTime();
      /** Mismo hilo LID vs PN: si solo hay “.” / sin nombre, la ventana puede ser más ancha. */
      const maxDeltaMs =
        dotish(lidRow.customer_label) && dotish(phoneRow.customer_label) ? 600_000 : 120_000;
      if (Math.abs(t1 - t2) > maxDeltaMs) continue;

      const lid = lidRow.wa_chat_id as string;
      if (usedLids.has(lid)) continue;
      usedLids.add(lid);
      pairs.push({ lid, phone: phoneRow.wa_chat_id as string });
    }
  }

  for (const p of pairs) {
    try {
      await relinkLidConversationToPhone(orgId, p.lid, p.phone, debug);
      if (debug) {
        console.log("[whatsapp-worker]", `[org ${orgId}]`, "merge heurístico LID→PN", p.lid, "→", p.phone);
      }
    } catch (e) {
      console.error("[whatsapp-worker] mergeLidDuplicateConversationsHeuristic:", e);
    }
  }
}

async function sendInboundEmailAlerts(input: {
  orgId: string;
  conversationId: string;
  waChatId: string;
  customerLabel: string;
  body: string;
  contentType: "text" | "audio" | "image" | "pdf" | "sticker";
  createdAt: string;
}) {
  if (!shouldSendInboundEmailAlerts()) return;
  const cfg = readSmtpConfig();
  if (!cfg) return;

  const sb = getSupabase();
  const { data: presence } = await sb
    .from("organization_web_presence")
    .select("last_seen_at")
    .eq("organization_id", input.orgId)
    .maybeSingle();
  if (presence?.last_seen_at) {
    const lastSeenMs = new Date(presence.last_seen_at).getTime();
    if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 90_000) {
      return;
    }
  }

  const { data: members } = await sb
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", input.orgId);
  const ids = [...new Set((members ?? []).map((m) => m.user_id as string).filter(Boolean))];
  if (!ids.length) return;

  const { data: profiles } = await sb
    .from("profiles")
    .select("email")
    .in("id", ids);
  const emails = [...new Set((profiles ?? []).map((p) => p.email?.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return;

  const { data: org } = await sb
    .from("organizations")
    .select("name")
    .eq("id", input.orgId)
    .maybeSingle();

  const orgName = org?.name?.trim() || "Diwhat";
  const from = process.env.SMTP_FROM?.trim() || cfg.user;
  const base = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const inboxUrl = base
    ? `${base.replace(/\/$/, "")}/dashboard/${input.orgId}/inbox/${input.conversationId}`
    : null;
  const snippet =
    input.contentType === "audio"
      ? "Mensaje de voz"
      : input.contentType === "image"
        ? "Imagen"
        : input.contentType === "pdf"
          ? "PDF"
          : input.contentType === "sticker"
            ? "Sticker"
            : input.body.trim();

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    requireTLS: !cfg.secure && cfg.port === 587,
  });

  const subject = `Nuevo mensaje: ${input.customerLabel}`;
  const text = [
    `Negocio: ${orgName}`,
    `Contacto: ${input.customerLabel} (${input.waChatId})`,
    `Hora: ${new Date(input.createdAt).toLocaleString()}`,
    "",
    snippet,
    "",
    inboxUrl ? `Abrir en Diwhat: ${inboxUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <p><strong>${escapeHtml(orgName)}</strong> recibió un mensaje nuevo.</p>
    <p>Contacto: <strong>${escapeHtml(input.customerLabel)}</strong> (${escapeHtml(input.waChatId)})</p>
    <p>${escapeHtml(snippet)}</p>
    ${inboxUrl ? `<p><a href="${escapeHtml(inboxUrl)}">Abrir conversación</a></p>` : ""}
  `;

  await transporter.sendMail({
    from,
    to: from,
    bcc: emails.join(", "),
    subject,
    text,
    html,
  });
}

/**
 * Cómo mostrar el contacto en la bandeja:
 * - verifiedName: negocio verificado
 * - name: nombre que guardaste en el teléfono (agenda) — es lo que suele querer el negocio
 * - notify: nombre público / “como se registró” en WhatsApp (push name)
 */
function displayNameFromContactPatch(u: {
  verifiedName?: string | null;
  name?: string | null;
  notify?: string | null;
}): string | null {
  const v = u.verifiedName?.trim() || u.name?.trim() || u.notify?.trim();
  return v || null;
}

function contactHasAgendaOrBizName(u: {
  verifiedName?: string | null;
  name?: string | null;
}): boolean {
  return Boolean(u.verifiedName?.trim() || u.name?.trim());
}

const CONTACT_ONLY_LAST_MSG_AT = new Date(0).toISOString();

/**
 * Sincroniza contactos de WhatsApp con `conversations`.
 * Antes solo hacíamos UPDATE: si no existía fila, el chat no aparecía en Diwhat.
 * Ahora hacemos upsert (nombre de agenda o, si no hay, al menos el JID/teléfono).
 */
async function patchConversationLabelsFromContact(
  sb: ReturnType<typeof getSupabase>,
  orgId: string,
  u: {
    id?: string;
    lid?: string;
    jid?: string;
    verifiedName?: string | null;
    name?: string | null;
    notify?: string | null;
  },
  debug: boolean,
) {
  const display = displayNameFromContactPatch(u);
  const onlyPublicWaName = !contactHasAgendaOrBizName(u) && Boolean(u.notify?.trim());

  const ids = new Set<string>();
  if (u.id) ids.add(u.id);
  if (u.lid) ids.add(u.lid);
  if (u.jid) ids.add(u.jid);

  for (const wa of ids) {
    if (!isJidUser(wa) && !isLidUser(wa)) continue;
    if (skipBaileysLidDirectChatUpsert(wa)) continue;

    const phone = waPhoneFromChatId(wa);

    if (display) {
      if (onlyPublicWaName) {
        const { data: row } = await sb
          .from("conversations")
          .select("customer_label")
          .eq("organization_id", orgId)
          .eq("wa_chat_id", wa)
          .maybeSingle();
        const prev = row?.customer_label?.trim();
        if (prev && prev !== phone) {
          if (debug) {
            console.log(
              "[whatsapp-worker] contacto: omitir solo-notify; se mantiene etiqueta (agenda)",
              wa,
              prev,
            );
          }
          continue;
        }
      }
      try {
        await upsertConversation(orgId, wa, display, { lastMessageAt: CONTACT_ONLY_LAST_MSG_AT });
        if (debug) {
          console.log("[whatsapp-worker] contact → upsert", display, wa);
        }
      } catch (e) {
        console.error("[whatsapp-worker] contact → upsert:", e);
      }
    } else {
      try {
        await upsertConversation(orgId, wa, undefined, { lastMessageAt: CONTACT_ONLY_LAST_MSG_AT });
        if (debug) {
          console.log("[whatsapp-worker] contact → upsert (sin nombre, solo JID)", wa);
        }
      } catch (e) {
        console.error("[whatsapp-worker] contact → upsert (sin nombre):", e);
      }
    }
  }

  const lid = u.lid?.trim();
  const jidRaw = u.jid?.trim();
  if (lid && jidRaw) {
    const jid = normalizeToUserJid(jidRaw) ?? jidRaw;
    if (isLidUser(lid) && isJidUser(jid)) {
      try {
        await relinkLidConversationToPhone(orgId, lid, jid, debug);
      } catch (e) {
        console.error("[whatsapp-worker] contact relink LID↔PN:", e);
      }
    }
  }
}

type UpsertConversationOpts = { lastMessageAt?: string; lastInboundAt?: string };

async function upsertConversation(
  orgId: string,
  waChatId: string,
  label: string | undefined,
  opts?: UpsertConversationOpts,
) {
  const sb = getSupabase();
  const phone = waPhoneFromChatId(waChatId);
  const trimmed = label?.trim();

  const { data: existing } = await sb
    .from("conversations")
    .select("id, customer_label, last_message_at, last_inbound_at")
    .eq("organization_id", orgId)
    .eq("wa_chat_id", waChatId)
    .maybeSingle();

  const prev = existing?.customer_label?.trim();
  // No pisar nombre de agenda / sync de contactos con el pushName de cada mensaje (nombre público WA).
  const customer_label = prev && prev !== phone ? prev : trimmed || phone;

  let candidateTs = opts?.lastMessageAt ?? new Date().toISOString();
  // Sin mensajes aún usábamos epoch → orden DESC los dejaba al final; al crear fila nueva, «ahora» para que se vean arriba.
  if (!existing && candidateTs === CONTACT_ONLY_LAST_MSG_AT) {
    candidateTs = new Date().toISOString();
  }
  const last_message_at =
    existing?.last_message_at &&
    new Date(existing.last_message_at).getTime() > new Date(candidateTs).getTime()
      ? existing.last_message_at
      : candidateTs;
  const last_inbound_at =
    opts?.lastInboundAt &&
    (!existing?.last_inbound_at ||
      new Date(opts.lastInboundAt).getTime() > new Date(existing.last_inbound_at).getTime())
      ? opts.lastInboundAt
      : existing?.last_inbound_at ?? null;

  const { data, error } = await sb
    .from("conversations")
    .upsert(
      {
        organization_id: orgId,
        wa_chat_id: waChatId,
        customer_label,
        last_message_at,
        last_inbound_at,
      },
      { onConflict: "organization_id,wa_chat_id" },
    )
    .select("id")
    .single();

  if (error) throw error;
  return data!.id as string;
}

/**
 * Crea/actualiza filas en `conversations` desde la lista de chats de Baileys
 * (eventos `chats.upsert` o `messaging-history.set`).
 */
async function upsertConversationsFromChatList(
  orgId: string,
  chats: Array<{
    id?: string | null;
    name?: string | null;
    lastMessageRecvTimestamp?: number;
    lastMsgTimestamp?: unknown;
    conversationTimestamp?: unknown;
  }>,
  debug: boolean,
) {
  for (const chat of chats) {
    const id = chat.id;
    if (!id || isNoiseJid(id)) continue;
    if (!isDirectChatJid(id) && !isJidGroup(id)) continue;
    if (skipBaileysLidDirectChatUpsert(id)) continue;
    const tsRaw =
      typeof chat.lastMessageRecvTimestamp === "number"
        ? chat.lastMessageRecvTimestamp
        : (chat.lastMsgTimestamp ?? chat.conversationTimestamp);
    const lastIso = waTimestampToIso(tsRaw);
    try {
      await upsertConversation(orgId, id, chat.name ?? undefined, { lastMessageAt: lastIso });
    } catch (e) {
      console.error("[whatsapp-worker] upsertConversationsFromChatList:", e);
    }
  }
  if (debug) {
    console.log("[whatsapp-worker] [org", orgId, "] upsertConversationsFromChatList n=", chats.length);
  }
}

/** Grupos en los que participas (no siempre llegan por `messaging-history.set`). */
async function upsertParticipatingGroups(
  orgId: string,
  sock: ReturnType<typeof makeWASocket>,
  debug: boolean,
) {
  try {
    const map = await sock.groupFetchAllParticipating();
    const entries = Object.entries(map ?? {});
    if (debug) {
      console.log("[whatsapp-worker] [org", orgId, "] groupFetchAllParticipating n=", entries.length);
    }
    for (const [jid, meta] of entries) {
      if (!isJidGroup(jid)) continue;
      const subj = meta.subject?.trim();
      await upsertConversation(orgId, jid, subj || undefined, {
        lastMessageAt: CONTACT_ONLY_LAST_MSG_AT,
      });
    }
  } catch (e) {
    console.error("[whatsapp-worker] upsertParticipatingGroups:", e);
  }
}

const AUDIO_LABEL = "🎤 Mensaje de voz";
const IMAGE_LABEL = "📷 Imagen";
const STICKER_LABEL = "🎨 Sticker";
/** Máximo tamaño PDF guardado / enviado (alineado con la web). */
const PDF_MAX_BYTES = 5 * 1024 * 1024;

/** JIDs a probar para `profilePictureUrl` (LID vs número `sender_pn` / `participant_pn`). */
function jidsForProfilePicture(waChatId: string, key?: WAMessage["key"]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (j: string | undefined | null) => {
    if (!j || typeof j !== "string") return;
    const t = j.trim();
    if (!t) return;
    const full = t.includes("@") ? t : `${t}@s.whatsapp.net`;
    if (seen.has(full)) return;
    seen.add(full);
    out.push(full);
  };
  push(waChatId);
  if (key) {
    const k = key as { senderPn?: string; participantPn?: string };
    push(k.senderPn);
    push(k.participantPn);
  }
  return out;
}

/**
 * Descarga foto de perfil (preview) o icono de grupo y la sube a Storage si la conversación aún no tiene `wa_avatar_path`.
 */
async function refreshWaAvatarIfNeeded(
  orgId: string,
  convId: string,
  waChatId: string,
  sock: ReturnType<typeof makeWASocket>,
  debug: boolean,
  messageKey?: WAMessage["key"],
) {
  const sb = getSupabase();
  const { data: row } = await sb
    .from("conversations")
    .select("wa_avatar_path")
    .eq("id", convId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (row?.wa_avatar_path) return;

  const jids = jidsForProfilePicture(waChatId, messageKey);
  let picUrl: string | undefined;
  for (const jid of jids) {
    try {
      picUrl = await sock.profilePictureUrl(jid, "preview", 12_000);
      if (picUrl) break;
    } catch (e) {
      if (debug) {
        console.log(
          "[whatsapp-worker]",
          `[org ${orgId}]`,
          "profilePictureUrl falló para",
          jid,
          (e as Error).message,
        );
      }
    }
  }
  if (!picUrl) {
    if (debug) {
      console.log("[whatsapp-worker]", `[org ${orgId}]`, "sin URL de foto (probado:", jids.join(", "), ")");
    }
    return;
  }

  try {
    const res = await fetch(picUrl);
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 16 || buf.length > 2_000_000) return;

    const rawCt = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const contentType = rawCt.startsWith("image/") ? rawCt : "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const storagePath = `${orgId}/wa-avatar-${convId}.${ext}`;

    const { error: upErr } = await sb.storage.from("message_media").upload(storagePath, buf, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;

    const { error: updErr } = await sb
      .from("conversations")
      .update({ wa_avatar_path: storagePath })
      .eq("id", convId)
      .eq("organization_id", orgId);
    if (updErr) throw updErr;

    if (debug) {
      console.log("[whatsapp-worker]", `[org ${orgId}]`, "wa_avatar guardado", storagePath);
    }
  } catch (e) {
    console.warn("[whatsapp-worker] refreshWaAvatarIfNeeded:", e);
  }
}

/** Rellena fotos de perfil para conversaciones que aún no tienen `wa_avatar_path` (p. ej. tras Sincronizar). */
async function backfillMissingAvatars(
  orgId: string,
  sock: ReturnType<typeof makeWASocket>,
  debug: boolean,
) {
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from("conversations")
    .select("id, wa_chat_id")
    .eq("organization_id", orgId)
    .is("wa_avatar_path", null)
    .limit(50);
  if (error) {
    if (debug) console.log("[whatsapp-worker] backfillMissingAvatars:", error.message);
    return;
  }
  if (!rows?.length) return;
  for (const r of rows) {
    await refreshWaAvatarIfNeeded(orgId, r.id as string, r.wa_chat_id as string, sock, debug, undefined);
  }
  if (debug) {
    console.log(
      "[whatsapp-worker]",
      `[org ${orgId}]`,
      "backfillMissingAvatars: revisadas",
      rows.length,
      "conversaciones sin foto",
    );
  }
}

/**
 * Persiste texto, caption, imagen o nota de voz. `allowAudioDownload`: en historial masivo suele ir en false (solo placeholder).
 *
 * Incluye mensajes `fromMe` (teléfono / WhatsApp Web oficial): antes se omitían en tiempo real y no llegaban a Diwhat.
 * Dedup: `wa_message_id` único. Merge: si Diwhat insertó una fila outbound sin `wa_message_id`, se vincula al evento Baileys.
 */
async function persistSyncedMessage(
  orgId: string,
  sb: ReturnType<typeof getSupabase>,
  sock: ReturnType<typeof makeWASocket>,
  m: WAMessage,
  allowAudioDownload: boolean,
  notifyInboundEmail: boolean,
  debug: boolean,
) {
  const og = `[org ${orgId}]`;
  if (!m.message) return;
  const remoteJid = m.key.remoteJid;
  if (isNoiseJid(remoteJid) || !isPersistableChatJid(remoteJid)) {
    if (debug) console.log("[whatsapp-worker]", og, "skip: jid", remoteJid);
    return;
  }

  const waChatId = canonicalWaChatIdForDm(remoteJid, m.key);
  if (waChatId !== remoteJid && isLidUser(remoteJid) && isJidUser(waChatId)) {
    try {
      await relinkLidConversationToPhone(orgId, remoteJid, waChatId, debug);
    } catch (e) {
      console.error("[whatsapp-worker]", og, "relink LID→PN:", e);
    }
  }

  const createdAt = waTimestampToIso(m.messageTimestamp);
  const direction = m.key.fromMe ? "outbound" : "inbound";
  const waMessageId = m.key.id ?? undefined;
  const isGroup = Boolean(isJidGroup(remoteJid));
  const convLabel = isGroup ? undefined : m.pushName ?? undefined;

  const norm = normalizeMessageContent(m.message);
  const contentTypeKey = norm ? getContentType(norm) : undefined;

  let body: string;
  let content_type: "text" | "audio" | "image" | "pdf" | "sticker" = "text";
  let media_path: string | null = null;

  const historyImages = process.env.WHATSAPP_DOWNLOAD_HISTORY_IMAGES !== "0";
  const allowImageDownload = allowAudioDownload || historyImages;

  if (contentTypeKey === "imageMessage" && norm) {
    content_type = "image";
    const imgNode = (norm as { imageMessage?: { caption?: string | null; mimetype?: string | null } })
      .imageMessage;
    const cap = imgNode?.caption?.trim();
    const prefix =
      isGroup && !m.key.fromMe && m.pushName?.trim() ? `${m.pushName.trim()}: ` : "";
    body = cap ? `${prefix}${cap}` : `${prefix}${IMAGE_LABEL}`;
    if (allowImageDownload) {
      try {
        const buffer = await downloadMediaMessage(m, "buffer", {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });
        const extRaw = extensionForMediaMessage(norm);
        const ext = extRaw && extRaw.length > 0 ? extRaw.replace(/^\./, "") : "jpg";
        const fileName = `${randomUUID()}.${ext}`;
        const storagePath = `${orgId}/${fileName}`;
        const rawMime = imgNode?.mimetype;
        const contentType =
          typeof rawMime === "string" && rawMime.trim()
            ? rawMime.split(";")[0]!.trim()
            : "image/jpeg";
        const { error: upErr } = await sb.storage.from("message_media").upload(storagePath, buffer, {
          contentType,
          upsert: false,
        });
        if (upErr) throw upErr;
        media_path = storagePath;
        if (debug) console.log("[whatsapp-worker]", og, "imagen guardada", storagePath, waMessageId);
      } catch (e) {
        console.warn("[whatsapp-worker]", og, "imagen sin archivo:", (e as Error).message, waMessageId);
      }
    } else if (debug) {
      console.log("[whatsapp-worker]", og, "imagen (solo placeholder, historial)", waMessageId);
    }
  } else if (contentTypeKey === "stickerMessage" && norm) {
    content_type = "sticker";
    const prefix =
      isGroup && !m.key.fromMe && m.pushName?.trim() ? `${m.pushName.trim()}: ` : "";
    body = `${prefix}${STICKER_LABEL}`;
    if (allowImageDownload) {
      try {
        const buffer = await downloadMediaMessage(m, "buffer", {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });
        const extRaw = extensionForMediaMessage(norm);
        const ext = extRaw && extRaw.length > 0 ? extRaw.replace(/^\./, "") : "webp";
        const fileName = `${randomUUID()}.${ext}`;
        const storagePath = `${orgId}/${fileName}`;
        const rawMime = (norm as { stickerMessage?: { mimetype?: string | null } }).stickerMessage
          ?.mimetype;
        const contentType =
          typeof rawMime === "string" && rawMime.trim()
            ? rawMime.split(";")[0]!.trim()
            : "image/webp";
        const { error: upErr } = await sb.storage.from("message_media").upload(storagePath, buffer, {
          contentType,
          upsert: false,
        });
        if (upErr) throw upErr;
        media_path = storagePath;
        if (debug) console.log("[whatsapp-worker]", og, "sticker guardado", storagePath, waMessageId);
      } catch (e) {
        console.warn("[whatsapp-worker]", og, "sticker sin archivo:", (e as Error).message, waMessageId);
      }
    } else if (debug) {
      console.log("[whatsapp-worker]", og, "sticker (solo placeholder, historial)", waMessageId);
    }
  } else if (contentTypeKey === "audioMessage" && norm) {
    content_type = "audio";
    const prefix =
      isGroup && !m.key.fromMe && m.pushName?.trim() ? `${m.pushName.trim()}: ` : "";
    body = `${prefix}${AUDIO_LABEL}`;
    if (allowAudioDownload) {
      try {
        const buffer = await downloadMediaMessage(m, "buffer", {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });
        const extRaw = extensionForMediaMessage(norm);
        const ext = extRaw && extRaw.length > 0 ? extRaw.replace(/^\./, "") : "ogg";
        const fileName = `${randomUUID()}.${ext}`;
        const storagePath = `${orgId}/${fileName}`;
        const rawMime = (norm as { audioMessage?: { mimetype?: string | null } }).audioMessage
          ?.mimetype;
        const contentType =
          typeof rawMime === "string" && rawMime.trim()
            ? rawMime.split(";")[0]!.trim()
            : "application/octet-stream";
        const { error: upErr } = await sb.storage.from("message_media").upload(storagePath, buffer, {
          contentType,
          upsert: false,
        });
        if (upErr) throw upErr;
        media_path = storagePath;
        if (debug) console.log("[whatsapp-worker]", og, "audio guardado", storagePath, waMessageId);
      } catch (e) {
        console.warn("[whatsapp-worker]", og, "audio sin archivo:", (e as Error).message, waMessageId);
      }
    } else if (debug) {
      console.log("[whatsapp-worker]", og, "audio (solo placeholder, historial)", waMessageId);
    }
  } else if (contentTypeKey === "documentMessage" && norm) {
    const docNode = (norm as {
      documentMessage?: { mimetype?: string | null; fileName?: string | null; caption?: string | null };
    }).documentMessage;
    const rawMime = docNode?.mimetype;
    const mime =
      typeof rawMime === "string" && rawMime.trim()
        ? rawMime.split(";")[0]!.trim().toLowerCase()
        : "";
    const fileLabel = docNode?.fileName?.trim() || "document.pdf";
    const prefix =
      isGroup && !m.key.fromMe && m.pushName?.trim() ? `${m.pushName.trim()}: ` : "";
    const cap = docNode?.caption?.trim();

    if (mime !== "application/pdf") {
      body = cap ? `${prefix}${cap}` : `${prefix}📎 ${fileLabel}`;
      content_type = "text";
      media_path = null;
    } else {
      content_type = "pdf";
      body = cap ? `${prefix}${cap}` : `${prefix}📄 ${fileLabel}`;
      if (allowImageDownload) {
        try {
          const buffer = await downloadMediaMessage(m, "buffer", {}, {
            logger: sock.logger,
            reuploadRequest: sock.updateMediaMessage,
          });
          if (buffer.length > PDF_MAX_BYTES) {
            body = cap
              ? `${prefix}${cap}`
              : `${prefix}📄 ${fileLabel} (supera ${PDF_MAX_BYTES / 1024 / 1024} MB, no guardado)`;
            content_type = "text";
            media_path = null;
          } else {
            const storagePath = `${orgId}/${randomUUID()}.pdf`;
            const { error: upErr } = await sb.storage.from("message_media").upload(storagePath, buffer, {
              contentType: "application/pdf",
              upsert: false,
            });
            if (upErr) throw upErr;
            media_path = storagePath;
            if (debug) console.log("[whatsapp-worker]", og, "pdf guardado", storagePath, waMessageId);
          }
        } catch (e) {
          console.warn("[whatsapp-worker]", og, "pdf sin archivo:", (e as Error).message, waMessageId);
          body = cap ? `${prefix}${cap}` : `${prefix}📄 ${fileLabel}`;
          content_type = "text";
          media_path = null;
        }
      } else if (debug) {
        console.log("[whatsapp-worker]", og, "pdf (solo placeholder, historial)", waMessageId);
      }
    }
  } else {
    const text = textFromMessage(m.message);
    if (!text) {
      if (debug) {
        const top = m.message ? Object.keys(m.message).slice(0, 12).join(",") : "";
        console.log("[whatsapp-worker]", og, "skip: sin texto ni imagen ni audio", m.key?.id, "keys=", top);
      }
      return;
    }
    body =
      isGroup && !m.key.fromMe && m.pushName?.trim()
        ? `${m.pushName.trim()}: ${text}`
        : text;
  }

  try {
    // Eco outbound: el staff ya insertó el mensaje y POST /send fijó wa_message_id; no hacer upsert con LID antes de comprobarlo (evita fila duplicada arriba).
    if (waMessageId) {
      const { data: existing } = await sb
        .from("messages")
        .select("id, conversation_id, conversations!inner(organization_id, wa_chat_id)")
        .eq("wa_message_id", waMessageId)
        .eq("conversations.organization_id", orgId)
        .maybeSingle();
      if (existing) {
        const raw = existing.conversations as
          | { wa_chat_id: string; organization_id: string }
          | { wa_chat_id: string; organization_id: string }[]
          | null;
        const conv = Array.isArray(raw) ? raw[0] : raw;
        if (!conv?.wa_chat_id) return;
        const effectiveWaChatId = conv.wa_chat_id;
        const convId = existing.conversation_id as string;
        await upsertConversation(orgId, effectiveWaChatId, convLabel, {
          lastMessageAt: createdAt,
          ...(direction === "inbound" ? { lastInboundAt: createdAt } : {}),
        });
        void refreshWaAvatarIfNeeded(orgId, convId, effectiveWaChatId, sock, debug, m.key);
        if (debug) {
          console.log(
            "[whatsapp-worker]",
            og,
            "eco: wa_message_id ya en BD → sin conversación LID paralela",
            waMessageId,
            effectiveWaChatId,
          );
        }
        return;
      }
    }

    // Eco outbound con LID: a veces llega antes que POST /send fije wa_message_id. Buscar pending en la org
    // ANTES de upsert(LID) para no insertar conversación duplicada (Realtime la pintaría y luego desaparecería).
    if (direction === "outbound" && waMessageId && isLidUser(remoteJid) && !isJidGroup(remoteJid)) {
      const pendingFirst = await findPendingStaffOutbound(
        orgId,
        sb,
        "",
        body,
        content_type,
        remoteJid,
      );
      if (pendingFirst?.id) {
        const { data: convMeta } = await sb
          .from("conversations")
          .select("id, wa_chat_id")
          .eq("id", pendingFirst.conversation_id as string)
          .eq("organization_id", orgId)
          .maybeSingle();
        if (convMeta?.wa_chat_id) {
          await upsertConversation(orgId, convMeta.wa_chat_id, convLabel, {
            lastMessageAt: createdAt,
          });
          const { error: upErr } = await sb
            .from("messages")
            .update({
              wa_message_id: waMessageId,
              created_at: createdAt,
            })
            .eq("id", pendingFirst.id);
          if (upErr) throw upErr;
          void refreshWaAvatarIfNeeded(orgId, convMeta.id, convMeta.wa_chat_id, sock, debug, m.key);
          if (debug) {
            console.log(
              "[whatsapp-worker]",
              og,
              "eco LID: pending (org) antes de upsert LID →",
              convMeta.wa_chat_id,
            );
          }
          return;
        }
      }
    }

    const convId = await upsertConversation(orgId, waChatId, convLabel, {
      lastMessageAt: createdAt,
      ...(direction === "inbound" ? { lastInboundAt: createdAt } : {}),
    });

    if (direction === "outbound" && waMessageId) {
      const pending = await findPendingStaffOutbound(
        orgId,
        sb,
        convId,
        body,
        content_type,
        remoteJid,
      );

      if (pending?.id) {
        const { error: upErr } = await sb
          .from("messages")
          .update({
            wa_message_id: waMessageId,
            created_at: createdAt,
          })
          .eq("id", pending.id);
        if (upErr) throw upErr;
        if (debug) {
          console.log("[whatsapp-worker]", og, "merge: outbound Diwhat → wa_message_id", waMessageId, pending.id);
        }
        const pendingConvId = pending.conversation_id as string;
        const { data: convMeta } = await sb
          .from("conversations")
          .select("wa_chat_id")
          .eq("id", pendingConvId)
          .eq("organization_id", orgId)
          .maybeSingle();
        const refreshWa = (convMeta?.wa_chat_id as string | undefined) ?? waChatId;
        void refreshWaAvatarIfNeeded(orgId, pendingConvId, refreshWa, sock, debug, m.key);

        if (pendingConvId !== convId) {
          const { count: orphanCount } = await sb
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", convId);
          if ((orphanCount ?? 0) === 0) {
            await sb.from("conversations").delete().eq("id", convId).eq("organization_id", orgId);
            if (debug) {
              console.log("[whatsapp-worker]", og, "eco LID: conversación huérfana eliminada", convId);
            }
          }
        }
        return;
      }
    }

    const { error } = await sb.from("messages").insert({
      conversation_id: convId,
      wa_message_id: waMessageId,
      direction,
      visibility: "public",
      body,
      content_type,
      media_path,
      created_at: createdAt,
    });
    if (error?.code === "23505") return;
    if (error) throw error;
    if (direction === "inbound" && notifyInboundEmail) {
      const title = (convLabel?.trim() || waPhoneFromChatId(waChatId)).trim();
      void sendInboundEmailAlerts({
        orgId,
        conversationId: convId,
        waChatId,
        customerLabel: title,
        body,
        contentType: content_type,
        createdAt,
      }).catch((e) => {
        console.error("[whatsapp-worker] inbound email alert:", e);
      });
    }
    if (debug) {
      const jidNote = waChatId !== remoteJid ? ` (remoteJid=${remoteJid})` : "";
      console.log(
        "[whatsapp-worker]",
        og,
        "mensaje guardado",
        content_type,
        direction,
        waMessageId,
        waChatId + jidNote,
      );
    }
    void refreshWaAvatarIfNeeded(orgId, convId, waChatId, sock, debug, m.key);
  } catch (e) {
    console.error("[whatsapp-worker]", og, "persist mensaje:", e);
  }
}

/** Outbound staff: el eco de Baileys puede venir con `...@lid` mientras la fila en BD usa `...@s.whatsapp.net`. */
async function findPendingStaffOutbound(
  orgId: string,
  sb: ReturnType<typeof getSupabase>,
  convId: string,
  body: string,
  content_type: "text" | "audio" | "image" | "pdf" | "sticker",
  remoteJid: string,
) {
  const since = new Date(Date.now() - 120_000).toISOString();

  const buildOrgWide = () => {
    let q = sb
      .from("messages")
      .select("id, conversation_id, conversations!inner(organization_id)")
      .eq("conversations.organization_id", orgId)
      .eq("direction", "outbound")
      .is("wa_message_id", null)
      .not("sender_user_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (content_type === "image") {
      q = q.eq("content_type", "image");
    } else if (content_type === "pdf") {
      q = q.eq("content_type", "pdf");
    } else if (content_type === "sticker") {
      q = q.eq("content_type", "sticker");
    } else {
      q = q.eq("body", body);
    }
    return q;
  };

  const buildInConv = () => {
    if (!convId) return null;
    let q = sb
      .from("messages")
      .select("id, conversation_id")
      .eq("conversation_id", convId)
      .eq("direction", "outbound")
      .is("wa_message_id", null)
      .not("sender_user_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (content_type === "image") {
      q = q.eq("content_type", "image");
    } else if (content_type === "pdf") {
      q = q.eq("content_type", "pdf");
    } else if (content_type === "sticker") {
      q = q.eq("content_type", "sticker");
    } else {
      q = q.eq("body", body);
    }
    return q;
  };

  // Chats 1:1 LID: el pending del staff está bajo el JID de teléfono; buscar en la org primero.
  if (isLidUser(remoteJid) && !isJidGroup(remoteJid)) {
    const { data: orgWide } = await buildOrgWide().maybeSingle();
    if (orgWide?.id) return orgWide;
  }

  const inQ = buildInConv();
  if (inQ) {
    const { data: inConv } = await inQ.maybeSingle();
    if (inConv?.id) return inConv;
  }

  return null;
}

function endSocketForOrg(orgId: string) {
  const existing = sockets.get(orgId);
  if (!existing) return;
  try {
    existing.end(undefined);
  } catch (e) {
    console.error("[whatsapp-worker] end socket:", e);
  }
  sockets.delete(orgId);
}

/** Credenciales locales a veces quedan inconsistentes tras "Stream Errored" / restart required. */
function clearSessionDir(orgId: string) {
  const dir = path.join(process.cwd(), "sessions", orgId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log("[whatsapp-worker] sesión local borrada:", dir);
    }
  } catch (e) {
    console.error("[whatsapp-worker] clearSessionDir:", e);
  }
}

type StartBaileysOptions = { skipInitialStatusReset?: boolean };

async function startBaileys(orgId: string, opts?: StartBaileysOptions) {
  // Cada "Conectar" debe poder regenerar QR: cerrar socket previo si existe
  endSocketForOrg(orgId);

  // Tras reinicio del proceso, `restoreConnectedSessions` reabre el socket sin tocar la fila en DB.
  if (!opts?.skipInitialStatusReset) {
    // Salir de estado `error` y dejar fila lista para un intento nuevo (solo `last_error` no actualiza `status`)
    try {
      await patchSession(orgId, {
        status: "disconnected",
        last_error: null,
        qr_payload: null,
      });
    } catch (e) {
      console.error("[whatsapp-worker] patchSession (reset al conectar):", e);
    }
  }

  const dir = path.join(process.cwd(), "sessions", orgId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion().catch((e) => {
    console.error("[whatsapp-worker] fetchLatestBaileysVersion:", e);
    return { version: [2, 3000, 0] as [number, number, number] };
  });

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    browser: Browsers.macOS("Chrome"),
    connectTimeoutMs: 90_000,
    keepAliveIntervalMs: 25_000,
    qrTimeout: 120_000,
    syncFullHistory: process.env.WHATSAPP_SYNC_FULL_HISTORY !== "0",
    printQRInTerminal: false,
  });

  sockets.set(orgId, sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    try {
      if (qr) {
        await patchSession(orgId, { status: "qr", qr_payload: qr, last_error: null });
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        const errStr = String(lastDisconnect?.error ?? "closed");

        // Tras escanear el QR, WA manda 515 "restart required": hay que reconectar con las creds
        // guardadas en disco. NO borrar ./sessions (si no, el móvil se queda "cargando" para siempre).
        if (
          statusCode === DisconnectReason.restartRequired ||
          statusCode === 515
        ) {
          console.log(
            "[whatsapp-worker] Reinicio de socket pedido por WhatsApp (normal tras emparejar). Reconectando…",
          );
          sockets.delete(orgId);
          await patchSession(orgId, {
            status: "disconnected",
            last_error: null,
            qr_payload: null,
          });
          setTimeout(() => {
            void startBaileys(orgId).catch((err) =>
              console.error("[whatsapp-worker] reconexión tras 515:", err),
            );
          }, 800);
          return;
        }

        const needsFreshPair =
          statusCode === DisconnectReason.badSession ||
          /stream errored|restart required/i.test(errStr);

        const isNetworkLike =
          /connection failure|connection closed|connection lost|timed out|econnreset|enotfound|socket hang|unavailable|network|getaddrinfo/i.test(
            errStr,
          );

        // 401 tras "logging in..." = credenciales locales inválidas/revocadas (no es fallo de VPN).
        const isAuthRejected =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.forbidden ||
          statusCode === 401 ||
          statusCode === 403;

        if (needsFreshPair) {
          clearSessionDir(orgId);
          await patchSession(orgId, {
            status: "disconnected",
            last_error:
              "WhatsApp cerró el enlace (reinicio necesario). Sesión local borrada: pulsa «Conectar» otra vez y escanea un QR nuevo.",
            qr_payload: null,
          });
        } else if (isAuthRejected) {
          clearSessionDir(orgId);
          console.error("[whatsapp-worker] sesión rechazada por WA:", errStr, "statusCode=", statusCode);
          await patchSession(orgId, {
            status: "disconnected",
            last_error:
              "WhatsApp rechazó la sesión guardada en este equipo (cerrada, revocada o incompleta). Carpeta del worker borrada. Pulsa «Conectar» y escanea un QR nuevo en el móvil → Dispositivos vinculados.",
            qr_payload: null,
          });
        } else if (isNetworkLike) {
          console.error("[whatsapp-worker] cierre tipo red:", errStr, "statusCode=", statusCode);
          await patchSession(orgId, {
            status: "disconnected",
            last_error:
              "No se pudo conectar con los servidores de WhatsApp (red, firewall o VPN). Prueba otra red o sin VPN. En la terminal del worker: WORKER_DEBUG=1 npm run dev",
            qr_payload: null,
          });
        } else {
          await patchSession(orgId, {
            status: shouldReconnect ? "disconnected" : "error",
            last_error: shouldReconnect ? null : errStr,
            qr_payload: null,
          });
        }
        sockets.delete(orgId);
      } else if (connection === "open") {
        await patchSession(orgId, { status: "connected", qr_payload: null, last_error: null });
      }
    } catch (e) {
      console.error("[whatsapp-worker] connection.update handler:", e);
    }
  });

  sock.ev.on("contacts.update", async (patchList) => {
    const sb = getSupabase();
    const debug = process.env.WORKER_DEBUG === "1";
    for (const u of patchList) {
      await patchConversationLabelsFromContact(sb, orgId, u, debug);
    }
  });

  sock.ev.on("contacts.upsert", async (list) => {
    const sb = getSupabase();
    const debug = process.env.WORKER_DEBUG === "1";
    for (const u of list) {
      await patchConversationLabelsFromContact(sb, orgId, u, debug);
    }
  });

  sock.ev.on("chats.phoneNumberShare", async ({ lid, jid }) => {
    const debug = process.env.WORKER_DEBUG === "1";
    const phoneJid = normalizeToUserJid(jid) ?? jid;
    if (!lid || !phoneJid || !isLidUser(lid) || !isJidUser(phoneJid)) return;
    try {
      await relinkLidConversationToPhone(orgId, lid, phoneJid, debug);
    } catch (e) {
      console.error("[whatsapp-worker] chats.phoneNumberShare:", e);
    }
  });

  sock.ev.on("groups.upsert", async (list) => {
    const debug = process.env.WORKER_DEBUG === "1";
    if (debug) console.log("[whatsapp-worker] [org", orgId, "] groups.upsert n=", list.length);
    for (const g of list) {
      const id = g.id;
      if (!id || !isJidGroup(id)) continue;
      try {
        await upsertConversation(orgId, id, g.subject?.trim() || undefined, {
          lastMessageAt: CONTACT_ONLY_LAST_MSG_AT,
        });
      } catch (e) {
        console.error("[whatsapp-worker] groups.upsert:", e);
      }
    }
  });

  sock.ev.on("groups.update", async (list) => {
    const debug = process.env.WORKER_DEBUG === "1";
    if (debug) console.log("[whatsapp-worker] [org", orgId, "] groups.update n=", list.length);
    for (const g of list) {
      const id = g.id;
      if (!id || !isJidGroup(id)) continue;
      try {
        await upsertConversation(orgId, id, g.subject?.trim() || undefined, {
          lastMessageAt: CONTACT_ONLY_LAST_MSG_AT,
        });
      } catch (e) {
        console.error("[whatsapp-worker] groups.update:", e);
      }
    }
  });

  sock.ev.on("chats.upsert", async (chats) => {
    const debug = process.env.WORKER_DEBUG === "1";
    if (debug) {
      console.log("[whatsapp-worker] [org", orgId, "] chats.upsert n=", chats.length);
    }
    try {
      await upsertConversationsFromChatList(orgId, chats, debug);
    } catch (e) {
      console.error("[whatsapp-worker] chats.upsert:", e);
    }
  });

  /**
   * Tras `resyncAppState` y el día a día, WhatsApp manda sobre todo `chats.update` (no `chats.upsert`).
   * Sin este handler, «Sincronizar» devolvía ok pero no aparecían filas nuevas.
   */
  sock.ev.on("chats.update", async (updates) => {
    const debug = process.env.WORKER_DEBUG === "1";
    if (debug && updates.length) {
      console.log("[whatsapp-worker] [org", orgId, "] chats.update n=", updates.length);
    }
    for (const u of updates) {
      const id = u.id;
      if (!id || isNoiseJid(id)) continue;
      if (!isDirectChatJid(id) && !isJidGroup(id)) continue;
      if (skipBaileysLidDirectChatUpsert(id)) continue;
      const tsRaw =
        typeof u.lastMessageRecvTimestamp === "number"
          ? u.lastMessageRecvTimestamp
          : (u as { lastMsgTimestamp?: unknown }).lastMsgTimestamp ??
            (u as { conversationTimestamp?: unknown }).conversationTimestamp;
      const lastIso = waTimestampToIso(tsRaw);
      try {
        await upsertConversation(orgId, id, u.name ?? undefined, { lastMessageAt: lastIso });
      } catch (e) {
        console.error("[whatsapp-worker] chats.update:", e);
      }
    }
  });

  sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, syncType, progress }) => {
    const sb = getSupabase();
    const debug = process.env.WORKER_DEBUG === "1";
    if (debug) {
      console.log(
        "[whatsapp-worker] [org",
        orgId,
        "] messaging-history.set",
        "syncType=",
        syncType,
        "progress=",
        progress,
        "chats=",
        chats?.length ?? 0,
        "contacts=",
        contacts?.length ?? 0,
        "messages=",
        messages?.length ?? 0,
      );
    }

    for (const c of contacts ?? []) {
      await patchConversationLabelsFromContact(sb, orgId, c, debug);
    }

    await upsertConversationsFromChatList(orgId, chats ?? [], debug);

    const historyAudio = process.env.WHATSAPP_DOWNLOAD_HISTORY_AUDIO === "1";
    for (const m of messages ?? []) {
      await persistSyncedMessage(orgId, sb, sock, m, historyAudio, false, debug);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const debug = process.env.WORKER_DEBUG === "1";
    // Baileys usa "notify" en tiempo real y "append" p. ej. cuando el nodo viene con attrs.offline
    // (mensaje entregado tras reconectar o por cola offline). Ignorar solo otros tipos si aparecen.
    if (type !== "notify" && type !== "append") {
      if (debug) console.log("[whatsapp-worker] [org", orgId, "] messages.upsert omitido (tipo):", type);
      return;
    }
    const sb = getSupabase();
    if (debug) {
      console.log("[whatsapp-worker] [org", orgId, "] messages.upsert", type, "n=", messages.length);
    }

    for (const m of messages) {
      await persistSyncedMessage(orgId, sb, sock, m, true, true, debug);
    }
  });
}

function sessionDirHasCredentials(orgId: string): boolean {
  const dir = path.join(process.cwd(), "sessions", orgId);
  return fs.existsSync(path.join(dir, "creds.json"));
}

async function restoreConnectedSessions() {
  let sb: ReturnType<typeof getSupabase>;
  try {
    sb = getSupabase();
  } catch {
    console.warn("[whatsapp-worker] Sin env Supabase; no se restauran sesiones al arrancar.");
    return;
  }

  const { data, error } = await sb
    .from("whatsapp_sessions")
    .select("organization_id")
    .eq("status", "connected");

  if (error) {
    console.error("[whatsapp-worker] restoreConnectedSessions:", error.message);
    return;
  }

  const orgIds = (data ?? []).map((r) => r.organization_id as string);
  if (!orgIds.length) return;

  console.log(
    `[whatsapp-worker] DB indica ${orgIds.length} org(s) connected; reabriendo socket(s) en memoria…`,
  );

  for (const orgId of orgIds) {
    if (!sessionDirHasCredentials(orgId)) {
      console.warn(
        `[whatsapp-worker] ${orgId}: sin credenciales en ./sessions; no hay socket hasta pulsar Conectar.`,
      );
      try {
        await patchSession(orgId, {
          status: "disconnected",
          last_error:
            "El worker se reinició y no encontró la sesión local en este equipo. Pulsa Conectar o vuelve a escanear el QR.",
          qr_payload: null,
        });
      } catch (e) {
        console.error("[whatsapp-worker] patchSession (sin creds locales):", e);
      }
      continue;
    }

    void startBaileys(orgId, { skipInitialStatusReset: true }).catch((err) =>
      console.error(`[whatsapp-worker] restore ${orgId}:`, err),
    );
  }
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, activeOrganizations: [...sockets.keys()] });
});

app.post("/session/:orgId/start", async (req, res) => {
  try {
    assertSecret(req);
    const orgId = req.params.orgId;
    await startBaileys(orgId);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

/**
 * Refresca app state (subconjunto sin `regular_low`, ver MANUAL_RESYNC_PATCH_NAMES).
 * Query `?repairDisk=1`: con worker en marcha no es seguro; solo si `WORKER_ALLOW_APP_STATE_DISK_REPAIR=1`
 * cierra el socket, borra `app-state-sync-version-*.json` y vuelve a abrir la sesión.
 */
app.post("/sync-chats/:orgId", async (req, res) => {
  try {
    assertSecret(req);
    const orgId = req.params.orgId;
    const repairDisk =
      req.query.repairDisk === "1" && process.env.WORKER_ALLOW_APP_STATE_DISK_REPAIR === "1";

    if (repairDisk) {
      endSocketForOrg(orgId);
      const removed = removeAppStateSyncVersionFiles(orgId);
      await startBaileys(orgId, { skipInitialStatusReset: true });
      return res.json({
        ok: true,
        repaired: true,
        removedAppStateVersionFiles: removed,
        hint: "Sesión reiniciada; espera «connected» y prueba de nuevo.",
      });
    }

    const sock = sockets.get(orgId);
    if (!sock) {
      return res
        .status(400)
        .send("session not running; POST /session/:orgId/start first (y espera estado connected)");
    }
    try {
      await runResyncAppStateSerialized(orgId, async () => {
        const ts = sock.authState.creds.lastAccountSyncTimestamp;
        if (typeof ts === "number") {
          try {
            await sock.cleanDirtyBits("account_sync", ts);
          } catch (e) {
            console.error("[whatsapp-worker] cleanDirtyBits(account_sync):", e);
          }
        }
        await sock.resyncAppState(MANUAL_RESYNC_PATCH_NAMES, false);
      });
    } catch (e) {
      console.error("[whatsapp-worker] resyncAppState:", e);
      return res.status(500).send(`resyncAppState: ${(e as Error).message}`);
    }
    const debug = process.env.WORKER_DEBUG === "1";
    await upsertParticipatingGroups(orgId, sock, debug);
    await mergeLidDuplicateConversationsHeuristic(orgId, debug);
    void backfillMissingAvatars(orgId, sock, debug).catch((e) =>
      console.error("[whatsapp-worker] backfillMissingAvatars:", e),
    );
    res.json({
      ok: true,
      resynced: true,
      collections: [...MANUAL_RESYNC_PATCH_NAMES],
      groupsFetched: true,
      hint:
        "Grupos: se listan todos los que tienes. Chats privados: no hay API para enumerarlos como en WhatsApp móvil; llegan por historial desde el teléfono, contactos de agenda o mensajes nuevos. Si había un chat duplicado (LID vs número), se intenta fusionar al sincronizar.",
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

type WaQuoteBody = {
  waMessageId: string;
  fromMe: boolean;
  body: string;
  isAudio: boolean;
  isImage?: boolean;
  isPdf?: boolean;
  isSticker?: boolean;
};

function waQuotedFromPayload(waChatId: string, quote: WaQuoteBody): WAMessage {
  const message = quote.isAudio
    ? {
        audioMessage: {
          ptt: true,
          seconds: 1,
          mimetype: "audio/ogg; codecs=opus",
        },
      }
    : quote.isPdf
    ? {
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "document.pdf",
          fileLength: 0,
        },
      }
    : quote.isSticker
    ? {
        conversation: "🎨 Sticker".slice(0, 1024),
      }
    : {
        conversation: (quote.body?.trim() ? quote.body : quote.isImage ? "📷" : " ").slice(0, 1024),
      };

  return {
    key: {
      remoteJid: waChatId,
      fromMe: quote.fromMe,
      id: quote.waMessageId,
    },
    message,
  } as WAMessage;
}

app.post("/send", async (req, res) => {
  try {
    assertSecret(req);
    const { organizationId, messageId, waChatId, body, quote } = req.body as {
      organizationId?: string;
      messageId?: string;
      waChatId?: string;
      body?: string;
      quote?: WaQuoteBody | null;
    };
    if (!organizationId || !messageId || !waChatId || body === undefined || body === "") {
      return res.status(400).send("missing fields");
    }
    const sock = sockets.get(organizationId);
    if (!sock) {
      return res
        .status(400)
        .send("session not running; POST /session/:orgId/start first (y espera estado connected)");
    }
    const quoted =
      quote &&
      typeof quote.waMessageId === "string" &&
      quote.waMessageId.length > 0 &&
      typeof quote.fromMe === "boolean"
        ? waQuotedFromPayload(waChatId, quote)
        : undefined;
    const sent = await sock.sendMessage(waChatId, { text: body }, quoted ? { quoted } : {});
    const sb = getSupabase();
    await sb
      .from("messages")
      .update({ wa_message_id: sent?.key?.id ?? null })
      .eq("id", messageId);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

app.post("/send-image", async (req, res) => {
  try {
    assertSecret(req);
    const { organizationId, messageId, waChatId, storagePath, mimeType, caption, quote } = req.body as {
      organizationId?: string;
      messageId?: string;
      waChatId?: string;
      storagePath?: string;
      mimeType?: string;
      caption?: string | null;
      quote?: WaQuoteBody | null;
    };
    if (!organizationId || !messageId || !waChatId || !storagePath) {
      return res.status(400).send("missing fields");
    }
    if (storagePath.includes("..") || !storagePath.startsWith(`${organizationId}/`)) {
      return res.status(400).send("invalid storage path");
    }
    const sock = sockets.get(organizationId);
    if (!sock) {
      return res
        .status(400)
        .send("session not running; POST /session/:orgId/start first (y espera estado connected)");
    }
    const sb = getSupabase();
    const { data: file, error: dlErr } = await sb.storage.from("message_media").download(storagePath);
    if (dlErr || !file) {
      return res.status(400).send(dlErr?.message ?? "no se pudo leer la imagen en Storage");
    }
    const ab = await file.arrayBuffer();
    const buffer = Buffer.from(ab);
    const mimetype =
      typeof mimeType === "string" && mimeType.trim() ? mimeType.trim().split(";")[0]! : "image/jpeg";
    const cap =
      typeof caption === "string" && caption.trim() && caption.trim() !== "📷 Imagen"
        ? caption.trim()
        : undefined;

    const quoted =
      quote &&
      typeof quote.waMessageId === "string" &&
      quote.waMessageId.length > 0 &&
      typeof quote.fromMe === "boolean"
        ? waQuotedFromPayload(waChatId, quote)
        : undefined;

    const sent = await sock.sendMessage(
      waChatId,
      {
        image: buffer,
        mimetype,
        ...(cap ? { caption: cap } : {}),
      },
      quoted ? { quoted } : {},
    );
    await sb
      .from("messages")
      .update({ wa_message_id: sent?.key?.id ?? null })
      .eq("id", messageId);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

app.post("/send-pdf", async (req, res) => {
  try {
    assertSecret(req);
    const { organizationId, messageId, waChatId, storagePath, fileName, caption, quote } = req.body as {
      organizationId?: string;
      messageId?: string;
      waChatId?: string;
      storagePath?: string;
      fileName?: string | null;
      caption?: string | null;
      quote?: WaQuoteBody | null;
    };
    if (!organizationId || !messageId || !waChatId || !storagePath) {
      return res.status(400).send("missing fields");
    }
    if (storagePath.includes("..") || !storagePath.startsWith(`${organizationId}/`)) {
      return res.status(400).send("invalid storage path");
    }
    const sock = sockets.get(organizationId);
    if (!sock) {
      return res
        .status(400)
        .send("session not running; POST /session/:orgId/start first (y espera estado connected)");
    }
    const sb = getSupabase();
    const { data: file, error: dlErr } = await sb.storage.from("message_media").download(storagePath);
    if (dlErr || !file) {
      return res.status(400).send(dlErr?.message ?? "no se pudo leer el PDF en Storage");
    }
    const ab = await file.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (buffer.length > PDF_MAX_BYTES) {
      return res.status(400).send(`PDF supera ${PDF_MAX_BYTES / 1024 / 1024} MB`);
    }
    const safeName =
      typeof fileName === "string" && fileName.trim().length > 0
        ? fileName.trim().replace(/[/\\]/g, "_").slice(0, 200)
        : "document.pdf";
    if (!safeName.toLowerCase().endsWith(".pdf")) {
      return res.status(400).send("fileName must be a .pdf");
    }

    const quoted =
      quote &&
      typeof quote.waMessageId === "string" &&
      quote.waMessageId.length > 0 &&
      typeof quote.fromMe === "boolean"
        ? waQuotedFromPayload(waChatId, quote)
        : undefined;

    const cap =
      typeof caption === "string" && caption.trim().length > 0 ? caption.trim() : undefined;

    const sent = await sock.sendMessage(
      waChatId,
      {
        document: buffer,
        mimetype: "application/pdf",
        fileName: safeName,
        ...(cap ? { caption: cap } : {}),
      },
      quoted ? { quoted } : {},
    );
    await sb
      .from("messages")
      .update({ wa_message_id: sent?.key?.id ?? null })
      .eq("id", messageId);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

app.post("/send-audio", async (req, res) => {
  try {
    assertSecret(req);
    const { organizationId, messageId, waChatId, storagePath, mimeType, seconds, quote } = req.body as {
      organizationId?: string;
      messageId?: string;
      waChatId?: string;
      storagePath?: string;
      mimeType?: string;
      seconds?: number;
      quote?: WaQuoteBody | null;
    };
    if (!organizationId || !messageId || !waChatId || !storagePath) {
      return res.status(400).send("missing fields");
    }
    if (storagePath.includes("..") || !storagePath.startsWith(`${organizationId}/`)) {
      return res.status(400).send("invalid storage path");
    }
    const sock = sockets.get(organizationId);
    if (!sock) {
      return res
        .status(400)
        .send("session not running; POST /session/:orgId/start first (y espera estado connected)");
    }
    const sb = getSupabase();
    const { data: file, error: dlErr } = await sb.storage.from("message_media").download(storagePath);
    if (dlErr || !file) {
      return res.status(400).send(dlErr?.message ?? "no se pudo leer el audio en Storage");
    }
    const ab = await file.arrayBuffer();
    let buffer = Buffer.from(ab);
    let mimetype =
      typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "audio/webm";
    let secondsArg =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? Math.min(300, Math.round(seconds))
        : undefined;

    const ext = browserRecordedExt(mimetype);
    let ptt = true;
    if (ext) {
      const ogg = await transcodeToOggOpus(buffer, ext);
      if (ogg) {
        buffer = Buffer.from(ogg);
        mimetype = "audio/ogg; codecs=opus";
        secondsArg = undefined;
      } else {
        console.warn(
          "[whatsapp-worker] no se pudo convertir audio del navegador a OGG/Opus; envío como archivo de audio (sin PTT)",
        );
        ptt = false;
      }
    }

    const quoted =
      quote &&
      typeof quote.waMessageId === "string" &&
      quote.waMessageId.length > 0 &&
      typeof quote.fromMe === "boolean"
        ? waQuotedFromPayload(waChatId, quote)
        : undefined;

    const sent = await sock.sendMessage(
      waChatId,
      {
        audio: buffer,
        mimetype,
        ptt,
        ...(secondsArg !== undefined ? { seconds: secondsArg } : {}),
      },
      quoted ? { quoted } : {},
    );
    await sb
      .from("messages")
      .update({ wa_message_id: sent?.key?.id ?? null })
      .eq("id", messageId);
    res.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 500).send(err.message);
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[whatsapp-worker] http://127.0.0.1:${port} (health: /health)`);
  void restoreConnectedSessions();
});
