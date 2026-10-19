import { createClient } from "@/utils/supabase/server";
import { formatDateAR } from "@/utils/date-format";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

type CicloCobertura = {
  numero_ciclo: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  obligaciones_tarjetas: number | string;
  tarjetas_objetivo: number | string;
  saldo_inicial: number | string;
  cobrado_ciclo: number | string;
  honorarios_retiros: number | string;
  disponible_para_tarjetas: number | string;
  faltante: number | string;
  superavit: number | string;
  saldo_final: number | string;
  porcentaje_cobertura: number | string;
  estado: "FALTA" | "ALCANZADO" | "SUPERAVIT";
  es_ciclo_actual: boolean;
};

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estadoTexto(ciclo: CicloCobertura) {
  if (ciclo.estado === "FALTA") {
    return `Faltan ${money.format(asNumber(ciclo.faltante))}`;
  }

  if (ciclo.estado === "ALCANZADO") {
    return "Objetivo alcanzado";
  }

  return `Superávit ${money.format(asNumber(ciclo.superavit))}`;
}

function resultadoCiclo(ciclo: CicloCobertura) {
  const faltante = asNumber(ciclo.faltante);
  const superavit = asNumber(ciclo.superavit);

  if (faltante > 0) {
    return {
      texto: `Faltan ${money.format(faltante)}`,
      clase: "text-red-700 font-semibold",
    };
  }

  if (superavit > 0) {
    return {
      texto: `Superávit ${money.format(superavit)}`,
      clase: "text-blue-700 font-semibold",
    };
  }

  return {
    texto: `Exacto ${money.format(0)}`,
    clase: "text-emerald-700 font-semibold",
  };
}

export default async function CoberturaFinancieraPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "obtener_cobertura_financiera_admin"
  );

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Cobertura financiera</h1>
        <p className="mt-3">
          No se pudo cargar la cobertura financiera.
        </p>
        <p className="mt-2 text-sm">{error.message}</p>
      </section>
    );
  }

  const ciclos = (data ?? []) as CicloCobertura[];

  const actual =
    ciclos.find((ciclo) => ciclo.es_ciclo_actual) ??
    ciclos[ciclos.length - 1] ??
    null;

  if (!actual) {
    return (
      <section>
        <p className="section-kicker">Finanzas</p>
        <h1 className="text-3xl font-bold">Cobertura financiera</h1>
        <p className="mt-4">
          Todavía no hay ciclos financieros disponibles.
        </p>
      </section>
    );
  }

  const porcentaje = Math.max(
    0,
    Math.min(100, asNumber(actual.porcentaje_cobertura))
  );

  const estadoActual =
    actual.estado === "FALTA"
      ? "border-red-200 bg-red-50 text-red-900"
      : actual.estado === "ALCANZADO"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-blue-200 bg-blue-50 text-blue-900";

  return (
    <>
      <section>
        <p className="section-kicker">Finanzas</p>

        <h1 className="text-3xl font-bold">
          Cobertura financiera
        </h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Seguimiento de la recaudación disponible para cubrir vencimientos de
          tarjetas y honorarios o retiros realizados.
        </p>
      </section>

      <section className={`rounded-xl border p-6 ${estadoActual}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide">
              Ciclo actual
            </p>

            <h2 className="mt-1 text-2xl font-bold">
              {formatDateAR(actual.fecha_inicio)} →{" "}
              {formatDateAR(actual.fecha_vencimiento)}
            </h2>
          </div>

          <div className="text-left sm:text-right">
            <p className="text-sm font-semibold">Estado</p>
            <p className="mt-1 text-2xl font-bold">
              {estadoTexto(actual)}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex justify-between gap-4 text-sm font-semibold">
            <span>Cobertura de tarjetas</span>
            <span>{porcentaje.toFixed(2)}%</span>
          </div>

          <div className="h-4 overflow-hidden rounded-full bg-white/70">
            <div
              className="h-full rounded-full bg-current"
              style={{ width: `${porcentaje}%` }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Saldo inicial
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(actual.saldo_inicial))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobrado en el ciclo
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(actual.cobrado_ciclo))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Honorarios y retiros
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(actual.honorarios_retiros))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Disponible para tarjetas
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(actual.disponible_para_tarjetas))}
          </p>
        </article>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Objetivo tarjetas
          </p>

          <p className="mt-2 text-2xl font-bold">
            {money.format(asNumber(actual.tarjetas_objetivo))}
          </p>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            {Number(actual.obligaciones_tarjetas)} obligaciones
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Falta para cubrir
          </p>

          <p className="mt-2 text-2xl font-bold text-red-700">
            {money.format(asNumber(actual.faltante))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Superávit
          </p>

          <p className="mt-2 text-2xl font-bold text-blue-700">
            {money.format(asNumber(actual.superavit))}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[var(--hugella-border)] bg-white p-5 sm:p-6">
        <div className="mb-5">
          <p className="section-kicker">Historial</p>
          <h2 className="mt-1 text-xl font-bold">
            Ciclos financieros
          </h2>

          <p className="mt-1 text-sm text-[var(--hugella-navy-secondary)]">
            Cada ciclo comienza el día siguiente al vencimiento anterior y
            termina en el próximo vencimiento de tarjeta.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-3 pr-4">Período</th>
                <th className="py-3 pr-4 text-right">Saldo inicial</th>
                <th className="py-3 pr-4 text-right">Cobrado</th>
                <th className="py-3 pr-4 text-right">Honorarios</th>
                <th className="py-3 pr-4 text-right">Disponible</th>
                <th className="py-3 pr-4 text-right">Tarjetas</th>
                <th className="py-3 pr-4 text-right">Resultado</th>
                <th className="py-3">Estado</th>
              </tr>
            </thead>

            <tbody>
              {ciclos
                .slice()
                .reverse()
                .map((ciclo) => {
                  const resultado = resultadoCiclo(ciclo);

                  return (
                    <tr
                      key={ciclo.numero_ciclo}
                      className={
                        ciclo.es_ciclo_actual
                          ? "border-b bg-blue-50"
                          : "border-b border-[var(--hugella-border)]"
                      }
                    >
                      <td className="whitespace-nowrap py-4 pr-4 font-semibold">
                        {formatDateAR(ciclo.fecha_inicio)} →{" "}
                        {formatDateAR(ciclo.fecha_vencimiento)}
                      </td>

                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {money.format(asNumber(ciclo.saldo_inicial))}
                      </td>

                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {money.format(asNumber(ciclo.cobrado_ciclo))}
                      </td>

                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {money.format(asNumber(ciclo.honorarios_retiros))}
                      </td>

                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {money.format(
                          asNumber(ciclo.disponible_para_tarjetas)
                        )}
                      </td>

                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {money.format(asNumber(ciclo.tarjetas_objetivo))}
                      </td>

                      <td
                        className={`whitespace-nowrap py-4 pr-4 text-right ${resultado.clase}`}
                      >
                        {resultado.texto}
                      </td>

                      <td className="whitespace-nowrap py-4">
                        <span
                          className={
                            ciclo.estado === "FALTA"
                              ? "rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800"
                              : ciclo.estado === "ALCANZADO"
                                ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800"
                                : "rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800"
                          }
                        >
                          {ciclo.estado === "SUPERAVIT"
                            ? "SUPERÁVIT"
                            : ciclo.estado}
                        </span>
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