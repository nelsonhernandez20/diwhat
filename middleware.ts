import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

/** Solo rutas que usan sesión. Evita ejecutar auth en /api, assets y marketing → menos invocaciones concurrentes en Vercel. */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/signup",
    "/access-pending",
    "/join/:path*",
    "/auth/:path*",
  ],
};
