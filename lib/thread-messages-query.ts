/**
 * PostgREST (Supabase) limita filas por defecto (~1000). Un .order(created_at asc)
 * devolvía solo los más viejos; usamos desc + limit y luego invertimos.
 *
 * Ventana inicial pequeña; en el hilo se cargan bloques anteriores con "Cargar más".
 */
export const THREAD_MESSAGES_PAGE_SIZE = 50;

/** Primera carga (SSR) y refetch en cliente: solo los N mensajes más recientes. */
export const THREAD_MESSAGES_INITIAL = THREAD_MESSAGES_PAGE_SIZE;
