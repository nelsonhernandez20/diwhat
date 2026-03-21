# Diwhat

SaaS multi-tenant: equipo compartido, WhatsApp (Baileys, no oficial), notas internas solo para el staff.

## Requisitos

- Node.js 20+
- Proyecto en [Supabase](https://supabase.com) con Auth email/contraseña
- Migraciones en `supabase/migrations/` aplicadas (SQL Editor o CLI). La bandeja en tiempo real necesita la migración que añade `messages` y `conversations` a `supabase_realtime`. Las **notas de voz** requieren la migración que añade `content_type` / `media_path` y el bucket Storage `message_media`.

## Variables de entorno

Copia `.env.example` a `.env.local` y rellena Supabase, el worker y (opcional) **SMTP** para que las invitaciones de equipo lleguen por correo. Define **`NEXT_PUBLIC_SITE_URL`** (p. ej. `http://localhost:3000` en local) para que el enlace del email sea correcto. Quita **`RESEND_API_KEY`** si la tenías; este proyecto usa **Nodemailer**.

## Desarrollo (dos terminales)

1. **Next.js**

   ```bash
   npm install
   npm run dev
   ```

2. **Worker WhatsApp** (mismo `WHATSAPP_WORKER_SECRET` y URL que en `.env.local`)

   ```bash
   cd whatsapp-worker
   npm install
   # si falla sharp u otra dependencia nativa: npm install --ignore-scripts
   npm run dev
   ```

En el dashboard del negocio: **WhatsApp → Conectar**, escanea el QR. Los mensajes entrantes aparecen en **Bandeja**.

Detalles del worker: `whatsapp-worker/README.md`.

## Scripts útiles

- `npm run worker:dev` — arranca el worker desde la raíz
- `npm run worker:typecheck` — comprobación de tipos del worker
