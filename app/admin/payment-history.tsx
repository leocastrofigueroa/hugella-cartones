import { money, type PaymentHistoryItem } from "./admin-types";

type Props = {
  status: "idle" | "loading" | "success" | "error";
  payments: PaymentHistoryItem[];
  error: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export default function PaymentHistory({ status, payments, error }: Props) {
  return (
    <section aria-labelledby="payment-history-title" className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="section-kicker">Movimientos</p><h2 id="payment-history-title" className="text-xl font-bold">Historial de pagos</h2></div>{status === "success" && payments.length > 0 && <span className="text-sm text-[var(--hugella-navy-secondary)]">{payments.length} registro{payments.length === 1 ? "" : "s"}</span>}</div>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-5">
        {status === "loading" && <p className="text-sm text-[var(--hugella-navy-secondary)]">Consultando historial...</p>}
        {status === "error" && <p className="rounded-[var(--hugella-radius-sm)] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {status === "success" && payments.length === 0 && <p className="text-sm text-[var(--hugella-navy-secondary)]">No hay pagos registrados.</p>}
      </div>
      {status === "success" && payments.length > 0 && <ul className="mt-5 space-y-3">{payments.map((payment) => <li key={payment.pago_id} className="min-w-0 rounded-[var(--hugella-radius-sm)] border border-[var(--hugella-border)] p-4 transition hover:border-[var(--hugella-gold)]"><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold text-[var(--hugella-navy)]">{formatDate(payment.fecha_pago)}</p><p className="mt-1 break-words text-2xl font-bold text-[var(--hugella-navy)]">{money.format(Number(payment.importe))}</p></div>{payment.origen && <span className={`shrink-0 rounded-[var(--hugella-radius-sm)] border px-2 py-1 text-[0.68rem] font-bold uppercase tracking-wide ${payment.origen.toUpperCase() === "ADMIN" ? "border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10 text-[var(--hugella-navy)]" : "border-slate-300 bg-slate-100 text-slate-700"}`}>{payment.origen}</span>}</div><dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--hugella-border)] pt-4 text-sm"><div className="min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Cuotas aplicadas</dt><dd className="mt-1 font-bold">{payment.cuotas_aplicadas}</dd></div><div className="min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Medio de pago</dt><dd className="mt-1 break-words font-semibold">{payment.medio_pago}</dd></div>{payment.observaciones && <div className="col-span-2 min-w-0"><dt className="text-[var(--hugella-navy-secondary)]">Observaciones</dt><dd className="mt-1 break-words">{payment.observaciones}</dd></div>}</dl></li>)}</ul>}
    </section>
  );
}
