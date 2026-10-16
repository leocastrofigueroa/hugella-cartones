import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type Cliente = {
  id: string;
  nombre: string | null;
  dni: string | null;
  telefono: string | null;
  domicilio: string | null;
  ubicacion: string | null;
  cantidad_creditos: number | string | null;
};

function mostrar(value: string | null) {
  const limpio = value?.trim();
  return limpio ? limpio : "—";
}

export default async function ClientesPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("listar_clientes_admin");

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="mt-3">
          No se pudo cargar el listado de clientes.
        </p>
      </section>
    );
  }

  const clientes = (data ?? []) as Cliente[];

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>
        <h1 className="text-3xl font-bold">Clientes</h1>
        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Listado completo de clientes registrados en HUGELLA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Clientes registrados
          </p>
          <p className="mt-2 text-3xl font-bold">{clientes.length}</p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Créditos asociados
          </p>
          <p className="mt-2 text-3xl font-bold">
            {clientes.reduce(
              (total, cliente) =>
                total + Number(cliente.cantidad_creditos ?? 0),
              0
            )}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold">Todos los clientes</h2>
          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Ordenados alfabéticamente.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">Nombre</th>
                <th className="py-3 pr-4">DNI</th>
                <th className="py-3 pr-4">Teléfono</th>
                <th className="py-3 pr-4">Domicilio</th>
                <th className="py-3 pr-4">Ubicación</th>
                <th className="py-3 text-right">Créditos</th>
              </tr>
            </thead>

            <tbody>
              {clientes.map((cliente) => (
                <tr
                  key={cliente.id}
                  className="border-b border-[var(--hugella-border)]"
                >
                  <td className="py-3 pr-4 font-semibold">
                    <Link
                      href={`/admin/clientes/${cliente.id}`}
                      className="underline"
                    >
                      {mostrar(cliente.nombre)}
                    </Link>
                  </td>

                  <td className="py-3 pr-4">
                    {mostrar(cliente.dni)}
                  </td>

                  <td className="py-3 pr-4">
                    {mostrar(cliente.telefono)}
                  </td>

                  <td className="py-3 pr-4">
                    {mostrar(cliente.domicilio)}
                  </td>

                  <td className="py-3 pr-4">
                    {cliente.ubicacion ? (
                      <a
                        href={cliente.ubicacion}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline"
                      >
                        Ver ubicación
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td className="py-3 text-right font-semibold">
                    {Number(cliente.cantidad_creditos ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
