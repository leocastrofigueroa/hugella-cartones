import { useEffect, useId, useState, type ReactNode } from "react";
import { createClient } from "@/utils/supabase/client";
import CreditStatus from "../components/credit-status";
import { focusStyle, isCreditFicha, money, type CreditFicha } from "./admin-types";

const date = (value: string) => value.split("-").reverse().join("/");
const amount = (value: number | null) => value === null ? "Sin informar" : money.format(value);
const decimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

function Location({ value }: { value: string | null }) {
  if (value === null) return <>Sin informar</>;
  let href: string | null = null;
  try {
    const url = new URL(value);
    if (/^https?:\/\//i.test(value) && ["http:", "https:"].includes(url.protocol)) {
      href = url.href;
    }
  } catch { /* Plain references remain text. */ }
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={`underline ${focusStyle}`}>{value}</a>;
  return <>{value}</>;
}

function Group({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return <section className="min-w-0 rounded-lg border border-[var(--hugella-border)] p-4">
    <h3 className="text-lg font-bold">{title}</h3>
    <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-[var(--hugella-navy-secondary)]">{label}</dt><dd className="mt-1 font-semibold [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
  </section>;
}

export default function CreditFullDetail({ creditId, refreshVersion }: { creditId: string; refreshVersion: number }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ creditId: string; version: number; retry: number; ficha?: CreditFicha; error?: string } | null>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    let current = true;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc("obtener_ficha_credito_admin", { p_credito_id: creditId });
        if (error || !isCreditFicha(data, creditId)) throw new Error("Invalid ficha");
        if (current) setResult({ creditId, version: refreshVersion, retry, ficha: data });
      } catch {
        if (current) setResult({ creditId, version: refreshVersion, retry, error: "No se pudo consultar la ficha completa. Revisá tu sesión y permisos, e intentá nuevamente." });
      }
    })();
    return () => { current = false; };
  }, [open, creditId, refreshVersion, retry]);
  const current = result?.creditId === creditId && result.version === refreshVersion && result.retry === retry ? result : null;
  const f = current?.ficha;
  const closed = f?.tipo_cierre !== null && f?.tipo_cierre !== undefined;
  return <section className="min-w-0 rounded-[var(--hugella-radius-card)] border border-[var(--hugella-border)] bg-white">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => { setResult(null); setOpen(value => !value); }} className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--hugella-radius-card)] px-4 py-3 text-left font-bold text-[var(--hugella-navy)] transition hover:bg-slate-50 sm:px-5 ${focusStyle}`}>
      <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="shrink-0">📋</span><span className="min-w-0 [overflow-wrap:anywhere]">{open ? "Ficha completa del crédito" : "Ver ficha completa del crédito"}</span></span>
      <span aria-hidden="true" className="shrink-0">{open ? "▲" : "▼"}</span>
    </button>
    <div id={panelId} hidden={!open} className="min-w-0 border-t border-[var(--hugella-border)] p-4 sm:p-5">
      {open && !current && <p role="status">Consultando ficha completa…</p>}
      {open && current?.error && <div><p role="alert">{current.error} Si acabás de confirmar una operación, este error solo corresponde a la consulta.</p><button type="button" onClick={() => setRetry(value => value + 1)} className={`mt-3 min-h-12 underline ${focusStyle}`}>Reintentar consulta</button></div>}
      {open && f && <div className="min-w-0 space-y-5">
        <header className="min-w-0 space-y-2 [overflow-wrap:anywhere]"><h2 className="text-2xl font-bold">{f.codigo} · {f.producto}</h2><p>Origen: {f.origen}</p><CreditStatus status={f.tipo_cierre ?? f.estado} /><p className="text-sm">Fecha de evaluación: {date(f.fecha_evaluacion)}</p></header>
        {closed && <section className="rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold">Cierre: {f.tipo_cierre}</h3><p>Fecha de cierre: {f.fecha_cierre ? date(f.fecha_cierre) : "Sin informar"}</p><p>Sin cobranza futura. Los cálculos mostrados son históricos y corresponden al plan original.</p></section>}
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <Group title="Cliente" rows={[["Nombre", f.nombre], ["DNI", f.dni], ["Teléfono", f.telefono ?? "Sin informar"], ["Domicilio", f.domicilio ?? "Sin informar"], ["Ubicación", <Location key="location" value={f.ubicacion} />]]} />
          <Group title="Crédito / plan" rows={[["Fecha de entrega", date(f.fecha_inicio)], ["Cantidad de cuotas", f.cantidad_cuotas], ["Importe de cuota", amount(f.importe_cuota)], ["Total contractual", amount(f.total_contractual)], ["Fecha prevista de cancelación", date(f.fecha_fin_prevista)]]} />
          <Group title="Economía" rows={[["Inversión", amount(f.inversion)], ["Ganancia prevista", amount(f.ganancia_prevista)], ["Cuota aproximada de recuperación de inversión", f.cuota_recuperacion_inversion ?? "Sin informar"]]} />
          <Group title="Pagos y saldos" rows={[["Total pagado válido", amount(f.total_pagado_valido)], ["Cuotas completas pagadas", f.cuotas_completas_pagadas], ["Remanente actual", amount(f.remanente_actual)], ["Cuotas equivalentes monetarias (incluyen parciales)", decimal.format(f.cuotas_equivalentes_monetarias)], ["Cuotas del plan no pagadas", f.cuotas_plan_no_pagadas], ["Saldo por cuotas completas", amount(f.saldo_por_cuotas_completas)], ["Saldo monetario real", amount(f.saldo_monetario_real)]]} />
          <Group title="Situación actual" rows={[["Cuotas exigibles", f.cuotas_exigibles], ["Diferencia de cuotas (pagadas − exigibles)", f.diferencia_cuotas], ["Cuotas atrasadas", f.cuotas_atrasadas], ["Importe atrasado", amount(f.importe_atrasado)]]} />
        </div>
      </div>}
    </div>
  </section>;
}
