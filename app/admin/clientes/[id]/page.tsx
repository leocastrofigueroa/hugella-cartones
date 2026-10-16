import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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

  const { data, error } = await supabase.rpc(
    "obtener_cartones_cliente_admin",
    {
      p_cliente_id: id,
    }
  );

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Cartones del cliente</h1>
        <p className="mt-3">
          No se pudieron cargar los cartones de este cliente.
        </p>
      </section>
    );
  }

  const cartones = (data ?? []) as CartonCliente[];

  if (cartones.length === 1 && cartones[0].access_token) {
    redirect(`/carton/${cartones[0].access_token}`);
  }

  return (
    <>
      <section>
        <p className="section-kicker">Clientes</p>
        <h1 className="text-3xl font-bold">Cartones del cliente</h1>
        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Seleccioná el crédito que querés consultar.
        </p>
      </section>

      {cartones.length === 0 ? (
        <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-6">
          <p className="font-semibold">
            Este cliente todavía no tiene créditos registrados.
          </p>

          <Link
            href="/admin/clientes"
            className="mt-4 inline-flex font-semibold underline"
          >
            Volver a clientes
          </Link>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {cartones.map((carton) => (
            <article
              key={carton.credito_id}
              className="rounded-xl border border-[var(--hugella-border)] bg-white p-5"
            >
              <p className="text-sm text-[var(--hugella-navy-secondary)]">
                {carton.codigo}
              </p>

              <h2 className="mt-1 text-lg font-bold">
                {carton.producto}
              </h2>

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
        </section>
      )}
    </>
  );
}
