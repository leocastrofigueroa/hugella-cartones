import CreditStatus from "../components/credit-status";
import { money, isClosedCredit, type Credit } from "./admin-types";

export default function CreditDetail({ credit }: { credit: Credit }) {
  const showInstallmentStatus = ["ATRASADO", "ADELANTADO", "AL DIA"].includes(credit.estado) && Number.isFinite(credit.diferencia_cuotas);
  return (
    <section aria-labelledby="credit-title" className="min-w-0 rounded-[var(--hugella-radius-card)] border-t-4 border-[var(--hugella-gold)] bg-[var(--hugella-navy)] p-5 text-white sm:p-7">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--hugella-gold-light)]">Crédito seleccionado</p>
      <h2 id="credit-title" className="mt-3 text-2xl font-bold [overflow-wrap:anywhere]">{credit.nombre_cliente}</h2>
      <p className="mt-2 font-mono text-sm text-white/80 [overflow-wrap:anywhere]">{credit.codigo_credito}</p>
      <div className="mt-4"><CreditStatus status={credit.estado} /></div>
      <dl className="mt-6 grid grid-cols-2 gap-5 border-t border-white/20 pt-6">
        <div className="col-span-2 min-w-0"><dt className="text-sm text-white/75">Producto</dt><dd className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{credit.producto}</dd></div>
        <div className="col-span-2 min-w-0"><dt className="text-sm text-white/75">Importe de cuota</dt><dd className="mt-1 text-3xl font-bold text-[var(--hugella-gold-light)] [overflow-wrap:anywhere]">{money.format(Number(credit.importe_cuota))}</dd></div>
        <div><dt className="text-sm text-white/75">Cuotas totales</dt><dd className="mt-1 text-2xl font-bold">{credit.cantidad_cuotas}</dd></div>
        <div><dt className="text-sm text-white/75">Cuotas pagadas</dt><dd className="mt-1 text-2xl font-bold text-[var(--hugella-gold-light)]">{credit.cuotas_pagadas}</dd></div>
        <div className={showInstallmentStatus ? "min-w-0" : "col-span-2"}><dt className="text-sm text-white/75">Cuotas pendientes de cobro</dt><dd className="mt-1 text-2xl font-bold">{credit.cuotas_pendientes}</dd></div>
        {showInstallmentStatus && (
          <div className="col-start-2 min-w-0">
            <dt className="text-sm text-white/75">{credit.estado === "ATRASADO" ? "Cuotas atrasadas" : credit.estado === "ADELANTADO" ? "Cuotas adelantadas" : "Estado de cuotas"}</dt>
            <dd className="mt-1 text-2xl font-bold">{credit.estado === "AL DIA" ? "AL DÍA" : Math.abs(credit.diferencia_cuotas)}</dd>
          </div>
        )}
        {isClosedCredit(credit) && <div className="col-span-2"><dt className="text-sm text-white/75">Cuotas del plan original no pagadas (sin cobranza futura)</dt><dd className="mt-1 text-2xl font-bold">{Math.max(0, credit.cantidad_cuotas - credit.cuotas_pagadas)}</dd></div>}
      </dl>
    </section>
  );
}
