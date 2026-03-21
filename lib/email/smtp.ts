import nodemailer from "nodemailer";

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

export function isSmtpConfigured(): boolean {
  return readSmtpConfig() !== null;
}

export async function sendInviteEmail(input: {
  to: string;
  inviteUrl: string;
  orgName: string;
  roleLabel: string;
}): Promise<void> {
  const cfg = readSmtpConfig();
  if (!cfg) {
    throw new Error("SMTP no configurado (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).");
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    requireTLS: !cfg.secure && cfg.port === 587,
  });

  const from = process.env.SMTP_FROM?.trim() || cfg.user;
  const subject = `Invitación al equipo: ${input.orgName}`;
  const text = [
    `Te han invitado a unirte a «${input.orgName}» en Diwhat.`,
    `Rol: ${input.roleLabel}.`,
    "",
    "Abre este enlace (debes registrarte o iniciar sesión con el mismo email al que llegó este mensaje):",
    input.inviteUrl,
    "",
    "El enlace caduca en unos días.",
  ].join("\n");

  const html = `
    <p>Te han invitado a unirte a <strong>${escapeHtml(input.orgName)}</strong> en Diwhat.</p>
    <p>Rol: <strong>${escapeHtml(input.roleLabel)}</strong>.</p>
    <p><a href="${escapeHtml(input.inviteUrl)}">Aceptar invitación</a></p>
    <p style="color:#666;font-size:12px">Si el enlace no funciona, copia y pega esta URL en el navegador:<br/>${escapeHtml(input.inviteUrl)}</p>
  `;

  await transporter.sendMail({
    from,
    to: input.to,
    subject,
    text,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
