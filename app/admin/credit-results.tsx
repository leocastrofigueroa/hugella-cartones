import CreditStatus from "../components/credit-status";
import { focusStyle, type Credit } from "./admin-types";

type Props = {
  credits: Credit[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (credit: Credit) => void;
};

export default function CreditResults({ credits, selectedId, disabled, onSelect }: Props) {
  return (
    <section aria-labelledby="results-title" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="results-title" className="text-lg font-bold">Resultados de búsqueda</h2>
        <span className="text-sm text-[var(--hugella-navy-secondary)]">{credits.length} crédito{credits.length === 1 ? "" : "s"}</span>
      </div>
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 rounded-t-[var(--hugella-radius-sm)] bg-[var(--hugella-navy)] px-5 py-3 text-xs font-bold uppercase tracking-wide text-white md:grid">
        <span>Cliente</span><span>Producto</span><span>Código</span><span>Estado</span>
      </div>
      <ul className="space-y-3 md:space-y-0">
        {credits.map((credit) => {
          const active = selectedId === credit.credito_id;
          return (
            <li key={credit.credito_id}>
              <button type="button" disabled={disabled} aria-pressed={active} onClick={() => onSelect(credit)} className={`grid w-full min-w-0 grid-cols-1 gap-3 rounded-[var(--hugella-radius-sm)] border border-l-4 p-4 text-left transition md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4 md:rounded-none md:px-5 disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle} ${active ? "border-[var(--hugella-gold)] bg-[var(--hugella-gold)]/10" : "border-[var(--hugella-border)] bg-white hover:border-l-[var(--hugella-gold)] hover:bg-slate-50"}`}>
                <span className="min-w-0 [overflow-wrap:anywhere]"><strong className="block">{credit.nombre_cliente}</strong>{active && <span className="mt-1 block text-xs font-semibold">✓ Seleccionado</span>}</span>
                <span className="min-w-0 text-sm [overflow-wrap:anywhere]"><span className="mb-1 block text-xs text-[var(--hugella-navy-secondary)] md:sr-only">Producto</span>{credit.producto}</span>
                <span className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]"><span className="mb-1 block font-sans text-xs text-[var(--hugella-navy-secondary)] md:sr-only">Código</span>{credit.codigo_credito}</span>
                <span className="min-w-0"><CreditStatus status={credit.estado} /></span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
