import { createClient } from "@/utils/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const allowedKeys = new Set([
  "p_operacion_id",
  "p_credito_id",
  "p_valor_anterior_esperado",
  "p_producto",
  "p_fecha_inicio",
  "p_cantidad_cuotas",
  "p_importe_cuota",
  "p_inversion",
  "p_motivo",
]);

type PreviousCreditValues = {
  producto: string;
  fecha_inicio: string;
  cantidad_cuotas: number;
  importe_cuota: number;
  inversion: number | null;
};

type CreditEditRequest = {
  p_operacion_id: string;
  p_credito_id: string;
  p_valor_anterior_esperado: PreviousCreditValues;
  p_producto: string;
  p_fecha_inicio: string;
  p_cantidad_cuotas: number;
  p_importe_cuota: string | number;
  p_inversion: string | number | null;
  p_motivo: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function rejected(error: string, code: string, status: number) {
  return json(
    {
      error,
      code,
      outcome: "rejected",
    },
    status
  );
}

function uncertain(
  error = "No pudimos confirmar el resultado. Reintentá la misma solicitud.",
  code = "UNCERTAIN"
) {
  return json(
    {
      error,
      code,
      outcome: "uncertain",
    },
    502
  );
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isSunday(value: string) {
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 0;
}

function positiveNumber(value: unknown) {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return false;
  }

  if (
    typeof value === "string" &&
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  ) {
    return false;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0;
}

function isPreviousCreditValues(
  value: unknown
): value is PreviousCreditValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);

  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      [
        "producto",
        "fecha_inicio",
        "cantidad_cuotas",
        "importe_cuota",
        "inversion",
      ].includes(key)
    )
  ) {
    return false;
  }

  return (
    typeof row.producto === "string" &&
    row.producto.trim().length > 0 &&
    validDate(row.fecha_inicio) &&
    typeof row.cantidad_cuotas === "number" &&
    Number.isInteger(row.cantidad_cuotas) &&
    row.cantidad_cuotas > 0 &&
    typeof row.importe_cuota === "number" &&
    Number.isFinite(row.importe_cuota) &&
    row.importe_cuota > 0 &&
    (row.inversion === null ||
      (typeof row.inversion === "number" &&
        Number.isFinite(row.inversion) &&
        row.inversion > 0))
  );
}

function validateRequest(
  value: unknown
): value is CreditEditRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);

  if (
    keys.length !== allowedKeys.size ||
    !keys.every((key) => allowedKeys.has(key))
  ) {
    return false;
  }

  if (
    typeof row.p_operacion_id !== "string" ||
    !uuidPattern.test(row.p_operacion_id) ||
    typeof row.p_credito_id !== "string" ||
    !uuidPattern.test(row.p_credito_id)
  ) {
    return false;
  }

  if (!isPreviousCreditValues(row.p_valor_anterior_esperado)) {
    return false;
  }

  if (
    typeof row.p_producto !== "string" ||
    row.p_producto.trim().length === 0
  ) {
    return false;
  }

  if (
    !validDate(row.p_fecha_inicio) ||
    isSunday(row.p_fecha_inicio)
  ) {
    return false;
  }

  if (
    typeof row.p_cantidad_cuotas !== "number" ||
    !Number.isInteger(row.p_cantidad_cuotas) ||
    row.p_cantidad_cuotas <= 0
  ) {
    return false;
  }

  if (!positiveNumber(row.p_importe_cuota)) {
    return false;
  }

  if (
    row.p_inversion !== null &&
    !positiveNumber(row.p_inversion)
  ) {
    return false;
  }

  if (
    typeof row.p_motivo !== "string" ||
    row.p_motivo.trim().length === 0 ||
    row.p_motivo.trim().length > 1000
  ) {
    return false;
  }

  return true;
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return rejected(
        "Solicitud no permitida.",
        "ORIGIN",
        403
      );
    }

    const supabase = await createClient();

    const { data: authData, error: authError } =
      await supabase.auth.getClaims();

    if (authError || !authData?.claims?.sub) {
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
      return rejected(
        "Solicitud inválida.",
        "VALIDATION",
        400
      );
    }

    if (!validateRequest(body)) {
      return rejected(
        "Revisá los datos del crédito antes de confirmar la modificación.",
        "VALIDATION",
        422
      );
    }

    const input = body as CreditEditRequest;

    const result = await supabase.rpc(
      "editar_credito_admin",
      {
        p_operacion_id: input.p_operacion_id,
        p_credito_id: input.p_credito_id,
        p_valor_anterior_esperado:
          input.p_valor_anterior_esperado,
        p_producto: input.p_producto.trim(),
        p_fecha_inicio: input.p_fecha_inicio,
        p_cantidad_cuotas: input.p_cantidad_cuotas,
        p_importe_cuota: input.p_importe_cuota,
        p_inversion: input.p_inversion,
        p_motivo: input.p_motivo.trim(),
      }
    );

    if (result.error) {
      const { code, message } = result.error;

      if (code === "42501") {
        return rejected(
          "Tu cuenta no tiene permisos para modificar créditos.",
          "PERMISSION",
          403
        );
      }

      if (code === "P0002") {
        return rejected(
          "El crédito ya no existe.",
          "NOT_FOUND",
          404
        );
      }

      if (code === "40001") {
        return rejected(
          "El crédito cambió desde que abriste la ficha. Volvé a cargarlo antes de modificarlo.",
          "STALE_DATA",
          409
        );
      }

      if (
        code === "22023" &&
        message === "La fecha de entrega no puede ser domingo"
      ) {
        return rejected(
          "La fecha de entrega no puede ser domingo.",
          "SUNDAY",
          422
        );
      }

      if (
        code === "22023" &&
        message === "No hay cambios para guardar"
      ) {
        return rejected(
          "No modificaste ningún dato del crédito.",
          "NO_CHANGES",
          422
        );
      }

      if (
        code === "23514" &&
        message.includes("pagos válidos")
      ) {
        return rejected(
          "Este crédito ya tiene pagos válidos. No se pueden cambiar la cantidad de cuotas ni el importe de cuota mediante una edición común.",
          "HAS_PAYMENTS",
          409
        );
      }

      if (
        code === "23514" &&
        message.includes("contrato activo")
      ) {
        return rejected(
          "Este crédito tiene un contrato activo. No se pueden modificar sus datos contractuales desde el editor.",
          "ACTIVE_CONTRACT",
          409
        );
      }

      if (
        code === "23514" &&
        message.includes("está cerrado")
      ) {
        return rejected(
          "Este crédito está cerrado y no puede modificarse.",
          "CLOSED",
          409
        );
      }

      if (code === "22023") {
        return rejected(
          message ===
          "El identificador de operación ya fue utilizado con otra solicitud"
            ? "Esta operación ya fue utilizada para otra modificación. Volvé a abrir el editor."
            : "Revisá los datos ingresados antes de guardar.",
          "REJECTED",
          422
        );
      }

      if (code === "23514") {
        return rejected(
          "El crédito no puede modificarse en su estado actual.",
          "REJECTED",
          409
        );
      }

      return uncertain();
    }

    if (
      !result.data ||
      typeof result.data !== "object" ||
      Array.isArray(result.data)
    ) {
      return uncertain();
    }

    const edited = result.data as Record<string, unknown>;

    if (
      edited.operacion_id !== input.p_operacion_id ||
      edited.credito_id !== input.p_credito_id ||
      typeof edited.ya_procesada !== "boolean" ||
      !edited.valor_anterior ||
      typeof edited.valor_anterior !== "object" ||
      !edited.valor_nuevo ||
      typeof edited.valor_nuevo !== "object"
    ) {
      return uncertain();
    }

    return json({
      result: edited,
    });
  } catch {
    return uncertain();
  }
}
