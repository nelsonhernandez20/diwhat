# Worker WhatsApp (Baileys)

Proceso **largo** separado de Next.js. No lo ejecutes en serverless.

## Configuración

Al arrancar desde esta carpeta, el worker **carga solo** (en orden):

1. `../.env.local` y `../.env` en la raíz del repo (mismas variables que Next).
2. Opcional: `whatsapp-worker/.env` (sobrescribe lo anterior).

Variables que usa el proceso:

- `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_WORKER_SECRET` (**el mismo valor** que en Next: `WHATSAPP_WORKER_SECRET`)
- `PORT` (opcional, por defecto `8787`)
- `WHATSAPP_SYNC_FULL_HISTORY` — por defecto el worker **pide al teléfono** sincronizar historial (chats y mensajes de texto recientes en conversaciones 1:1). Pon `0` para desactivarlo si quieres menos carga al conectar.
- `WHATSAPP_HISTORY_SYNC_WAIT_MS` — tiempo máximo de espera del aviso de historial al conectar (por defecto **120000** ms; Baileys traía 20s y a veces hacía timeout antes de que el móvil respondiera).
- `WORKER_DEBUG=1` — logs más verbosos (Baileys + persistencia).
- `WHATSAPP_DOWNLOAD_HISTORY_AUDIO=1` — opcional: al sincronizar **historial masivo** desde el móvil, también descarga notas de voz y las sube a Storage (por defecto **no**, solo se guarda el texto «🎤 Mensaje de voz» sin archivo; en tiempo real siempre se intenta descargar el audio).
- `WHATSAPP_DOWNLOAD_HISTORY_IMAGES` — por defecto **activo** (`0` para desactivar): en historial masivo, descargar imágenes entrantes y guardarlas en Storage; en tiempo real siempre se intenta descargar.

### Notas de voz (entrantes y salientes)

- **Entrantes**: el worker detecta `audioMessage`, descarga el binario con Baileys y lo sube al bucket Supabase `message_media` (ruta `{organization_id}/{uuid}.ext`). En la app se muestra un reproductor.
- **Salientes**: la web graba (p. ej. WebM), sube a `message_media` con el cliente autenticado y llama a `POST /send-audio` con la ruta; el worker lee el archivo de Storage y envía **PTT** por WhatsApp.
- Aplica la migración SQL del repo que crea columnas `content_type` / `media_path` en `messages` y el bucket + políticas de Storage.

Tras `npm install` en esta carpeta se aplica un **parche** a Baileys (`patches/@whiskeysockets+baileys+*.patch`) para ese timeout configurable.

2. Instalación (si `sharp` falla en tu OS, puedes usar `npm install --ignore-scripts` y probar; para producción conviene instalar dependencias nativas correctamente):

   ```bash
   cd whatsapp-worker
   npm install
   ```

3. Arranque:

   ```bash
   npm run dev
   ```

La app Next debe tener `WHATSAPP_WORKER_URL=http://127.0.0.1:8787` (o tu puerto).

Las sesiones Baileys se guardan en `./sessions/<organizationId>/` (ignorado por git).

### Multitenant (varios negocios)

- **Misma regla para todos**: cada `organization_id` tiene su propio socket en memoria (`Map`), su carpeta `./sessions/<orgId>/` y sus filas en Supabase con ese `organization_id`. No hay “solo la primera org”.
- Cada negocio debe **conectar WhatsApp** desde su propio dashboard (admin); eso llama a `POST /session/<ese-orgId>/start` en el worker.
- Tras reiniciar el worker, solo se reabren solas las orgs con `whatsapp_sessions.status = connected` **y** `creds.json` en disco. El resto debe pulsar **Conectar** otra vez.
- Comprueba `GET /health`: `activeOrganizations` lista los UUID de org con socket activo. Con `WORKER_DEBUG=1` los logs llevan prefijo `[org <uuid>]` para saber qué tenant procesa cada evento.

### Log: `logging in...` y luego `Connection Failure` con `statusCode=401`

No es la red: Baileys está usando **credenciales guardadas** en `./sessions/<org>/` y WhatsApp las **rechaza** (sesión revocada, escaneo a medias o archivos corruptos). El worker **borra esa carpeta** al detectar 401 y debes pulsar **Conectar** otra vez para ver **QR nuevo**. Si no, borra a mano `whatsapp-worker/sessions/`.

### «Error: Connection Failure» sin 401

Puede ser **red** (firewall, VPN, etc.). Prueba otra red y `WORKER_DEBUG=1 npm run worker:dev` para ver logs de Baileys.

### Código **515** / «restart required» **justo después de escanear el QR**

Es **normal**: WhatsApp pide reiniciar el socket para terminar el vínculo. El worker **reconecta solo** y **no** borra `sessions/`. Si el móvil se quedaba cargando, suele ser porque antes se borraba la sesión en ese paso (versión vieja del worker).

### «Stream Errored» en otros momentos (sesión mala)

Si no es el flujo de emparejamiento, puede aplicarse borrado de `sessions/<orgId>/` y un QR nuevo. Prueba sin VPN y mantén `@whiskeysockets/baileys` actualizado.

### `Failed to decrypt message` / `Bad MAC` / `Key used already or never filled`

Viene de **libsignal**: las claves guardadas en `./sessions/<orgId>/` **no coinciden** con la sesión en los servidores de WhatsApp (archivos corruptos, dos procesos usando la misma carpeta, o dispositivo vinculado desincronizado).

1. Para el worker.  
2. Borra `sessions/<orgId>/`.  
3. En el móvil: **Dispositivos vinculados** → cierra el dispositivo que usaba este worker.  
4. Arranca el worker y **Conectar** + **QR nuevo**.

Asegúrate de **no tener dos workers** a la vez con la misma org y la misma carpeta `sessions/`.

`npm run dev` usa **`node --watch`**: al guardar archivos el proceso se reinicia y puede **reabrir el socket** mientras aún hay tráfico cifrado, lo que a veces empeora estos errores. Para probar estabilidad usa `npm run start` (sin watch).

### Contactos / bandeja vacía sin mensajes nuevos

Los **contactos** de WhatsApp se vuelcan a `conversations` con **upsert** (nombre de agenda o, si no hay, el JID). Tras conectar o pulsar **Sincronizar** en la bandeja, deberían aparecer entradas aunque no haya mensaje reciente; el texto previo de la lista solo existe cuando hay filas en `messages` (historial o mensaje nuevo). Las filas **solo contacto** (sin mensajes en Diwhat) usan `last_message_at` reciente al **crearse** para no quedar abajo del todo en el orden por fecha. **Sincronizar** también llama a `groupFetchAllParticipating` para listar grupos en los que participas.

### Grupos sí, privados no “todos a la vez”

**Grupos**: Baileys expone `groupFetchAllParticipating()` → puedes volcar **todos** los grupos en los que estás. **Chats privados (1:1)**: la API de WhatsApp Web/Baileys **no** ofrece un listado completo equivalente al de la app móvil. En Diwhat entran por **historial** que manda el teléfono (`messaging-history.set`), **contactos** sincronizados, eventos de **app state** (`chats.update`) o **mensajes** nuevos. Si solo ves grupos tras sincronizar, es coherente con esa limitación.

### Log: `tried remove, but no previous op` (colección `regular_low`)

Es un fallo al **decodificar parches** del *app state* syncd (LTHash local vs parches del servidor). El botón **Sincronizar** en la app ya **no** pide la colección `regular_low` al worker (el arranque de Baileys sigue sincronizando todo internamente). Si aun así falla el estado en disco, con el worker **parado** puedes borrar `sessions/<orgId>/app-state-sync-version-*.json` y volver a conectar, o arrancar el worker con `WORKER_ALLOW_APP_STATE_DISK_REPAIR=1` y llamar al worker `POST /sync-chats/<orgId>?repairDisk=1` (cierra socket, borra esos ficheros y reabre la sesión).
