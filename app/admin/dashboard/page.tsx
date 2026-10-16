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

function percentage(value: number) {
  return `${value.toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

type PanelCredit = {
  codigo: string;
  cliente: string | null;
  inversion: unknown;
  total_credito: unknown;
  total_pagado: unknown;
  saldo_pendiente: unknown;
  importe_atrasado: unknown;
  estado_financiero: string;
  devuelto: boolean;
  ganancia_bruta_proyectada: unknown;
};

type PanelCard = {
  saldo_pendiente: unknown;
};

type HistoricalCollections = {
  total: unknown;
};

type MonthlyProjection = {
  mes: string;
  tipo_mes: "HISTORICO" | "ACTUAL" | "FUTURO";
  cobrado_real: unknown;
  cobranza_proyectada: unknown;
  tarjetas_pagadas_reconocidas: unknown;
  tarjetas_a_pagar: unknown;
  diferencia: unknown;
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: panelData, error: panelError },
    { data: projectionData, error: projectionError },
  ] = await Promise.all([
    supabase.rpc("obtener_panel_financiero_admin"),
    supabase.rpc("obtener_proyeccion_mensual_financiera_admin"),
  ]);

  if (panelError || projectionError) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-3">
          No se pudieron cargar todos los datos financieros.
        </p>
        <p className="mt-2 text-sm">
          {panelError?.message ?? projectionError?.message}
        </p>
      </section>
    );
  }

  const panel = (panelData ?? {}) as {
    creditos?: PanelCredit[];
    tarjetas?: PanelCard[];
    cobranzas_historicas?: HistoricalCollections;
  };

  const meses = (projectionData ?? []) as MonthlyProjection[];

  const creditos = (panel.creditos ?? []).filter(
    (credito) => credito.codigo !== "CR-0048" && !credito.devuelto
  );

  const inversionActiva = creditos.reduce(
    (total, credito) => total + asNumber(credito.inversion),
    0
  );

  const ventaFinanciada = creditos.reduce(
    (total, credito) => total + asNumber(credito.total_credito),
    0
  );

  const cobradoActivos = creditos.reduce(
    (total, credito) => total + asNumber(credito.total_pagado),
    0
  );

  const saldoPorCobrar = creditos.reduce(
    (total, credito) => total + asNumber(credito.saldo_pendiente),
    0
  );

  const mora = creditos.reduce(
    (total, credito) => total + asNumber(credito.importe_atrasado),
    0
  );

  const gananciaProyectada = creditos.reduce(
    (total, credito) =>
      total + asNumber(credito.ganancia_bruta_proyectada),
    0
  );

  const saldoTarjetas = (panel.tarjetas ?? []).reduce(
    (total, tarjeta) => total + asNumber(tarjeta.saldo_pendiente),
    0
  );

  const cobradoHistorico = asNumber(
    panel.cobranzas_historicas?.total
  );

  const flujoFuturoConocido = meses.reduce(
    (total, fila) =>
      total +
      asNumber(fila.cobranza_proyectada) -
      asNumber(fila.tarjetas_a_pagar),
    0
  );

  const porcentajeCobrado =
    ventaFinanciada > 0
      ? (cobradoActivos / ventaFinanciada) * 100
      : 0;

  const porcentajeMora =
    saldoPorCobrar > 0 ? (mora / saldoPorCobrar) * 100 : 0;

  const margenSobreInversion =
    inversionActiva > 0
      ? (gananciaProyectada / inversionActiva) * 100
      : 0;

  const moraOrdenada = [...creditos]
    .filter((credito) => asNumber(credito.importe_atrasado) > 0)
    .sort(
      (a, b) =>
        asNumber(b.importe_atrasado) -
        asNumber(a.importe_atrasado)
    )
    .slice(0, 5);

  const mesesOperativos = meses
    .filter((fila) => fila.tipo_mes !== "HISTORICO")
    .slice(0, 6);

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>
        <h1 className="text-3xl font-bold">Dashboard HUGELLA</h1>
        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Vista ejecutiva de créditos, cobranzas y compromisos financieros.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Saldo por cobrar
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(saldoPorCobrar)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobrado histórico
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(cobradoHistorico)}
          </p>
        </article>

        <article className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-800">Mora vencida</p>
          <p className="mt-2 text-2xl font-bold text-red-950">
            {money.format(mora)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Saldo tarjetas
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(saldoTarjetas)}
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Avance de cobranza
          </p>
          <p className="mt-2 text-3xl font-bold">
            {percentage(porcentajeCobrado)}
          </p>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{
                width: `${Math.min(porcentajeCobrado, 100)}%`,
              }}
            />
          </div>

          <p className="mt-3 text-xs text-[var(--hugella-navy-secondary)]">
            {money.format(cobradoActivos)} cobrados sobre{" "}
            {money.format(ventaFinanciada)} financiados.
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Mora sobre cartera pendiente
          </p>
          <p className="mt-2 text-3xl font-bold text-red-700">
            {percentage(porcentajeMora)}
          </p>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-red-500"
              style={{
                width: `${Math.min(porcentajeMora, 100)}%`,
              }}
            />
          </div>

          <p className="mt-3 text-xs text-[var(--hugella-navy-secondary)]">
            {money.format(mora)} vencidos dentro de una cartera de{" "}
            {money.format(saldoPorCobrar)}.
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Ganancia proyectada / inversión
          </p>
          <p className="mt-2 text-3xl font-bold">
            {percentage(margenSobreInversion)}
          </p>

          <p className="mt-4 text-xs text-[var(--hugella-navy-secondary)]">
            Inversión activa: {money.format(inversionActiva)}
          </p>
          <p className="mt-1 text-xs text-[var(--hugella-navy-secondary)]">
            Ganancia bruta proyectada:{" "}
            {money.format(gananciaProyectada)}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <p className="text-sm font-semibold text-emerald-800">
          Flujo futuro conocido
        </p>
        <p className="mt-2 text-3xl font-bold text-emerald-950">
          {money.format(flujoFuturoConocido)}
        </p>
        <p className="mt-2 text-sm text-emerald-800">
          Cobranza futura programada menos obligaciones de tarjetas que ya
          tienen vencimiento real.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
          <p className="section-kicker">Cobranza</p>
          <h2 className="mt-1 text-xl font-bold">
            Principales atrasos
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-3 pr-4">Crédito</th>
                  <th className="py-3 pr-4">Cliente</th>
                  <th className="py-3 text-right">Mora</th>
                </tr>
              </thead>

              <tbody>
                {moraOrdenada.map((credito) => (
                  <tr
                    key={credito.codigo}
                    className="border-b border-[var(--hugella-border)]"
                  >
                    <td className="py-3 pr-4 font-semibold">
                      {credito.codigo}
                    </td>
                    <td className="py-3 pr-4">
                      {credito.cliente ?? "Sin cliente"}
                    </td>
                    <td className="py-3 text-right font-semibold text-red-700">
                      {money.format(
                        asNumber(credito.importe_atrasado)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
          <p className="section-kicker">Flujo</p>
          <h2 className="mt-1 text-xl font-bold">
            Próximos meses conocidos
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-3 pr-4">Mes</th>
                  <th className="py-3 pr-4 text-right">Cobranza</th>
                  <th className="py-3 pr-4 text-right">Tarjetas</th>
                  <th className="py-3 text-right">Neto</th>
                </tr>
              </thead>

              <tbody>
                {mesesOperativos.map((fila) => {
                  const neto =
                    asNumber(fila.cobranza_proyectada) -
                    asNumber(fila.tarjetas_a_pagar);

                  return (
                    <tr
                      key={fila.mes}
                      className="border-b border-[var(--hugella-border)]"
                    >
                      <td className="py-3 pr-4 capitalize">
                        {formatMonth(fila.mes)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {money.format(
                          asNumber(fila.cobranza_proyectada)
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        {money.format(
                          asNumber(fila.tarjetas_a_pagar)
                        )}
                      </td>
                      <td
                        className={`py-3 text-right font-bold ${
                          neto < 0
                            ? "text-red-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {money.format(neto)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}
