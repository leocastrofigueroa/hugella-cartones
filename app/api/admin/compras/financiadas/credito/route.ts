import { createClient } from "@/utils/supabase/server";
import { uuid } from "@/app/admin/compras/purchase-types";
import { validateFinancedPurchase } from "@/app/admin/compras/payment-types";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return json({ error: "Solicitud no permitida." }, 403);
    }

    const supabase = await createClient();
    const session = await supabase.auth.getClaims();

    if (session.error || !session.data?.claims?.sub) {
      return json(
        { error: "Tu sesión venció. Volvé a iniciar sesión." },
        401
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Solicitud inválida." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Solicitud inválida." }, 422);
    }

    const input = body as Record<string, unknown>;
    const { p_credito_id, ...purchase } = input;

    if (
      typeof p_credito_id !== "string" ||
      !uuid.test(p_credito_id) ||
      !validateFinancedPurchase(purchase)
    ) {
      return json(
        {
          error:
            "Revisá proveedor, compra, formas de pago y crédito seleccionado.",
        },
        422
      );
    }

    if (purchase.p_tipo !== "MERCADERIA") {
      return json(
        {
          error:
            "Solo una compra de mercadería puede asociarse a un crédito.",
        },
        422
      );
    }

    const result = await supabase.rpc(
      "crear_compra_financiada_credito_admin",
      {
        ...purchase,
        p_credito_id,
      }
    );

    if (result.error) {
      console.error("Compra financiada + crédito RPC", {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      });

      if (result.error.code === "42501") {
        return json(
          { error: "Tu cuenta no tiene permisos de administración." },
          403
        );
      }

      if (
        result.error.code === "23514" &&
        result.error.message ===
          "La compra ya está asociada a otro crédito"
      ) {
        return json(
          { error: "La compra ya está asociada a otro crédito." },
          409
        );
      }

      return json(
        {
          error:
            "No se pudo confirmar la compra y su asociación. Reintentá la misma solicitud.",
        },
        502
      );
    }

    const data = result.data as Record<string, unknown> | null;

    if (
      !data ||
      data.estado !== "CONFIRMADA" ||
      data.operacion_id !== purchase.p_operacion_id ||
      data.credito_id !== p_credito_id ||
      typeof data.compra_id !== "string" ||
      !uuid.test(data.compra_id)
    ) {
      return json(
        {
          error:
            "Respuesta incierta. Reintentá la misma solicitud.",
        },
        502
      );
    }

    return json({ result: data }, 201);
  } catch {
    return json(
      {
        error:
          "No pudimos confirmar el resultado. Reintentá la misma solicitud.",
      },
      502
    );
  }
}