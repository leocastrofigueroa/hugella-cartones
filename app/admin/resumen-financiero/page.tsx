import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { formatDateAR } from "@/utils/date-format";

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

type CoverageCycle = {
  numero_ciclo: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  tarjetas_objetivo: unknown;
  saldo_inicial: unknown;
  cobrado_ciclo: unknown;
  honorarios_retiros: unknown;
  disponible_para_tarjetas: unknown;
  faltante: unknown;
  superavit: unknown;
  porcentaje_cobertura: unknown;
  estado: "FALTA" | "ALCANZADO" | "SUPERAVIT";
  es_ciclo_actual: boolean;
};

export default async function ResumenFinancieroPage() {
  const supabase = await createClient();

  const [
    { data: panelData, error: panelError },
    { data: projectionData, error: projectionError },
    { data: coverageData, error: coverageError },
  ] = await Promise.all([
    supabase.rpc("obtener_panel_financiero_admin"),
    supabase.rpc("obtener_proyeccion_mensual_financiera_admin"),
    supabase.rpc("obtener_cobertura_financiera_admin"),
  ]);

  if (panelError || projectionError || coverageError) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Resumen financiero</h1>
        <p className="mt-3">
          No se pudieron cargar todos los datos financieros.
        </p>
        <p className="mt-2 text-sm">
          {panelError?.message ??
            projectionError?.message ??
            coverageError?.message}
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
  const ciclosCobertura = (coverageData ?? []) as CoverageCycle[];

  const cicloActual =
    ciclosCobertura.find((ciclo) => ciclo.es_ciclo_actual) ??
    ciclosCobertura[ciclosCobertura.length - 1] ??
    null;

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

      {cicloActual && (
        <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="section-kicker">Cobertura del ciclo actual</p>

              <h2 className="mt-1 text-xl font-bold">
                {formatDateAR(cicloActual.fecha_inicio)} →{" "}
                {formatDateAR(cicloActual.fecha_vencimiento)}
              </h2>
            </div>

            <Link
              href="/admin/cobertura-financiera"
              className="rounded-lg border border-[var(--hugella-border)] px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Ver detalle
            </Link>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-sm text-[var(--hugella-navy-secondary)]">
                Objetivo tarjetas
              </p>
              <p className="mt-1 text-xl font-bold">
                {money.format(asNumber(cicloActual.tarjetas_objetivo))}
              </p>
            </div>

            <div>
              <p className="text-sm text-[var(--hugella-navy-secondary)]">
                Disponible para tarjetas
              </p>
              <p className="mt-1 text-xl font-bold">
                {money.format(
                  asNumber(cicloActual.disponible_para_tarjetas)
                )}
              </p>
            </div>

            <div>
              <p className="text-sm text-[var(--hugella-navy-secondary)]">
                Honorarios y retiros
              </p>
              <p className="mt-1 text-xl font-bold">
                {money.format(asNumber(cicloActual.honorarios_retiros))}
              </p>
            </div>

            <div>
              <p className="text-sm text-[var(--hugella-navy-secondary)]">
                Resultado
              </p>

              {asNumber(cicloActual.faltante) > 0 ? (
                <p className="mt-1 text-xl font-bold text-red-700">
                  Faltan {money.format(asNumber(cicloActual.faltante))}
                </p>
              ) : asNumber(cicloActual.superavit) > 0 ? (
                <p className="mt-1 text-xl font-bold text-blue-700">
                  Superávit {money.format(asNumber(cicloActual.superavit))}
                </p>
              ) : (
                <p className="mt-1 text-xl font-bold text-emerald-700">
                  Objetivo alcanzado
                </p>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm font-semibold">
              <span>Cobertura de tarjetas</span>
              <span>
                {asNumber(cicloActual.porcentaje_cobertura).toLocaleString(
                  "es-AR",
                  {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }
                )}
                %
              </span>
            </div>

            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-[var(--hugella-navy)]"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      asNumber(cicloActual.porcentaje_cobertura)
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
        </section>
      )}

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
