import { createClient } from "@/utils/supabase/server";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

type MonthlyProjection = {
  mes: string;
  tipo_mes: "HISTORICO" | "ACTUAL" | "FUTURO";
  cobrado_real: unknown;
  cobranza_proyectada: unknown;
  tarjetas_pagadas_reconocidas: unknown;
  tarjetas_a_pagar: unknown;
  diferencia: unknown;
};

export default async function ProyeccionMensualPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "obtener_proyeccion_mensual_financiera_admin"
  );

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Proyección mensual</h1>
        <p className="mt-3">
          No se pudo cargar la proyección financiera mensual.
        </p>
        <p className="mt-2 text-sm">{error.message}</p>
      </section>
    );
  }

  const meses = (data ?? []) as MonthlyProjection[];

  const cobradoTotal = meses.reduce(
    (total, fila) => total + asNumber(fila.cobrado_real),
    0
  );

  const proyectadoTotal = meses.reduce(
    (total, fila) => total + asNumber(fila.cobranza_proyectada),
    0
  );

  const tarjetasPagadasTotal = meses.reduce(
    (total, fila) =>
      total + asNumber(fila.tarjetas_pagadas_reconocidas),
    0
  );

  const tarjetasPendientesConFecha = meses.reduce(
    (total, fila) => total + asNumber(fila.tarjetas_a_pagar),
    0
  );

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>
        <h1 className="text-3xl font-bold">Proyección mensual</h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Flujo financiero mensual de cobranzas y obligaciones de tarjetas.
        </p>

        <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
          Las cuotas de tarjeta que todavía no tienen un período real asignado
          no se proyectan en una fecha futura.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobrado real histórico
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(cobradoTotal)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobranza proyectada
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(proyectadoTotal)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Tarjetas pagadas / reconocidas
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(tarjetasPagadasTotal)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Tarjetas pendientes con fecha
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(tarjetasPendientesConFecha)}
          </p>
        </article>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--hugella-border)] bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Mes</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Cobrado real
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Cobranza proyectada
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Tarjetas pagadas
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Tarjetas a pagar
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  Diferencia
                </th>
              </tr>
            </thead>

            <tbody>
              {meses.map((fila) => {
                const diferencia = asNumber(fila.diferencia);

                return (
                  <tr
                    key={fila.mes}
                    className="border-t border-[var(--hugella-border)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-semibold capitalize">
                      {formatMonth(fila.mes)}
                    </td>

                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                        {fila.tipo_mes}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {money.format(asNumber(fila.cobrado_real))}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {money.format(asNumber(fila.cobranza_proyectada))}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {money.format(
                        asNumber(fila.tarjetas_pagadas_reconocidas)
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {money.format(asNumber(fila.tarjetas_a_pagar))}
                    </td>

                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                        diferencia < 0
                          ? "text-red-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {money.format(diferencia)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
