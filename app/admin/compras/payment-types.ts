import { subtotal, uuid, validDate, validatePurchase, type PurchaseInput } from './purchase-types';
export const paymentLabels = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TARJETA_DEBITO: 'Tarjeta de débito', TARJETA_CREDITO: 'Tarjeta de crédito' };
export type PaymentMedium = keyof typeof paymentLabels;
export type PaymentMode = PaymentMedium | 'COMBINADO';
export type PaymentDraft = { medio: PaymentMedium; importe: string; fecha: string; tarjeta: string; tarjetaNombre: string; cuotas: string; primero: string };
export type PaymentTranche = { posicion: number; medio: PaymentMedium; importe: number; fecha_pago: string | null; tarjeta_id: string | null; cantidad_cuotas: number | null; primer_periodo_id: string | null };
export type FinancedPurchaseInput = PurchaseInput & { p_tramos: PaymentTranche[] };
export const emptyPayment = (): PaymentDraft => ({ medio: 'EFECTIVO', importe: '', fecha: '', tarjeta: '', tarjetaNombre: '', cuotas: '1', primero: '' });
export function paymentCents(value: string): bigint | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}
export function centsNumber(cents: bigint): number | null {
  if (cents < BigInt(0)) return null;
  const number = Number(`${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`);
  return paymentCents(String(number)) === cents ? number : null;
}
export function installments(cents: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 1 || count > 1000 || BigInt(count) > cents) return [];
  return Array.from({ length: count }, (_, index) => cents / BigInt(count) + (BigInt(index) < cents % BigInt(count) ? BigInt(1) : BigInt(0)));
}
export function buildTranches(total: bigint, mode: PaymentMode, drafts: PaymentDraft[]): PaymentTranche[] | null {
  if (total === BigInt(0)) return [];
  if (!(Object.hasOwn(paymentLabels, mode)) && mode !== 'COMBINADO') return null;
  if (drafts.length < (mode === 'COMBINADO' ? 2 : 1) || drafts.length > 1000) return null;
  const result: PaymentTranche[] = [];
  for (const [index, draft] of (mode === 'COMBINADO' ? drafts : drafts.slice(0, 1)).entries()) {
    const medio = mode === 'COMBINADO' ? draft.medio : mode;
    const cents = mode === 'COMBINADO' ? paymentCents(draft.importe) : total;
    if (!(Object.hasOwn(paymentLabels, medio)) || cents === null || cents <= BigInt(0)) return null;
    const importe = centsNumber(cents); if (importe === null) return null;
    const credit = medio === 'TARJETA_CREDITO';
    const count = Number(draft.cuotas);
    if (credit ? (!uuid.test(draft.tarjeta) || !/^\d+$/.test(draft.cuotas) || installments(cents, count).length === 0 || (!!draft.primero && !uuid.test(draft.primero))) : !validDate(draft.fecha)) return null;
    result.push({ posicion: index + 1, medio, importe, fecha_pago: credit ? null : draft.fecha, tarjeta_id: credit ? draft.tarjeta : null, cantidad_cuotas: credit ? count : null, primer_periodo_id: credit ? draft.primero || null : null });
  }
  return result.reduce((sum, t) => sum + paymentCents(String(t.importe))!, BigInt(0)) === total ? result : null;
}
export function validateFinancedPurchase(value: unknown): value is FinancedPurchaseInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { p_tramos, ...purchase } = value as Record<string, unknown>;
  if (!validatePurchase(purchase) || !Array.isArray(p_tramos) || p_tramos.length > 1000) return false;
  const total = purchase.p_items.reduce((sum, i) => sum + subtotal(String(i.cantidad), String(i.costo_unitario))!, BigInt(0));
  if (total === BigInt(0)) return p_tramos.length === 0;
  let distributed = BigInt(0);
  for (const [index, t] of p_tramos.entries()) {
    if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).sort().join(',') !== 'cantidad_cuotas,fecha_pago,importe,medio,posicion,primer_periodo_id,tarjeta_id' || t.posicion !== index + 1 || !Object.hasOwn(paymentLabels, t.medio) || typeof t.importe !== 'number') return false;
    const cents = paymentCents(String(t.importe)); if (cents === null || cents <= BigInt(0)) return false;
    if (t.medio === 'TARJETA_CREDITO') {
      if (typeof t.tarjeta_id !== 'string' || !uuid.test(t.tarjeta_id) || t.fecha_pago !== null || !Number.isInteger(t.cantidad_cuotas) || installments(cents, t.cantidad_cuotas).length === 0 || (t.primer_periodo_id !== null && (typeof t.primer_periodo_id !== 'string' || !uuid.test(t.primer_periodo_id)))) return false;
    } else if (!validDate(t.fecha_pago) || t.tarjeta_id !== null || t.cantidad_cuotas !== null || t.primer_periodo_id !== null) return false;
    distributed += cents;
  }
  return distributed === total;
}
