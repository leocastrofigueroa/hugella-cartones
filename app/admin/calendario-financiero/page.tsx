import { createClient } from "@/utils/supabase/server";

type Obligacion = {
  obligacion_id: string;
  compra_id: string;
  referencia_compra: string | null;
  fecha_compra: string;
  producto: string;
  tarjeta: string;
  numero_cuota: number;
  cantidad_cuotas: number;
  importe: number | string;
  importe_cortado_historico: number | string;
  importe_pagado_real: number | string;
  saldo_pendiente: number | string;
  periodo_orden: number | null;
  fecha_cierre: string | null;
  fecha_vencimiento: string | null;
  estado: "PAGADA" | "PENDIENTE" | "SIN_PERIODO" | "ANULADA";
  compra_anulada: boolean;
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function asNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha asignada";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

export default async function CalendarioFinancieroPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "listar_calendario_financiero_admin"
  );

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Calendario Financiero</h1>
        <p className="mt-3">
          No se pudo cargar el calendario financiero.
        </p>
      </section>
    );
  }

  const obligaciones = (data ?? []) as Obligacion[];

  const pagadas = obligaciones.filter(
    (obligacion) => obligacion.estado === "PAGADA"
  );

  const pendientes = obligaciones.filter(
    (obligacion) => obligacion.estado === "PENDIENTE"
  );

  const sinPeriodo = obligaciones.filter(
    (obligacion) => obligacion.estado === "SIN_PERIODO"
  );

  const anuladas = obligaciones.filter(
    (obligacion) => obligacion.estado === "ANULADA"
  );

  const totalPendiente = [...pendientes, ...sinPeriodo].reduce(
    (total, obligacion) => total + asNumber(obligacion.saldo_pendiente),
    0
  );

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>

        <h1 className="text-3xl font-bold">
          Calendario Financiero
        </h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Historial y obligaciones de tarjetas de HUGELLA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Obligaciones
          </p>
          <p className="mt-2 text-3xl font-bold">
            {obligaciones.length}
          </p>
        </article>

        <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm text-emerald-800">
            Pagadas
          </p>
          <p className="mt-2 text-3xl font-bold text-emerald-950">
            {pagadas.length}
          </p>
        </article>

        <article className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-800">
            Pendientes con vencimiento
          </p>
          <p className="mt-2 text-3xl font-bold text-amber-950">
            {pendientes.length}
          </p>
        </article>

        <article className="rounded-xl border border-slate-300 bg-slate-50 p-5">
          <p className="text-sm text-slate-700">
            Sin período
          </p>
          <p className="mt-2 text-3xl font-bold">
            {sinPeriodo.length}
          </p>
        </article>

        <article className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-800">
            Anuladas
          </p>
          <p className="mt-2 text-3xl font-bold text-red-950">
            {anuladas.length}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
        <p className="text-sm text-[var(--hugella-navy-secondary)]">
          Saldo pendiente total de tarjetas
        </p>
        <p className="mt-2 text-3xl font-bold">
          {money.format(totalPendiente)}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold">
            Obligaciones de tarjetas
          </h2>
          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Las cuotas sin período todavía no tienen una fecha futura real asignada.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1550px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--hugella-border)] bg-slate-50">
                <th className="px-4 py-4">Vencimiento</th>
                <th className="px-4 py-4">Compra</th>
                <th className="px-4 py-4">Fecha compra</th>
                <th className="px-4 py-4">Producto</th>
                <th className="px-4 py-4">Tarjeta</th>
                <th className="px-4 py-4">Cuota</th>
                <th className="px-4 py-4 text-right">Importe</th>
                <th className="px-4 py-4 text-right">Saldo</th>
                <th className="px-4 py-4">Período</th>
                <th className="px-4 py-4">Estado</th>
              </tr>
            </thead>

            <tbody>
              {obligaciones.map((obligacion) => (
                <tr
                  key={obligacion.obligacion_id}
                  className={
                    obligacion.estado === "ANULADA"
                      ? "border-b border-red-100 bg-red-50"
                      : obligacion.estado === "PAGADA"
                      ? "border-b border-emerald-100 bg-emerald-50/40"
                      : "border-b border-[var(--hugella-border)]"
                  }
                >
                  <td className="whitespace-nowrap px-4 py-4">
                    {formatDate(obligacion.fecha_vencimiento)}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4 font-semibold">
                    {obligacion.referencia_compra ?? "Compra nueva"}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4">
                    {formatDate(obligacion.fecha_compra)}
                  </td>

                  <td className="min-w-[260px] px-4 py-4">
                    {obligacion.producto}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4">
                    {obligacion.tarjeta}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4">
                    {obligacion.numero_cuota}/{obligacion.cantidad_cuotas}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4 text-right font-semibold">
                    {money.format(asNumber(obligacion.importe))}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4 text-right font-semibold">
                    {money.format(asNumber(obligacion.saldo_pendiente))}
                  </td>

                  <td className="whitespace-nowrap px-4 py-4">
                    {obligacion.periodo_orden
                      ? `Período ${obligacion.periodo_orden}`
                      : "Sin período"}
                  </td>

                  <td className="px-4 py-4">
                    <span className="font-bold">
                      {obligacion.estado}
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
