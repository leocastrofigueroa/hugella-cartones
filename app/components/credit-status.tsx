// Presentation only. The backend owns all date, installment and status rules.
const styles: Record<string, string> = {
  ADELANTADO: "border-sky-300 bg-sky-100 text-sky-950",
  "AL DIA": "border-[var(--hugella-gold)] bg-[var(--hugella-gold-light)] text-[var(--hugella-navy-deep)]",
  ATRASADO: "border-red-300 bg-red-100 text-red-950",
  CANCELADO: "border-emerald-300 bg-emerald-100 text-emerald-950",
};

export default function CreditStatus({ status }: { status: string }) {
  return <span className={`inline-block max-w-full rounded-[var(--hugella-radius-sm)] border px-2.5 py-1.5 text-xs font-bold [overflow-wrap:anywhere] ${styles[status] ?? "border-slate-300 bg-slate-100 text-slate-950"}`}>{status}</span>;
}
