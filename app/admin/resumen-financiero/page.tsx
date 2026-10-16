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
  inversion: unknown;
  total_credito: unknown;
  total_pagado: unknown;
  saldo_pendiente: unknown;
  importe_atrasado: unknown;
  ganancia_bruta_proyectada: unknown;
  estado_financiero: string;
  devuelto: boolean;
};

type PanelCard = {
  saldo_pendiente: unknown;
  fecha_vencimiento: string | null;
  estado_periodo: string;
};

type HistoricalCollections = {
  total: unknown;
  activos: unknown;
  devueltos: unknown;
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

export default async function ResumenFinancieroPage() {
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
        <h1 className="text-2xl font-bold">Resumen financiero</h1>
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

  const ventaFinanciadaActiva = creditos.reduce(
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

  const moraVencida = creditos.reduce(
    (total, credito) => total + asNumber(credito.importe_atrasado),
    0
  );

  const gananciaBrutaProyectada = creditos.reduce(
    (total, credito) =>
      total + asNumber(credito.ganancia_bruta_proyectada),
    0
  );

  const tarjetas = panel.tarjetas ?? [];

  const saldoTarjetas = tarjetas.reduce(
    (total, tarjeta) => total + asNumber(tarjeta.saldo_pendiente),
    0
  );

  const tarjetasConFecha = tarjetas
    .filter(
      (tarjeta) =>
        tarjeta.estado_periodo === "CON_VENCIMIENTO" &&
        asNumber(tarjeta.saldo_pendiente) > 0
    )
    .reduce(
      (total, tarjeta) => total + asNumber(tarjeta.saldo_pendiente),
      0
    );

  const tarjetasSinPeriodo = tarjetas
    .filter(
      (tarjeta) =>
        tarjeta.estado_periodo !== "CON_VENCIMIENTO" &&
        asNumber(tarjeta.saldo_pendiente) > 0
    )
    .reduce(
      (total, tarjeta) => total + asNumber(tarjeta.saldo_pendiente),
      0
    );

  const cobranzasHistoricas = panel.cobranzas_historicas ?? {
    total: 0,
    activos: 0,
    devueltos: 0,
  };

  const flujoFuturoConocido = meses.reduce(
    (total, fila) =>
      total +
      asNumber(fila.cobranza_proyectada) -
      asNumber(fila.tarjetas_a_pagar),
    0
  );

  const margenProyectadoSobreInversion =
    inversionActiva > 0
      ? (gananciaBrutaProyectada / inversionActiva) * 100
      : 0;

  const metrics = [
    ["Inversión activa", inversionActiva],
    ["Venta financiada activa", ventaFinanciadaActiva],
    ["Cobrado créditos activos", cobradoActivos],
    ["Saldo por cobrar", saldoPorCobrar],
    ["Mora vencida", moraVencida],
    ["Ganancia bruta proyectada", gananciaBrutaProyectada],
    ["Saldo pendiente tarjetas", saldoTarjetas],
    ["Tarjetas con vencimiento conocido", tarjetasConFecha],
    ["Tarjetas sin período asignado", tarjetasSinPeriodo],
  ] as const;

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>
        <h1 className="text-3xl font-bold">Resumen financiero</h1>
        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Vista central de créditos, cobranzas, inversión y obligaciones de
          HUGELLA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value]) => (
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

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobranza histórica total
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(cobranzasHistoricas.total))}
          </p>
          <p className="mt-2 text-xs text-[var(--hugella-navy-secondary)]">
            Incluye créditos activos y devueltos.
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Flujo futuro conocido
          </p>
          <p
            className={`mt-2 text-2xl font-bold ${
              flujoFuturoConocido < 0
                ? "text-red-700"
                : "text-emerald-700"
            }`}
          >
            {money.format(flujoFuturoConocido)}
          </p>
          <p className="mt-2 text-xs text-[var(--hugella-navy-secondary)]">
            Cobranza proyectada menos obligaciones de tarjeta con fecha real.
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Ganancia proyectada / inversión
          </p>
          <p className="mt-2 text-2xl font-bold">
            {margenProyectadoSobreInversion.toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            %
          </p>
          <p className="mt-2 text-xs text-[var(--hugella-navy-secondary)]">
            Relación entre ganancia bruta proyectada e inversión activa.
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-6">
        <h2 className="text-xl font-bold">Lectura del resumen</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Créditos activos
            </p>
            <p className="mt-1 text-2xl font-bold">{creditos.length}</p>
          </div>

          <div>
            <p className="text-sm text-[var(--hugella-navy-secondary)]">
              Créditos atrasados
            </p>
            <p className="mt-1 text-2xl font-bold">
              {
                creditos.filter(
                  (credito) => credito.estado_financiero === "ATRASADO"
                ).length
              }
            </p>
          </div>
        </div>

        <p className="mt-5 text-sm text-[var(--hugella-navy-secondary)]">
          Las obligaciones de tarjeta sin período asignado forman parte del
          saldo total pendiente, pero no se colocan artificialmente en meses
          futuros hasta que exista un vencimiento real.
        </p>
      </section>
    </>
  );
}
