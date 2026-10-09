import { createClient } from "@/utils/supabase/server";
import { isAdminClient, normalizeDni } from "@/app/admin/admin-types";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ error: "Solicitud no permitida." }, 403);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return json({ error: "Tu sesión venció. Volvé a iniciar sesión." }, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400); }
    if (!body || typeof body !== "object" || !("dni" in body) || typeof body.dni !== "string") return json({ error: "Ingresá el DNI." }, 422);
    const dni = normalizeDni(body.dni);
    if (!/^[0-9]{7,9}$/.test(dni)) return json({ error: "El DNI debe contener entre 7 y 9 dígitos." }, 422);
    const result = await supabase.rpc("buscar_cliente_por_dni_admin_v2", { p_dni: dni });
    if (result.error) return json({ error: result.error.code === "42501" ? "Tu cuenta no tiene permisos de administración." : "No se pudo buscar al cliente. Intentá nuevamente." }, result.error.code === "42501" ? 403 : 502);
    if (!Array.isArray(result.data) || result.data.length > 1) return json({ error: "No recibimos una respuesta válida de búsqueda." }, 502);
    if (result.data.length === 0) return json({ client: null });
    const client: unknown = result.data[0];
    if (!isAdminClient(client) || normalizeDni(client.dni) !== dni) return json({ error: "No recibimos una respuesta válida de búsqueda." }, 502);
    return json({ client: { id: client.id, nombre: client.nombre, dni: client.dni, telefono: client.telefono, domicilio: client.domicilio, ubicacion: client.ubicacion } });
  } catch {
    return json({ error: "No se pudo consultar al cliente. Intentá nuevamente." }, 502);
  }
}
