import { createClient } from "@/utils/supabase/server";
import HonorariosClient, {
  type HonorarioRetiro,
} from "./honorarios-client";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

type ResumenHonorarios = {
  fecha_evaluacion: string;
  inicio_mes: string;
  inicio_ano: string;
  retirado_mes: number | string;
  retirado_ano: number | string;
  movimientos_mes: number | string;
};

export default async function HonorariosPage() {
  const supabase = await createClient();

  const [
    { data: movimientosData, error: movimientosError },
    { data: resumenData, error: resumenError },
  ] = await Promise.all([
    supabase.rpc("listar_honorarios_retiros_admin"),
    supabase.rpc("obtener_resumen_honorarios_retiros_admin"),
  ]);

  if (movimientosError || resumenError) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Honorarios y retiros</h1>

        <p className="mt-3">
          No se pudieron cargar los movimientos financieros.
        </p>

        <p className="mt-2 text-sm">
          {movimientosError?.message ?? resumenError?.message}
        </p>
      </section>
    );
  }

  const movimientos =
    (movimientosData ?? []) as HonorarioRetiro[];

  const resumen =
    ((resumenData ?? [])[0] ?? {
      retirado_mes: 0,
      retirado_ano: 0,
      movimientos_mes: 0,
    }) as ResumenHonorarios;

  return (
    <>
      <section>
        <p className="section-kicker">Finanzas</p>

        <h1 className="text-3xl font-bold">
          Honorarios y retiros
        </h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Registro de honorarios, adelantos y retiros de dinero realizados
          desde HUGELLA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Retirado este mes
          </p>

          <p className="mt-2 text-2xl font-bold">
            {money.format(Number(resumen.retirado_mes))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Retirado este año
          </p>

          <p className="mt-2 text-2xl font-bold">
            {money.format(Number(resumen.retirado_ano))}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Movimientos del mes
          </p>

          <p className="mt-2 text-3xl font-bold">
            {Number(resumen.movimientos_mes)}
          </p>
        </article>
      </section>

      <HonorariosClient movimientos={movimientos} />
    </>
  );
}
