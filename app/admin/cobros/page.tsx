import { createClient } from "@/utils/supabase/server";
import CobrosClient, { type Cobro } from "./cobros-client";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

function asNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function CobrosPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("listar_cobros_admin");

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-2xl font-bold">Control de cobros</h1>
        <p className="mt-3">
          No se pudo cargar el historial de cobros.
        </p>
      </section>
    );
  }

  const cobros = (data ?? []) as Cobro[];

  const validos = cobros.filter((cobro) => cobro.estado === "VALIDO");
  const anulados = cobros.filter((cobro) => cobro.estado === "ANULADO");

  const totalHistorico = validos.reduce(
    (total, cobro) => total + asNumber(cobro.importe),
    0
  );

  return (
    <>
      <section>
        <p className="section-kicker">Administración</p>

        <h1 className="text-3xl font-bold">
          Control de cobros
        </h1>

        <p className="mt-2 text-sm text-[var(--hugella-navy-secondary)]">
          Historial completo de pagos registrados en HUGELLA.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Cobrado histórico
          </p>

          <p className="mt-2 text-2xl font-bold">
            {money.format(totalHistorico)}
          </p>
        </article>

        <article className="rounded-xl border border-[var(--hugella-border)] bg-white p-5">
          <p className="text-sm text-[var(--hugella-navy-secondary)]">
            Pagos válidos
          </p>

          <p className="mt-2 text-3xl font-bold">
            {validos.length}
          </p>
        </article>

        <article className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-800">
            Pagos anulados
          </p>

          <p className="mt-2 text-3xl font-bold text-red-950">
            {anulados.length}
          </p>
        </article>
      </section>

      <CobrosClient cobros={cobros} />
    </>
  );
}
