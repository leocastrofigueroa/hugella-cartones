import CreditStatus from "../../components/credit-status";
import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type PublicPayment = {
  fecha_pago: string;
  medio_pago: string;
  importe: number | string;
  cuotas_aplicadas: number;
};

type PublicCredit = {
  nombre_cliente: string;
  codigo_credito: string;
  producto: string;
  fecha_inicio: string;
  cantidad_cuotas: number;
  importe_cuota: number | string;
  estado: string;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  pagos: PublicPayment[];
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const date = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(value: string) {
  return date.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6" /></svg>;
}

function isPublicCredit(value: unknown): value is PublicCredit {
  if (!value || typeof value !== "object") return false;

  const credit = value as Record<string, unknown>;
  return typeof credit.nombre_cliente === "string"
    && typeof credit.codigo_credito === "string"
    && typeof credit.producto === "string"
    && typeof credit.fecha_inicio === "string"
    && (typeof credit.importe_cuota === "number" || typeof credit.importe_cuota === "string")
    && typeof credit.cantidad_cuotas === "number"
    && typeof credit.cuotas_pagadas === "number"
    && typeof credit.cuotas_pendientes === "number"
    && typeof credit.estado === "string"
    && Array.isArray(credit.pagos);
}

export default async function PublicCreditPage({ params }: PageProps<"/carton/[token]">) {
  const { token } = await params;

  if (!UUID_PATTERN.test(token)) {
    notFound();
  }

  // This public client intentionally has no cookie storage. The RPC must run
  // with the anon role even when the browser also has an admin session.
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await supabase.rpc("get_carton_publico", { p_token: token });

  if (error || !isPublicCredit(data)) {
    notFound();
  }

  const credit = data;
  const progress = credit.cantidad_cuotas > 0
    ? Math.min(100, Math.max(0, (credit.cuotas_pagadas / credit.cantidad_cuotas) * 100))
    : 0;


  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="bg-[var(--navy)] text-white">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-4 sm:px-8">
          <Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="hugella-logo w-[185px] sm:w-[220px]" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-[var(--hugella-gold-dark)]">Mi crédito</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hola, {credit.nombre_cliente}</h1><p className="mt-2 text-[var(--muted)]">Este es el estado actualizado de tu plan.</p></div>
          <div className="w-fit rounded-[var(--hugella-radius-sm)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] shadow-[0_1px_3px_rgb(6_31_53/0.06)] ring-1 ring-[var(--hugella-border)]">Crédito <span className="ml-1 font-mono">{credit.codigo_credito}</span></div>
        </section>

        <section className="credit-card relative overflow-hidden rounded-[var(--hugella-radius-card)] bg-[var(--hugella-navy)] p-6 text-white shadow-[0_3px_10px_rgb(6_31_53/0.08)] sm:p-9">
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <div className="mb-8 flex items-start justify-between gap-4"><div><p className="text-sm text-white/55">Producto</p><h2 className="mt-1 text-xl font-semibold sm:text-2xl">{credit.producto}</h2></div><CreditStatus status={credit.estado} /></div>
              <p className="text-sm text-white/55">Cuota diaria</p><p className="mt-1 text-4xl font-bold tracking-tight text-[var(--hugella-gold-light)] sm:text-5xl">{money.format(Number(credit.importe_cuota))}</p>
              <div className="mt-7"><div className="mb-2 flex justify-between text-sm"><span className="text-white/65">Progreso del plan</span><span className="font-semibold">{credit.cuotas_pagadas} de {credit.cantidad_cuotas} cuotas</span></div><div className="h-2 overflow-hidden rounded-[2px] bg-white/10"><div className="h-full rounded-[2px] bg-[linear-gradient(90deg,var(--hugella-gold-dark),var(--hugella-gold-light))]" style={{ width: `${progress}%` }} /></div></div>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-t border-white/10 pt-7 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-0">
              <div><p className="detail-label">Fecha de inicio</p><p className="detail-value">{formatDate(credit.fecha_inicio)}</p></div><div><p className="detail-label">Plan</p><p className="detail-value">{credit.cantidad_cuotas} cuotas</p></div><div><p className="detail-label">Cuotas pagadas</p><p className="detail-value text-[var(--hugella-gold-light)]">{credit.cuotas_pagadas}</p></div><div><p className="detail-label">Cuotas pendientes</p><p className="detail-value">{credit.cuotas_pendientes}</p></div>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-4"><p className="section-kicker">Movimientos</p><h2 className="text-2xl font-bold tracking-tight">Historial de pagos</h2></div>
          <div className="overflow-hidden rounded-[var(--hugella-radius-md)] border border-[var(--hugella-border)] bg-white shadow-[0_1px_4px_rgb(6_31_53/0.04)]">
            {credit.pagos.length > 0 ? <><div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-4 border-b border-[var(--hugella-navy-deep)] bg-[var(--hugella-navy)] px-6 py-3 text-xs font-bold uppercase tracking-wider text-white/75 sm:grid"><span>Aplicación</span><span>Fecha</span><span>Medio</span><span>Importe</span></div><div className="divide-y divide-[var(--hugella-border)]">{credit.pagos.map((payment, index) => <article key={`${payment.fecha_pago}-${index}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:px-6"><span className="hidden font-semibold sm:block">{payment.cuotas_aplicadas === 1 ? "1 cuota" : `${payment.cuotas_aplicadas} cuotas`}</span><span className="grid h-9 w-9 place-items-center rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)]/12 text-[var(--hugella-gold-dark)] sm:hidden"><CheckIcon /></span><div className="sm:contents"><div><p className="font-semibold sm:hidden">{payment.cuotas_aplicadas === 1 ? "1 cuota aplicada" : `${payment.cuotas_aplicadas} cuotas aplicadas`}</p><p className="text-sm text-[var(--muted)] sm:text-base">{formatDate(payment.fecha_pago)}</p></div><span className="hidden text-[var(--muted)] sm:block">{payment.medio_pago}</span></div><span className="font-bold tabular-nums text-[var(--hugella-navy)]">{money.format(Number(payment.importe))}</span></article>)}</div></> : <p className="px-6 py-10 text-center text-[var(--muted)]">Todavía no hay pagos registrados.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
