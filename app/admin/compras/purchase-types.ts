export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Supplier = { id: string; nombre: string; identificacion_fiscal: string | null; contacto: string | null; observaciones: string | null };
export type Item = { posicion: number; descripcion: string; cantidad: number; costo_unitario: number };
export type PurchaseInput = { p_operacion_id: string; p_tipo: 'MERCADERIA' | 'GASTO'; p_proveedor_id: string; p_fecha: string; p_moneda: 'ARS'; p_comprobante: string | null; p_observaciones: string | null; p_items: Item[] };
export type SupplierInput = { p_operacion_id: string; p_nombre: string; p_identificacion_fiscal: string | null; p_contacto: string | null; p_observaciones: string | null };
export type PurchaseRow = { id: string; tipo: 'MERCADERIA' | 'GASTO'; fecha: string; proveedor_nombre: string; moneda: string; comprobante: string | null; total: number; cantidad_items: number; created_at: string };
export type PurchaseDetail = Omit<PurchaseRow, 'proveedor_nombre'> & { proveedor: Supplier; observaciones: string | null; items: (Item & { id: string; total: number })[] };
export const inputStyle = 'mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
export const buttonStyle = 'min-h-12 rounded-lg bg-[var(--hugella-navy)] px-5 py-3 font-semibold text-white disabled:opacity-50';
export const cardStyle = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';

// Seis decimales, sin coma de miles; aritmética exacta para la previsualización.
export function scaled(value: string): bigint | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(normalized)) return null;
  const [integer, fraction = ''] = normalized.split('.');
  const result = BigInt(integer) * BigInt("1000000") + BigInt(fraction.padEnd(6, '0'));
  return result < BigInt("1000000000000000000") ? result : null;
}
export function decimalNumber(value: string, positive: boolean): number | null {
  const exact = scaled(value);
  if (exact === null || (positive && exact === BigInt("0"))) return null;
  const number = Number(value.trim().replace(',', '.'));
  return scaled(String(number)) === exact ? number : null;
}
export function subtotal(quantity: string, cost: string): bigint | null {
  const q = scaled(quantity), c = scaled(cost);
  if (q === null || c === null) return null;
  return (q * c + BigInt("5000000000")) / BigInt("10000000000");
}
export function displayCents(cents: bigint): string {
  return `${(cents / BigInt("100")).toLocaleString('es-AR')},${String(cents % BigInt("100")).padStart(2, '0')}`;
}
export function money(value: number | string, currency: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(Number(value));
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key)); }
function optional(value: unknown) { return value === null || typeof value === 'string'; }
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateSupplier(value: unknown): value is SupplierInput {
  return object(value) && keys(value, ['p_operacion_id','p_nombre','p_identificacion_fiscal','p_contacto','p_observaciones']) && typeof value.p_operacion_id === 'string' && uuid.test(value.p_operacion_id) && typeof value.p_nombre === 'string' && !!value.p_nombre.trim() && optional(value.p_identificacion_fiscal) && optional(value.p_contacto) && optional(value.p_observaciones);
}
export function validatePurchase(value: unknown): value is PurchaseInput {
  if (!object(value) || !keys(value, ['p_operacion_id','p_tipo','p_proveedor_id','p_fecha','p_moneda','p_comprobante','p_observaciones','p_items']) || typeof value.p_operacion_id !== 'string' || !uuid.test(value.p_operacion_id) || (value.p_tipo !== 'MERCADERIA' && value.p_tipo !== 'GASTO') || typeof value.p_proveedor_id !== 'string' || !uuid.test(value.p_proveedor_id) || !validDate(value.p_fecha) || value.p_moneda !== 'ARS' || !optional(value.p_comprobante) || !optional(value.p_observaciones) || !Array.isArray(value.p_items) || value.p_items.length < 1 || value.p_items.length > 1000) return false;
  return value.p_items.every((item, index) => object(item) && keys(item, ['posicion','descripcion','cantidad','costo_unitario']) && item.posicion === index + 1 && typeof item.descripcion === 'string' && !!item.descripcion.trim() && typeof item.cantidad === 'number' && decimalNumber(String(item.cantidad), true) !== null && typeof item.costo_unitario === 'number' && decimalNumber(String(item.costo_unitario), false) !== null && (subtotal(String(item.cantidad), String(item.costo_unitario)) ?? BigInt("1000000000000000000")) <= BigInt("999999999999999999"));
}
