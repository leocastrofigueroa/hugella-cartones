import { createClient } from "@/utils/supabase/server";
import {
  isCreditCreationResult,
  normalizeDni,
  uuidPattern,
  validateCreditCreation,
  type NewCreditCreationInput,
} from "@/app/admin/admin-types";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function rejected(error: string, code: string, status: number) {
  return json({ error, code, outcome: "rejected" }, status);
}

function uncertain(
  error = "No pudimos confirmar el resultado. Reintentá la misma solicitud.",
  code = "UNCERTAIN"
) {
  return json({ error, code, outcome: "uncertain" }, 502);
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return rejected("Solicitud no permitida.", "ORIGIN", 403);
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims?.sub) {
      return rejected(
        "Tu sesión venció. Volvé a iniciar sesión.",
        "SESSION",
        401
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return rejected("Solicitud inválida.", "VALIDATION", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return rejected("Solicitud inválida.", "VALIDATION", 422);
    }

    const raw = body as Record<string, unknown>;
    const { p_compra_gasto_id, ...creditInput } = raw;

    if (
      typeof p_compra_gasto_id !== "string" ||
      !uuidPattern.test(p_compra_gasto_id)
    ) {
      return rejected(
        "La compra de origen es inválida.",
        "VALIDATION",
        422
      );
    }

    if (
      typeof creditInput.p_dni === "string"
    ) {
      creditInput.p_dni = normalizeDni(creditInput.p_dni);
    }

    const validation = validateCreditCreation(creditInput);

    if (validation) {
      return rejected(validation, "VALIDATION", 422);
    }

    const input = creditInput as unknown as NewCreditCreationInput;

    const result = await supabase.rpc(
      "crear_credito_desde_compra_admin",
      {
        p_compra_gasto_id,
        ...input,
      }
    );

    if (result.error) {
      const { code, message } = result.error;

      if (code === "42501") {
        return rejected(
          "Tu cuenta no tiene permisos de administración.",
          "PERMISSION",
          403
        );
      }

      if (
        code === "23505" &&
        message ===
          "El DNI ya pertenece a un cliente; vuelva a buscarlo"
      ) {
        return rejected(
          "Ese DNI ya está registrado. Volvé a buscar al cliente.",
          "DNI_CONFLICT",
          409
        );
      }

      if (
        code === "22023" &&
        message ===
          "El cliente esperado ya no corresponde al DNI"
      ) {
        return rejected(
          "La identidad del cliente cambió. Volvé a buscarlo.",
          "IDENTITY",
          409
        );
      }

      if (
        code === "22023" &&
        message === "La fecha de entrega no puede ser domingo"
      ) {
        return rejected(
          "La fecha de entrega no puede ser domingo.",
          "VALIDATION",
          422
        );
      }

      if (
        code === "23514" &&
        message === "La compra ya está asociada a otro crédito"
      ) {
        return rejected(
          "Esta compra ya está asociada a otro crédito.",
          "PURCHASE_ALREADY_LINKED",
          409
        );
      }

      if (
        code === "23514" &&
        message ===
          "La compra está anulada y no puede asociarse a un crédito"
      ) {
        return rejected(
          "La compra está anulada y no puede generar un crédito.",
          "PURCHASE_ANNULLED",
          409
        );
      }

      if (
        code === "22023" &&
        message ===
          "El identificador de operación ya fue utilizado con otra solicitud"
      ) {
        return uncertain(
          "La operación no coincide con la solicitud. Revisá el crédito antes de iniciar otra alta.",
          "OPERATION_CONFLICT"
        );
      }

      if (code === "54000") {
        return rejected(
          "No se pudo asignar un código. Volvé a revisar y confirmar la solicitud.",
          "CODE_LIMIT",
          409
        );
      }

      if (
        ["22023", "22003", "22008", "23502", "23505"].includes(code)
      ) {
        return rejected(
          "No se pudo crear el crédito. Revisá los datos e intentá nuevamente.",
          "REJECTED",
          422
        );
      }

      return uncertain();
    }

    if (!Array.isArray(result.data) || result.data.length !== 1) {
      return uncertain();
    }

    const row = result.data[0] as Record<string, unknown>;
    const compraGastoId = row.compra_gasto_id;

    if (
      compraGastoId !== p_compra_gasto_id ||
      !isCreditCreationResult(row, input)
    ) {
      return uncertain();
    }

    return json(
      {
        result: {
          operacion_id: row.operacion_id,
          cliente_id: row.cliente_id,
          credito_id: row.credito_id,
          codigo: row.codigo,
          cliente_creado: row.cliente_creado,
          ya_procesada: row.ya_procesada,
          compra_gasto_id: compraGastoId,
        },
      },
      row.ya_procesada ? 200 : 201
    );
  } catch {
    return uncertain();
  }
}
