
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ClienteEditForm from "./cliente-edit-form";

type Cliente = {
  id: string;
  nombre: string;
  dni: string | null;
  telefono: string | null;
  domicilio: string | null;
  ubicacion: string | null;
  cantidad_creditos: number;
};

type CartonCliente = {
  credito_id: string;
  codigo: string;
  producto: string;
  estado: string;
  access_token: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default async function ClienteCartonesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isUuid(id)) {
    notFound();
  }

  const supabase = await createClient();

  const [
    { data: clienteData, error: clienteError },
    { data: cartonesData, error: cartonesError },
  ] = await Promise.all([
    supabase.rpc("obtener_cliente_admin", {
      p_cliente_id: id,
    }),
    supabase.rpc("obtener_cartones_cliente_admin", {
      p_cliente_id: id,
    }),
  ]);

  if (clienteError || cartonesError) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Ficha del cliente</h1>
        <p className="mt-3">
          No se pudieron cargar los datos de este cliente.
        </p>
      </section>
    );
  }

  if (!Array.isArray(clienteData) || clienteData.length !== 1) {
    notFound();
  }

  const cliente = clienteData[0] as Cliente;
  const cartones = (cartonesData ?? []) as CartonCliente[];

  return (
    <div className="space-y-6">
      <section>
        <p className="section-kicker">Clientes</p>
        <h1 className="text-3xl font-bold">{cliente.nombre}</h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Ficha del cliente y créditos asociados.
        </p>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Datos del cliente</h2>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              {cliente.cantidad_creditos} crédito
              {cliente.cantidad_creditos === 1 ? "" : "s"} registrado
              {cliente.cantidad_creditos === 1 ? "" : "s"}.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href={`/admin/nuevo-credito?cliente=${cliente.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--hugella-navy)] px-4 py-2 font-semibold text-white"
            >
              Nuevo crédito
            </Link>

            <Link
              href="/admin/clientes"
              className="font-semibold underline"
            >
              Volver a clientes
            </Link>
          </div>
        </div>

        <ClienteEditForm cliente={cliente} />
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl font-bold">Créditos del cliente</h2>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Seleccioná el crédito que querés consultar.
          </p>
        </div>

        {cartones.length === 0 ? (
          <div className="rounded-xl border border-[var(--hugella-border)] bg-white p-6">
            <p className="font-semibold">
              Este cliente todavía no tiene créditos registrados.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {cartones.map((carton) => (
              <article
                key={carton.credito_id}
                className="rounded-xl border border-[var(--hugella-border)] bg-white p-5"
              >
                <p className="text-sm text-[var(--hugella-navy-secondary)]">
                  {carton.codigo}
                </p>

                <h3 className="mt-1 text-lg font-bold">
                  {carton.producto}
                </h3>

                <p className="mt-2 text-sm">
                  Estado: <strong>{carton.estado}</strong>
                </p>

                {carton.access_token ? (
                  <Link
                    href={`/carton/${carton.access_token}`}
                    className="mt-4 inline-flex rounded-lg bg-[var(--hugella-navy)] px-4 py-3 font-semibold text-white"
                  >
                    Abrir cartón
                  </Link>
                ) : (
                  <p className="mt-4 text-sm text-red-700">
                    Este crédito no tiene cartón disponible.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
