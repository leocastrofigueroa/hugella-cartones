import { createClient } from "@/utils/supabase/server";
import { isCreditCreationResult, normalizeDni, uuidPattern, validateCreditCreation, type CreditCreationInput } from "@/app/admin/admin-types";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function rejected(error: string, code: string, status: number) {
  return json({ error, code, outcome: "rejected" }, status);
}
function uncertain(error = "No pudimos confirmar el resultado. Reintentá la misma solicitud.", code = "UNCERTAIN") {
  return json({ error, code, outcome: "uncertain" }, 502);
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return rejected("Solicitud no permitida.", "ORIGIN", 403);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return rejected("Tu sesión venció. Volvé a iniciar sesión.", "SESSION", 401);
    let body: unknown;
    try { body = await request.json(); } catch { return rejected("Solicitud inválida.", "VALIDATION", 400); }
    // A whitelist validator rejects extra fields, including code, state and token.
    if (body && typeof body === "object" && "p_dni" in body && typeof body.p_dni === "string") body.p_dni = normalizeDni(body.p_dni);
    const validation = validateCreditCreation(body);
    if (validation) return rejected(validation, "VALIDATION", 422);
    const input = body as CreditCreationInput;
    const result = await supabase.rpc("crear_credito_admin", input);
    if (result.error) {
      const { code, message } = result.error;
      if (code === "42501") return rejected("Tu cuenta no tiene permisos de administración.", "PERMISSION", 403);
      if (code === "23505" && message === "El DNI ya pertenece a un cliente; vuelva a buscarlo") return rejected("Ese DNI ya está registrado. Volvé a buscar al cliente.", "DNI_CONFLICT", 409);
      if (code === "22023" && message === "El cliente esperado ya no corresponde al DNI") return rejected("La identidad del cliente cambió. Volvé a buscarlo.", "IDENTITY", 409);
      if (code === "22023" && message === "La fecha de entrega no puede ser domingo") return rejected("La fecha de entrega no puede ser domingo.", "VALIDATION", 422);
      if (code === "22023" && message === "El identificador de operación ya fue utilizado con otra solicitud") return uncertain("La operación no coincide con la solicitud. Conservá esta intención y revisá el crédito antes de iniciar otra alta.", "OPERATION_CONFLICT");
      if (code === "23514") return uncertain("No pudimos confirmar la coherencia de la operación. Conservá esta intención y revisá el crédito.", "INCONSISTENT");
      if (code === "54000") return rejected("No se pudo asignar un código. Volvé a revisar y confirmar la solicitud.", "CODE_LIMIT", 409);
      // Known SQL validation/constraint failures abort the transaction. Network/gateway
      // failures cannot establish whether the credit was committed.
      if (["22023", "22003", "22008", "23502", "23505"].includes(code)) return rejected("No se pudo crear el crédito. Revisá los datos e intentá nuevamente.", "REJECTED", 422);
      return uncertain();
    }
    if (!Array.isArray(result.data) || result.data.length !== 1) return uncertain();
    const row: unknown = result.data[0];
    if (!isCreditCreationResult(row, input) || !("access_token" in row) || typeof row.access_token !== "string" || !uuidPattern.test(row.access_token)) return uncertain();
    // Never serialize the RPC row directly: access_token stays on the server.
    return json({ result: { operacion_id: row.operacion_id, cliente_id: row.cliente_id, credito_id: row.credito_id, codigo: row.codigo, cliente_creado: row.cliente_creado, ya_procesada: row.ya_procesada } }, row.ya_procesada ? 200 : 201);
  } catch {
    return uncertain();
  }
}
