import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type CreditoListado = {
  credito_id: string;
  codigo: string;
  cliente_id: string;
  cliente: string;
  producto: string;
  fecha_inicio: string;
  importe_cuota: number | string;
  cantidad_cuotas: number;
  cuotas_pagadas: number;
  cuotas_deberia_llevar: number;
  cuotas_atrasadas: number;
  importe_atrasado: number | string;
  estado: string;
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function estadoStyle(estado: string) {
  switch (estado) {
    case "ATRASADO":
      return "border-red-300 bg-red-50 text-red-700";

    case "AL DIA":
      return "border-green-300 bg-green-50 text-green-700";

    case "ADELANTADO":
      return "border-blue-300 bg-blue-50 text-blue-700";

    case "CANCELADO":
      return "border-slate-300 bg-slate-100 text-slate-700";

    case "DEVUELTO":
    case "RETIRADO":
      return "border-orange-300 bg-orange-50 text-orange-700";

    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}

function estadoLabel(estado: string) {
  return estado === "AL DIA" ? "AL DÍA" : estado;
}

function situacionCuotas(credito: CreditoListado) {
  const diferencia =
    credito.cuotas_pagadas - credito.cuotas_deberia_llevar;

  if (diferencia < 0) {
    return {
      label: `${Math.abs(diferencia)} atrasadas`,
      className: "text-red-700",
    };
  }

  if (diferencia > 0) {
    return {
      label: `${diferencia} adelantadas`,
      className: "text-blue-700",
    };
  }

  return {
    label: "Al día",
    className: "text-green-700",
  };
}

export default async function CreditosPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("listar_creditos_admin");

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Créditos</h1>
        <p className="mt-3">
          No se pudo cargar el listado de créditos.
        </p>
      </section>
    );
  }

  const creditos = ((data ?? []) as CreditoListado[]).filter(
    (credito) => credito.codigo !== "CR-0048"
  );

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>

        <h1 className="text-3xl font-bold">Créditos</h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Todos los créditos registrados, ordenados del más viejo al más nuevo.
        </p>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold">Listado de créditos</h2>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Créditos registrados: {creditos.length}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">ID</th>
                <th className="py-3 pr-4">Cliente</th>
                <th className="py-3 pr-4">Producto</th>
                <th className="py-3 pr-4 text-right">Monto diario</th>
                <th className="py-3 pr-4 text-right">Cuotas</th>
                <th className="py-3 pr-4 text-right">Pagadas</th>
                <th className="py-3 pr-4 text-right">Debería llevar</th>
                <th className="py-3 pr-4 text-right">Situación</th>
                <th className="py-3 pr-4 text-right">Importe atrasado</th>
                <th className="py-3 text-right">Estado</th>
              </tr>
            </thead>

            <tbody>
              {creditos.map((credito) => (
                <tr
                  key={credito.credito_id}
                  className="border-b border-[var(--hugella-border)]"
                >
                  <td className="py-3 pr-4 font-semibold">
                    {credito.codigo}
                  </td>

                  <td className="py-3 pr-4 font-semibold">
                    <Link
                      href={`/admin/clientes/${credito.cliente_id}`}
                      className="underline"
                    >
                      {credito.cliente}
                    </Link>
                  </td>

                  <td className="py-3 pr-4">
                    {credito.producto}
                  </td>

                  <td className="py-3 pr-4 text-right font-semibold">
                    {money.format(Number(credito.importe_cuota))}
                  </td>

                  <td className="py-3 pr-4 text-right">
                    {credito.cantidad_cuotas}
                  </td>

                  <td className="py-3 pr-4 text-right">
                    {credito.cuotas_pagadas}
                  </td>

                  <td className="py-3 pr-4 text-right">
                    {credito.cuotas_deberia_llevar}
                  </td>

                  <td className="py-3 pr-4 text-right font-semibold">
                    {(() => {
                      const situacion = situacionCuotas(credito);

                      return (
                        <span className={situacion.className}>
                          {situacion.label}
                        </span>
                      );
                    })()}
                  </td>

                  <td className="py-3 pr-4 text-right font-semibold">
                    {money.format(Number(credito.importe_atrasado))}
                  </td>

                  <td className="py-3 text-right">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${estadoStyle(
                        credito.estado
                      )}`}
                    >
                      {estadoLabel(credito.estado)}
                    </span>
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
