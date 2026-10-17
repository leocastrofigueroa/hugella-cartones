import { createClient } from "@/utils/supabase/server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");

    if (origin && new URL(origin).origin !== new URL(request.url).origin) {
      return json({ error: "Solicitud no permitida." }, 403);
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims?.sub) {
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

    if (!body || typeof body !== "object") {
      return json({ error: "Solicitud inválida." }, 400);
    }

    const input = body as Record<string, unknown>;

    const clienteId =
      typeof input.cliente_id === "string" ? input.cliente_id : "";

    const nombre =
      typeof input.nombre === "string" ? input.nombre.trim() : "";

    const dni =
      typeof input.dni === "string"
        ? input.dni.replace(/\D/g, "")
        : "";

    const telefono =
      typeof input.telefono === "string"
        ? input.telefono.trim()
        : "";

    const domicilio =
      typeof input.domicilio === "string"
        ? input.domicilio.trim()
        : "";

    const ubicacion =
      typeof input.ubicacion === "string"
        ? input.ubicacion.trim()
        : "";

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        clienteId
      )
    ) {
      return json({ error: "Cliente inválido." }, 422);
    }

    if (!nombre) {
      return json({ error: "El nombre es obligatorio." }, 422);
    }

    if (!/^[0-9]{7,9}$/.test(dni)) {
      return json(
        { error: "El DNI debe contener entre 7 y 9 dígitos." },
        422
      );
    }

    if (ubicacion.length > 2000) {
      return json(
        { error: "La ubicación no puede superar los 2000 caracteres." },
        422
      );
    }

    const result = await supabase.rpc("actualizar_cliente_admin", {
      p_cliente_id: clienteId,
      p_nombre: nombre,
      p_dni: dni,
      p_telefono: telefono || null,
      p_domicilio: domicilio || null,
      p_ubicacion: ubicacion || null,
    });

    if (result.error) {
      if (result.error.code === "42501") {
        return json(
          { error: "Tu cuenta no tiene permisos de administración." },
          403
        );
      }

      if (result.error.code === "23505") {
        return json(
          { error: "Ese DNI ya pertenece a otro cliente." },
          409
        );
      }

      if (result.error.code === "P0002") {
        return json({ error: "El cliente no existe." }, 404);
      }

      if (result.error.code === "22023") {
        return json(
          { error: result.error.message || "Datos inválidos." },
          422
        );
      }

      return json(
        { error: "No se pudo actualizar el cliente." },
        502
      );
    }

    if (!Array.isArray(result.data) || result.data.length !== 1) {
      return json(
        { error: "No recibimos una respuesta válida al actualizar." },
        502
      );
    }

    return json({ cliente: result.data[0] });
  } catch {
    return json(
      { error: "No se pudo actualizar el cliente." },
      502
    );
  }
}
