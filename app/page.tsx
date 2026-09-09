import Link from "next/link";
import Image from "next/image";

const payments = [
  { installment: "Cuotas 76 a 78", date: "07 sep 2026", method: "Transferencia", amount: "$ 15.000" },
  { installment: "Cuotas 74 y 75", date: "04 sep 2026", method: "Efectivo", amount: "$ 10.000" },
  { installment: "Cuota 73", date: "02 sep 2026", method: "Transferencia", amount: "$ 5.000" },
  { installment: "Cuotas 70 a 72", date: "31 ago 2026", method: "Efectivo", amount: "$ 15.000" },
];

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6" /></svg>;
}

export default function ClientPage() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="bg-[var(--navy)] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Hugella, inicio"><Image src="/hugella-logo.png" alt="HUGELLA Equipamiento Comercial" width={2172} height={724} priority className="hugella-logo w-[185px] sm:w-[220px]" /></Link>
          <Link href="/admin" className="rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-gold)]/40 px-4 py-2 text-sm font-semibold text-[var(--hugella-gold-light)] transition hover:border-[var(--hugella-gold)]">Vista admin</Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <section className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-[var(--hugella-gold-dark)]">Mi crédito</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hola, María Fernanda</h1><p className="mt-2 text-[var(--muted)]">Este es el estado actualizado de tu plan.</p></div>
          <div className="w-fit rounded-[var(--hugella-radius-sm)] bg-white px-4 py-2 text-sm font-semibold text-[var(--navy)] shadow-[0_1px_3px_rgb(6_31_53/0.06)] ring-1 ring-[var(--hugella-border)]">Crédito <span className="ml-1 font-mono">HG-2026-0842</span></div>
        </section>

        <section className="credit-card relative overflow-hidden rounded-[var(--hugella-radius-card)] bg-[var(--hugella-navy)] p-6 text-white shadow-[0_3px_10px_rgb(6_31_53/0.08)] sm:p-9">
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <div className="mb-8 flex items-start justify-between gap-4"><div><p className="text-sm text-white/55">Producto</p><h2 className="mt-1 text-xl font-semibold sm:text-2xl">Heladera No Frost 340 L</h2></div><span className="rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)] px-3 py-1.5 text-sm font-bold uppercase text-[var(--hugella-navy-deep)] ring-1 ring-[var(--hugella-gold-light)]">Al día</span></div>
              <p className="text-sm text-white/55">Cuota diaria</p><p className="mt-1 text-4xl font-bold tracking-tight text-[var(--hugella-gold-light)] sm:text-5xl">$ 5.000</p>
              <div className="mt-7"><div className="mb-2 flex justify-between text-sm"><span className="text-white/65">Progreso del plan</span><span className="font-semibold">78 de 120 cuotas</span></div><div className="h-2 overflow-hidden rounded-[2px] bg-white/10"><div className="h-full w-[65%] rounded-[2px] bg-[linear-gradient(90deg,var(--hugella-gold-dark),var(--hugella-gold-light))]" /></div></div>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-t border-white/10 pt-7 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-0">
              <div><p className="detail-label">Fecha de inicio</p><p className="detail-value">23 jun 2026</p></div><div><p className="detail-label">Plan diario</p><p className="detail-value">120 cuotas</p></div><div><p className="detail-label">Importe por cuota</p><p className="detail-value">$ 5.000</p></div><div><p className="detail-label">Estado</p><p className="detail-value text-[var(--hugella-gold-light)]">AL DÍA</p></div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4">
          <article className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 shadow-[0_1px_4px_rgb(6_31_53/0.04)] sm:p-6"><p className="text-sm font-medium text-[var(--muted)]">Cuotas pagadas</p><div className="mt-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)]/12 text-[var(--hugella-gold-dark)]"><CheckIcon /></span><strong className="text-3xl text-[var(--hugella-gold-dark)]">78</strong></div></article>
          <article className="rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 shadow-[0_1px_4px_rgb(6_31_53/0.04)] sm:p-6"><p className="text-sm font-medium text-[var(--muted)]">Cuotas pendientes</p><div className="mt-3 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[var(--hugella-radius-sm)] bg-slate-100 font-bold text-[var(--navy)]">—</span><strong className="text-3xl">42</strong></div></article>
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between"><div><p className="section-kicker">Movimientos</p><h2 className="text-2xl font-bold tracking-tight">Historial de pagos</h2></div><span className="hidden text-sm text-[var(--muted)] sm:block">Última actualización: hoy, 10:32</span></div>
          <div className="overflow-hidden rounded-[var(--hugella-radius-md)] border border-[var(--hugella-border)] bg-white shadow-[0_1px_4px_rgb(6_31_53/0.04)]">
            <div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-4 border-b border-[var(--hugella-navy-deep)] bg-[var(--hugella-navy)] px-6 py-3 text-xs font-bold uppercase tracking-wider text-white/75 sm:grid"><span>Cuota</span><span>Fecha</span><span>Medio</span><span>Importe</span></div>
            <div className="divide-y divide-[var(--hugella-border)]">{payments.map((payment) => <article key={payment.installment} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:px-6"><span className="hidden font-semibold sm:block">{payment.installment}</span><span className="grid h-9 w-9 place-items-center rounded-[var(--hugella-radius-sm)] bg-[var(--hugella-gold)]/12 text-[var(--hugella-gold-dark)] sm:hidden"><CheckIcon /></span><div className="sm:contents"><div><p className="font-semibold sm:hidden">{payment.installment}</p><p className="text-sm text-[var(--muted)] sm:text-base">{payment.date}</p></div><span className="hidden text-[var(--muted)] sm:block">{payment.method}</span></div><span className="font-bold tabular-nums">{payment.amount}</span></article>)}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
