'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { secondaryButtonInteractionStyle, cardStyle, money, type PurchaseDetail, type PurchaseRow } from './purchase-types';
import ReceiptFiles from './receipt-files';
export default function PurchasesView({ id }: { id?: string }) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const response = await fetch(id ? `/api/admin/compras/${encodeURIComponent(id)}` : `/api/admin/compras?offset=${offset}`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo consultar.');
        if (active) { if (id) setDetail(body.result); else setRows(body.result); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar.'); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [id, offset]);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">{id ? 'Detalle de compra / gasto' : 'Compras y gastos'}</h1><Link className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4 py-3`} href={id ? '/admin/compras' : '/admin/compras/nueva'}>{id ? 'Volver al listado' : 'Nueva compra / gasto'}</Link></div>
    {loading && <p role="status">Cargando…</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && !id && <>
      {rows.length === 0 && <p>No hay compras ni gastos registrados en esta página.</p>}
      <div className="grid gap-4 md:grid-cols-2">{rows.map(row => <Link key={row.id} className={`${cardStyle} block`} href={`/admin/compras/${row.id}`}><p className="font-semibold">{row.tipo === 'MERCADERIA' ? 'Mercadería' : 'Gasto'} · {row.fecha}</p><p>{row.proveedor_nombre}</p><p className="mt-2 text-xl font-bold">{money(row.total, row.moneda)} <span className="text-sm">{row.moneda}</span></p>{row.comprobante && <p>Comprobante: {row.comprobante}</p>}<span className="mt-3 inline-block underline">Ver detalle</span></Link>)}</div>
      <div className="flex gap-3"><button className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4 disabled:opacity-50`} disabled={offset === 0} onClick={() => setOffset(offset - 50)}>Anterior</button><button className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4 disabled:opacity-50`} disabled={rows.length < 50} onClick={() => setOffset(offset + 50)}>Siguiente</button></div>
    </>}
    {!loading && !error && detail && <div className="space-y-5">
      <section className={cardStyle}><p className="text-sm">Registro confirmado</p><h2 className="text-xl font-bold">{detail.tipo === 'MERCADERIA' ? 'Mercadería' : 'Gasto'} · {detail.fecha}</h2><p>Proveedor: {detail.proveedor.nombre}</p>{detail.proveedor.identificacion_fiscal && <p>Identificación fiscal: {detail.proveedor.identificacion_fiscal}</p>}<p>Moneda: {detail.moneda}</p><p>Comprobante: {detail.comprobante || '—'}</p><p className="whitespace-pre-wrap">Observaciones: {detail.observaciones || '—'}</p><p>Registrado: {new Date(detail.created_at).toLocaleString('es-AR')}</p></section>
      <section className="space-y-3"><h2 className="text-xl font-semibold">Ítems</h2>{detail.items.map(item => <article className={cardStyle} key={item.id}><h3 className="font-semibold">{item.posicion}. {item.descripcion}</h3><p>Cantidad: {item.cantidad}</p><p>Costo unitario: {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(item.costo_unitario)} {detail.moneda}</p><p className="font-bold">Total: {money(item.total, detail.moneda)}</p></article>)}</section>
      <p className="text-2xl font-bold">TOTAL GENERAL: {money(detail.total, detail.moneda)} · {detail.moneda}</p>
      <ReceiptFiles key={detail.id} purchaseId={detail.id}/>
    </div>}
  </>;
}
