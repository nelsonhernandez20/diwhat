"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

/** Evita mostrar fallos genéricos viejos al recargar con el worker apagado. */
function isStaleDisconnectNoise(status: string, msg: string): boolean {
  if (status !== "disconnected") return false;
  return /^Error:\s*(Connection (Failure|Closed|Lost)|timed out|ECONNRESET)/i.test(msg.trim());
}

export function WhatsAppConnect({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<string>("—");
  const [lastError, setLastError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFromDb = useCallback(async () => {
    const supabase = createClient();
    const { data, error: qErr } = await supabase
      .from("whatsapp_sessions")
      .select("status, qr_payload, last_error")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (qErr) {
      setLastError(qErr.message);
      return;
    }
    setLastError(null);
    if (data?.status) setStatus(data.status);
    if (data?.last_error) setLastError(data.last_error);

    if (data?.status === "qr" && data.qr_payload) {
      setQrDataUrl(await QRCode.toDataURL(data.qr_payload, { margin: 1, width: 280 }));
    } else if (data?.status === "connected") {
      setQrDataUrl(null);
    }
  }, [orgId]);

  useEffect(() => {
    void refreshFromDb();
    const id = window.setInterval(() => void refreshFromDb(), 1500);
    return () => window.clearInterval(id);
  }, [refreshFromDb]);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "No se pudo iniciar el worker");
      }
      // El QR tarda un momento en llegar a Supabase; forzar varias lecturas
      void refreshFromDb();
      window.setTimeout(() => void refreshFromDb(), 800);
      window.setTimeout(() => void refreshFromDb(), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5 text-brand-text shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-brand-text">
          Estado: <span className="font-semibold capitalize text-brand-primary">{status}</span>
        </p>
        <button className="btn-brand" disabled={busy} type="button" onClick={start}>
          {busy ? "Iniciando…" : "Conectar / regenerar QR"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {lastError && status !== "qr" && !isStaleDisconnectNoise(status, lastError) ? (
        <p className="mt-2 text-xs text-amber-800" role="status">
          Detalle: {lastError}
        </p>
      ) : null}
      {qrDataUrl ? (
        <div className="mt-6">
          <p className="text-sm text-brand-muted">
            Escanea con WhatsApp → Dispositivos vinculados.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Código QR de WhatsApp"
            className="mt-4 rounded-xl border border-brand-border shadow-sm"
            src={qrDataUrl}
          />
        </div>
      ) : status === "disconnected" && !busy ? (
        <p className="mt-3 text-xs text-brand-muted">
          Si el worker está bien pero no ves QR, mira la terminal del worker: errores de red o de
          Supabase al guardar la sesión aparecerán allí.
        </p>
      ) : null}
      <p className="mt-6 text-xs text-brand-muted">
        Integración no oficial: puede haber desconexiones o bloqueos. El worker debe estar
        ejecutándose en tu máquina o servidor.
      </p>
    </div>
  );
}
