import { createClient } from "@/utils/supabase/server";

type ClienteListado = {
  id: string;
  nombre: string | null;
  dni: string | null;
  telefono: string | null;
  domicilio: string | null;
  ubicacion: string | null;
  cantidad_creditos: number | string | null;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function normalizarTexto(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function GET(request: Request) {
  try {
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return json(
        { error: "Solicitud no permitida." },
        403
      );
    }

    const supabase = await createClient();

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();

    if (
      claimsError ||
      !claimsData?.claims?.sub
    ) {
      return json(
        { error: "Tu sesión venció. Volvé a iniciar sesión." },
        401
      );
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();

    if (query.length < 2) {
      return json({ clients: [] });
    }

    const result = await supabase.rpc(
      "listar_clientes_admin"
    );

    if (result.error) {
      return json(
        {
          error:
            result.error.code === "42501"
              ? "Tu cuenta no tiene permisos de administración."
              : "No se pudieron buscar clientes.",
        },
        result.error.code === "42501" ? 403 : 502
      );
    }

    const clientes = (result.data ?? []) as ClienteListado[];

    const queryTexto = normalizarTexto(query);
    const queryDni = query.replace(/[^0-9]/g, "");

    const coincidencias = clientes
      .filter((cliente) => {
        const nombre = normalizarTexto(
          cliente.nombre ?? ""
        );

        const dni = String(cliente.dni ?? "").replace(
          /[^0-9]/g,
          ""
        );

        return (
          nombre.includes(queryTexto) ||
          (
            queryDni.length > 0 &&
            dni.includes(queryDni)
          )
        );
      })
      .slice(0, 10)
      .map((cliente) => ({
        id: cliente.id,
        nombre: cliente.nombre,
        dni: cliente.dni,
        telefono: cliente.telefono,
        domicilio: cliente.domicilio,
        ubicacion: cliente.ubicacion,
        cantidad_creditos: Number(
          cliente.cantidad_creditos ?? 0
        ),
      }));

    return json({
      clients: coincidencias,
    });
  } catch {
    return json(
      {
        error:
          "No se pudo realizar la búsqueda de clientes.",
      },
      502
    );
  }
}
