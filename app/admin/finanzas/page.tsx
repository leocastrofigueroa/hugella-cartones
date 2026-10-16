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

type PanelProjection = {
  mes: string;
  creditos_con_cobranza: number;
  recaudacion_programada: unknown;
};

type PanelCard = {
  tarjeta: string;
  saldo_pendiente: unknown;
  fecha_vencimiento: string | null;
  estado_periodo: string;
};

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

export default async function FinanzasPage() {
  const supabase = await createClient();

  const { data: panelData, error: loadError } = await supabase.rpc(
    "obtener_panel_financiero_admin"
  );

  if (loadError) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Panel Financiero</h1>
        <p className="mt-3">
          No se pudieron cargar los datos financieros.
        </p>
        <p className="mt-2 text-sm">
          Primero verificaremos permisos de lectura de las vistas antes de
          cambiar ninguna otra parte del sistema.
        </p>
      </section>
    );
  }

  const panel = (panelData ?? {}) as {
    creditos?: PanelCredit[];
    proyeccion?: PanelProjection[];
    tarjetas?: PanelCard[];
  };

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

  const cobrado = creditos.reduce(
    (total, credito) => total + asNumber(credito.total_pagado),
    0
  );

  const saldoPendiente = creditos.reduce(
    (total, credito) => total + asNumber(credito.saldo_pendiente),
    0
  );

  const moraTotal = creditos.reduce(
    (total, credito) => total + asNumber(credito.importe_atrasado),
    0
  );

  const gananciaProyectada = creditos.reduce(
    (total, credito) =>
      total + asNumber(credito.ganancia_bruta_proyectada),
    0
  );

  const atrasados = creditos.filter(
    (credito) => credito.estado_financiero === "ATRASADO"
  ).length;

  const adelantados = creditos.filter(
    (credito) => credito.estado_financiero === "ADELANTADO"
  ).length;

  const moraOrdenada = [...creditos]
    .filter((credito) => asNumber(credito.importe_atrasado) > 0)
    .sort(
      (a, b) =>
        asNumber(b.importe_atrasado) - asNumber(a.importe_atrasado)
    )
    .slice(0, 8);

  const tarjetas = panel.tarjetas ?? [];

  const saldoTarjetas = tarjetas.reduce(
    (total, obligacion) => total + asNumber(obligacion.saldo_pendiente),
    0
  );

  const conVencimiento = tarjetas.filter(
    (obligacion) =>
      obligacion.estado_periodo === "CON_VENCIMIENTO" &&
      asNumber(obligacion.saldo_pendiente) > 0
  );

  const fechasVencimiento = conVencimiento
    .map((obligacion) => obligacion.fecha_vencimiento)
    .filter((fecha): fecha is string => Boolean(fecha))
    .sort();

  const proximoVencimiento =
    fechasVencimiento.length > 0 ? fechasVencimiento[0] : null;

  const importeProximoVencimiento = conVencimiento
    .filter(
      (obligacion) =>
        obligacion.fecha_vencimiento === proximoVencimiento
    )
    .reduce(
      (total, obligacion) =>
        total + asNumber(obligacion.saldo_pendiente),
      0
    );

  const cards = [
    ["Inversión activa", inversionActiva],
    ["Venta financiada activa", ventaFinanciada],
    ["Cobrado", cobrado],
    ["Saldo por cobrar", saldoPendiente],
    ["Mora vencida", moraTotal],
    ["Ganancia bruta proyectada", gananciaProyectada],
  ] as const;

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>
        <h1 className="text-3xl font-bold">Panel Financiero</h1>
        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Situación financiera actual de HUGELLA calculada desde Supabase.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value]) => (
          <article
            key={label}
            className="rounded-xl border border-[var(--hugella-border)] bg-white p-5"
          >
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              {label}
            </p>
            <p className="mt-2 text-2xl font-bold">
              {money.format(value)}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Créditos activos
          </p>
          <p className="mt-2 text-3xl font-bold">{creditos.length}</p>
        </article>

        <article className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-800">Atrasados</p>
          <p className="mt-2 text-3xl font-bold text-red-950">
            {atrasados}
          </p>
        </article>

        <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm text-emerald-800">Adelantados</p>
          <p className="mt-2 text-3xl font-bold text-emerald-950">
            {adelantados}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <p className="section-kicker">Cobranza</p>
          <h2 className="text-xl font-bold">Mayor mora actual</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">Crédito</th>
                <th className="py-3 pr-4">Cliente</th>
                <th className="py-3 text-right">Importe vencido</th>
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
                  <td className="py-3 pr-4">{credito.cliente}</td>
                  <td className="py-3 text-right font-semibold">
                    {money.format(asNumber(credito.importe_atrasado))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <p className="section-kicker">Proyección</p>
          <h2 className="text-xl font-bold">
            Cobranza futura por mes
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">Mes</th>
                <th className="py-3 pr-4 text-right">Créditos</th>
                <th className="py-3 text-right">
                  Recaudación programada
                </th>
              </tr>
            </thead>
            <tbody>
              {(panel.proyeccion ?? []).map((fila) => (
                <tr
                  key={fila.mes}
                  className="border-b border-[var(--hugella-border)]"
                >
                  <td className="py-3 pr-4">
                    {new Intl.DateTimeFormat("es-AR", {
                      month: "long",
                      year: "numeric",
                      timeZone: "America/Argentina/Buenos_Aires",
                    }).format(
                      new Date(`${fila.mes}T12:00:00-03:00`)
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {fila.creditos_con_cobranza}
                  </td>
                  <td className="py-3 text-right font-semibold">
                    {money.format(
                      asNumber(fila.recaudacion_programada)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
          <p className="section-kicker">Tarjetas</p>
          <h2 className="mt-1 text-xl font-bold">Saldo pendiente</h2>
          <p className="mt-4 text-3xl font-bold">
            {money.format(saldoTarjetas)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
          <p className="section-kicker">Próximo vencimiento</p>
          <h2 className="mt-1 text-xl font-bold">
            {formatDate(proximoVencimiento)}
          </h2>
          <p className="mt-4 text-3xl font-bold">
            {money.format(importeProximoVencimiento)}
          </p>
        </article>
      </section>
    </>
  );
}
