'use client';
import { useEffect, useState } from 'react';
import { displayCents, inputStyle, secondaryButtonInteractionStyle } from './purchase-types';
import { emptyPayment, installments, paymentCents, paymentLabels, type PaymentDraft, type PaymentMedium, type PaymentMode } from './payment-types';
type Card = { id: string; nombre: string; entidad: string; activo: boolean };
type Period = { id: string; orden: number; fecha_cierre: string; fecha_vencimiento: string };
export default function PaymentFields({ total, mode, drafts, onMode, onChange }: { total: bigint; mode: PaymentMode; drafts: PaymentDraft[]; onMode: (mode: PaymentMode) => void; onChange: (drafts: PaymentDraft[]) => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periods, setPeriods] = useState<Record<string, Period[]>>({});
  const [periodErrors, setPeriodErrors] = useState<Record<string, string>>({});
  const [periodBusy, setPeriodBusy] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/admin/compras/tarjetas', { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.result)) throw new Error('No se pudieron consultar las tarjetas.');
        if (!cancelled) setCards(body.result.filter((card: Card) => card.activo));
      } catch { if (!cancelled) setError('No se pudieron consultar las tarjetas. Volvé a abrir esta pantalla para reintentar.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  async function loadPeriods(card: string, offset = 0) {
    if (!card || periodBusy[card]) return;
    setPeriodBusy(old => ({ ...old, [card]: true }));
    try {
      const response = await fetch(`/api/admin/compras/periodos?tarjeta_id=${encodeURIComponent(card)}&offset=${offset}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok || !Array.isArray(body.result)) throw new Error();
      setPeriods(old => ({ ...old, [card]: offset ? [...(old[card] || []), ...body.result] : body.result }));
      setPeriodErrors(old => ({ ...old, [card]: '' }));
    } catch { setPeriodErrors(old => ({ ...old, [card]: 'No se pudieron consultar períodos. Podés reintentar o dejar el primer período sin asignar.' })); }
    finally { setPeriodBusy(old => ({ ...old, [card]: false })); }
  }
  const change = (index: number, values: Partial<PaymentDraft>) => onChange(drafts.map((draft, i) => i === index ? { ...draft, ...values } : draft));
  const distributed = mode === 'COMBINADO' ? drafts.reduce((sum, draft) => sum + (paymentCents(draft.importe) ?? BigInt(0)), BigInt(0)) : total;
  return <section className="space-y-4" aria-label="Forma de pago">
    <h2 className="text-xl font-semibold">Forma de pago</h2>
    {total === BigInt(0) ? <p>El total es cero: no requiere distribución de pago. No se registrarán tramos ni pagos.</p> : <>
      <label className="block">Forma de pago<select name="forma-pago" className={inputStyle} value={mode} onChange={event => {
        const next = event.target.value as PaymentMode; onMode(next);
        onChange(next === 'COMBINADO' ? drafts.length >= 2 ? drafts : [drafts[0], emptyPayment()] : [drafts[0]]);
      }}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="COMBINADO">Combinado</option></select></label>
      {(mode === 'COMBINADO' ? drafts : drafts.slice(0, 1)).map((draft, index) => {
        const medio = mode === 'COMBINADO' ? draft.medio : mode;
        const cents = mode === 'COMBINADO' ? paymentCents(draft.importe) : total;
        const preview = cents === null ? [] : installments(cents, Number(draft.cuotas));
        return <section key={index} className="space-y-3 rounded-lg border p-4">
          {mode === 'COMBINADO' && <><h3 className="font-semibold">Tramo {index + 1}</h3><label className="block">Medio<select name={`medio-${index}`} className={inputStyle} value={draft.medio} onChange={event => change(index, { medio: event.target.value as PaymentMedium })}>{Object.entries(paymentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block">Importe (ARS)<input name={`importe-${index}`} inputMode="decimal" className={inputStyle} value={draft.importe} onChange={event => change(index, { importe: event.target.value })}/></label></>}
          {mode !== 'COMBINADO' && <p>Importe: <strong>{displayCents(total)} ARS</strong> (total de la compra)</p>}
          {medio !== 'TARJETA_CREDITO' ? <label className="block">Fecha de pago<input name={`fecha-pago-${index}`} type="date" className={inputStyle} value={draft.fecha} onChange={event => change(index, { fecha: event.target.value })}/></label> : <>
            {loading ? <p role="status">Consultando tarjetas…</p> : error ? <p role="alert">{error}</p> : cards.length === 0 ? <p role="status">No hay tarjetas de crédito configuradas.</p> : null}
            <label className="block">Tarjeta<select name={`tarjeta-${index}`} className={inputStyle} value={draft.tarjeta} disabled={loading || cards.length === 0} onChange={event => {
              const card = cards.find(card => card.id === event.target.value);
              change(index, { tarjeta: card?.id || '', tarjetaNombre: card ? `${card.nombre} · ${card.entidad}` : '', primero: '' });
              if (card && !periods[card.id]) void loadPeriods(card.id);
            }}><option value="">Seleccionar tarjeta</option>{cards.map(card => <option key={card.id} value={card.id}>{card.nombre} · {card.entidad}</option>)}</select></label>
            <label className="block">Cantidad de cuotas<input name={`cuotas-${index}`} type="number" min="1" max="1000" step="1" className={inputStyle} value={draft.cuotas} onChange={event => change(index, { cuotas: event.target.value })}/></label>
            <label className="block">Primer período (opcional)<select name={`periodo-${index}`} className={inputStyle} disabled={!draft.tarjeta || periodBusy[draft.tarjeta]} value={draft.primero} onChange={event => change(index, { primero: event.target.value })}><option value="">Sin asignar</option>{(periods[draft.tarjeta] || []).map(period => <option key={period.id} value={period.id}>Cierre {period.fecha_cierre} · Vence {period.fecha_vencimiento}</option>)}</select></label>
            {draft.tarjeta && <><p>No se inventan fechas: las cuotas sin período quedan pendientes de asignación.</p>{periodBusy[draft.tarjeta] && <p role="status">Consultando períodos…</p>}{periodErrors[draft.tarjeta] && <p role="alert">{periodErrors[draft.tarjeta]}</p>}{(periodErrors[draft.tarjeta] || (periods[draft.tarjeta]?.length ?? 0) >= 100) && <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4`} disabled={periodBusy[draft.tarjeta]} onClick={() => void loadPeriods(draft.tarjeta, periodErrors[draft.tarjeta] ? 0 : periods[draft.tarjeta].length)}>Consultar períodos</button>}</>}
            {preview.length > 0 && <details><summary className="min-h-12 cursor-pointer py-3">Vista previa de {preview.length} cuotas</summary><ol className="max-h-48 overflow-y-auto">{preview.map((amount, i) => <li key={i}>{i + 1}: {displayCents(amount)} ARS</li>)}</ol><p>El reparto definitivo lo calcula Supabase.</p></details>}
          </>}
          {mode === 'COMBINADO' && <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4`} disabled={drafts.length <= 2} onClick={() => onChange(drafts.filter((_, i) => i !== index))}>Quitar tramo</button>}
        </section>;
      })}
      {mode === 'COMBINADO' && <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4`} disabled={drafts.length >= 1000} onClick={() => onChange([...drafts, emptyPayment()])}>+ Agregar tramo</button>}
      <div aria-live="polite" className="rounded-lg bg-slate-50 p-4"><p>Total compra: {displayCents(total)} ARS</p><p>Total distribuido: {displayCents(distributed)} ARS</p><p>{distributed > total ? `Exceso distribuido: ${displayCents(distributed - total)}` : `Falta distribuir: ${displayCents(total - distributed)}`} ARS</p></div>
    </>}
  </section>;
}
