'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { secondaryButtonInteractionStyle, buttonStyle, cardStyle, decimalNumber, displayCents, inputStyle, money, subtotal, validatePurchase, type PurchaseDetail, type PurchaseInput, type Supplier, type SupplierInput } from './purchase-types';
import ReceiptFiles, { AttachmentPicker, type Attachment } from './receipt-files';
type DraftItem = { descripcion: string; cantidad: string; costo: string };
type Intent = { request: PurchaseInput; supplier: Supplier; cents: bigint };
const emptyItem = (): DraftItem => ({ descripcion: '', cantidad: '1', costo: '' });
const optional = (value: string) => value.trim() || null;
export default function NewPurchaseForm() {
  const [tipo, setTipo] = useState<'MERCADERIA' | 'GASTO'>('MERCADERIA');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [query, setQuery] = useState(''); const [options, setOptions] = useState<Supplier[]>([]);
  const [supplierOffset, setSupplierOffset] = useState(0);
  const [fecha, setFecha] = useState(''); const [comprobante, setComprobante] = useState(''); const [observaciones, setObservaciones] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [showSupplier, setShowSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ nombre: '', fiscal: '', contacto: '', observaciones: '' });
  const [supplierIntent, setSupplierIntent] = useState<SupplierInput | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [result, setResult] = useState<PurchaseDetail | null>(null);
  const [attachmentsBusy,setAttachmentsBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const lock = useRef(false);
  const hasResult = useRef(false);
  useEffect(() => {
    if ((!sent || result) && !supplierIntent) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sent, result, supplierIntent]);
  const total = items.reduce((sum, item) => sum + (subtotal(item.cantidad, item.costo) ?? BigInt("0")), BigInt("0"));
  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const responseBody = await response.json();
    if (!response.ok) throw new Error(responseBody.error || 'No se pudo confirmar. Reintentá la misma solicitud.');
    return responseBody.result;
  }
  async function searchSuppliers(offset = 0) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/proveedores?q=${encodeURIComponent(query)}&offset=${offset}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setOptions(body.result); setSupplierOffset(offset);
    } catch { setError('No se pudo buscar proveedores.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function createSupplier(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    if (!supplierDraft.nombre.trim() && !supplierIntent) { setError('Ingresá el nombre del proveedor.'); return; }
    const request = supplierIntent ?? { p_operacion_id: crypto.randomUUID(), p_nombre: supplierDraft.nombre.trim(), p_identificacion_fiscal: optional(supplierDraft.fiscal), p_contacto: optional(supplierDraft.contacto), p_observaciones: optional(supplierDraft.observaciones) };
    setSupplierIntent(request); lock.current = true; setBusy(true); setError('');
    try { const created = await post('/api/admin/proveedores', request); setSupplier(created); setShowSupplier(false); setSupplierIntent(null); setSupplierDraft({ nombre: '', fiscal: '', contacto: '', observaciones: '' }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el proveedor.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function review(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    setError('');
    if (!supplier) { setError('Seleccioná un proveedor.'); return; }
    if (supplierIntent) { setError('Resolvé primero el intento de alta del proveedor.'); return; }
    const parsed = items.map((item, index) => ({ posicion: index + 1, descripcion: item.descripcion.trim(), cantidad: decimalNumber(item.cantidad, true), costo_unitario: decimalNumber(item.costo, false) }));
    const request = { p_operacion_id: crypto.randomUUID(), p_tipo: tipo, p_proveedor_id: supplier.id, p_fecha: fecha, p_moneda: 'ARS', p_comprobante: optional(comprobante), p_observaciones: optional(observaciones), p_items: parsed };
    if (!validatePurchase(request)) { setError('Revisá fecha, descripción, cantidad y costo (hasta 6 decimales).'); return; }
    setIntent({ request, supplier, cents: total });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!intent || lock.current || hasResult.current) return;
    lock.current = true; setBusy(true); setSent(true); setError('');
    try {
      const created = await post('/api/admin/compras', intent.request);
      // El detalle persistido reemplaza la previsualización; si falla, retry conserva UUID.
      const response = await fetch(`/api/admin/compras/${created.compra_gasto_id}`, { cache: 'no-store' });
      const body = await response.json(); if (!response.ok) throw new Error('Registro creado; no pudimos cargar el detalle. Reintentá la misma solicitud.');
      hasResult.current = true; setResult(body.result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el registro.'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (result) return <section className={`${cardStyle} space-y-4`} role="status"><h2 className="text-xl font-bold">{result.tipo === 'MERCADERIA' ? 'Compra registrada correctamente' : 'Gasto registrado correctamente'}</h2><p>{result.proveedor.nombre} · {result.fecha}</p><p className="text-2xl font-bold">{money(result.total, result.moneda)} · {result.moneda}</p><div className="flex flex-wrap gap-4"><Link className="min-h-12 underline" href={`/admin/compras/${result.id}`} onClick={event=>{if(attachmentsBusy)event.preventDefault();}}>Ver detalle</Link><button className={buttonStyle} disabled={attachmentsBusy} onClick={() => { hasResult.current = false; setResult(null); setIntent(null); setSent(false); setItems([emptyItem()]); setComprobante(''); setObservaciones(''); setAttachments([]); }}>Registrar otra</button></div><ReceiptFiles key={result.id} purchaseId={result.id} initialFiles={attachments} onBusyChange={setAttachmentsBusy}/></section>;
  return <div className="space-y-5">
    <Link href="/admin/compras" aria-disabled={busy || sent || !!supplierIntent} onClick={event => { if (busy || sent || supplierIntent) event.preventDefault(); }} className="underline">Volver al listado</Link>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">{error}</p>}
    {!intent && <>
      <section className={`${cardStyle} space-y-4`}><h2 className="text-xl font-semibold">Proveedor</h2>
        <form id="supplier-search" className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void searchSuppliers(); }}><label className="min-w-0 flex-1">Nombre o identificación fiscal<input name="supplier-search" className={inputStyle} value={query} onChange={event => setQuery(event.target.value)} /></label><button className={buttonStyle} disabled={busy}>Buscar proveedores</button></form>
        <ul className="space-y-2">{options.map(option => <li key={option.id}><button className={`${secondaryButtonInteractionStyle} min-h-12 w-full rounded-lg border px-3 text-left`} disabled={busy} onClick={() => setSupplier(option)}>{option.nombre}{option.identificacion_fiscal ? ` · ${option.identificacion_fiscal}` : ''}</button></li>)}</ul>
        {(options.length > 0 || supplierOffset > 0) && <div className="flex gap-3"><button type="button" disabled={busy || supplierOffset === 0} className={`${secondaryButtonInteractionStyle} min-h-12 underline disabled:opacity-50`} onClick={() => void searchSuppliers(supplierOffset - 50)}>Proveedores anteriores</button><button type="button" disabled={busy || options.length < 50} className={`${secondaryButtonInteractionStyle} min-h-12 underline disabled:opacity-50`} onClick={() => void searchSuppliers(supplierOffset + 50)}>Más proveedores</button></div>}
        {supplier && <p role="status">Seleccionado: <strong>{supplier.nombre}</strong></p>}
        <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 underline`} disabled={busy} onClick={() => setShowSupplier(true)}>+ Nuevo proveedor</button>
        {showSupplier && <form id="supplier-create" className="space-y-3" onSubmit={createSupplier}><fieldset disabled={busy || !!supplierIntent}><legend className="font-semibold">Nuevo proveedor</legend>{(['nombre','fiscal','contacto','observaciones'] as const).map(key => <label className="mb-3 block" key={key}>{({ nombre:'Nombre', fiscal:'Identificación fiscal (opcional)', contacto:'Contacto (opcional)', observaciones:'Observaciones (opcional)' })[key]}<input name={`supplier-${key}`} className={inputStyle} value={supplierDraft[key]} onChange={event => setSupplierDraft({ ...supplierDraft, [key]: event.target.value })} /></label>)}</fieldset><button className={buttonStyle} disabled={busy}>{supplierIntent ? 'Reintentar mismo proveedor' : 'Crear proveedor'}</button>{!supplierIntent && <button type="button" className={`${secondaryButtonInteractionStyle} ml-3 min-h-12 underline`} onClick={() => setShowSupplier(false)}>Cancelar</button>}{supplierIntent && <p>Conservamos la misma solicitud mientras esta página esté abierta. No cierres ni recargues hasta resolver el resultado.</p>}</form>}
      </section>
      <form id="purchase-data" className={`${cardStyle} space-y-5`} onSubmit={review}><fieldset disabled={busy || !!supplierIntent} className="space-y-4"><legend className="text-xl font-semibold">Datos de la operación</legend>
        <div className="grid gap-4 sm:grid-cols-2"><label>Tipo<select name="tipo" className={inputStyle} value={tipo} onChange={event => setTipo(event.target.value as 'MERCADERIA' | 'GASTO')}><option value="MERCADERIA">Mercadería</option><option value="GASTO">Gasto</option></select></label><label>Fecha<input name="fecha" type="date" className={inputStyle} value={fecha} onChange={event => setFecha(event.target.value)} /></label><label>Moneda<select name="moneda" className={inputStyle}><option>ARS</option></select></label><label>Comprobante (opcional)<input name="comprobante" className={inputStyle} value={comprobante} onChange={event => setComprobante(event.target.value)} /></label></div>
        <label className="block">Observaciones (opcional)<textarea name="observaciones" className={inputStyle} value={observaciones} onChange={event => setObservaciones(event.target.value)} /></label>
        <h2 className="text-xl font-semibold">Ítems</h2>{items.map((item,index) => <section key={index} className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Ítem {index+1}</h3><label className="block">Descripción<input name={`descripcion-${index}`} className={inputStyle} value={item.descripcion} onChange={event => setItems(items.map((old,i) => i===index ? { ...old, descripcion:event.target.value } : old))} /></label><div className="grid gap-3 sm:grid-cols-2"><label>Cantidad<input inputMode="decimal" name={`cantidad-${index}`} className={inputStyle} value={item.cantidad} onChange={event => setItems(items.map((old,i) => i===index ? { ...old, cantidad:event.target.value } : old))} /></label><label>Costo unitario<input inputMode="decimal" name={`costo-${index}`} className={inputStyle} value={item.costo} onChange={event => setItems(items.map((old,i) => i===index ? { ...old, costo:event.target.value } : old))} /></label></div><p>Subtotal: {subtotal(item.cantidad,item.costo) === null ? '—' : displayCents(subtotal(item.cantidad,item.costo)!)} ARS</p><button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 underline disabled:opacity-50`} disabled={items.length===1} onClick={() => setItems(items.filter((_,i) => i!==index))}>Quitar</button></section>)}
        <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 underline`} disabled={items.length>=1000} onClick={() => setItems([...items,emptyItem()])}>+ Agregar ítem</button><p className="text-2xl font-bold">TOTAL: {displayCents(total)} ARS</p><p className="text-sm">Previsualización. El total definitivo se calcula al registrar.</p>
      </fieldset><button className={buttonStyle} disabled={busy || !!supplierIntent}>Revisar antes de guardar</button></form>
    </>}
    {!intent && <AttachmentPicker files={attachments} onChange={setAttachments} disabled={busy || !!supplierIntent}/>}
    {intent && <form id="purchase-confirm" className={`${cardStyle} space-y-4`} onSubmit={save}><h2 className="text-xl font-bold">Confirmar compra / gasto</h2><p>{intent.request.p_tipo === 'MERCADERIA' ? 'Mercadería' : 'Gasto'} · {intent.supplier.nombre} · {intent.request.p_fecha}</p><ol className="space-y-2">{intent.request.p_items.map(item => <li key={item.posicion}>{item.posicion}. {item.descripcion} · {item.cantidad} × {item.costo_unitario} · {displayCents(subtotal(String(item.cantidad),String(item.costo_unitario))!)} ARS</li>)}</ol><p className="text-2xl font-bold">TOTAL: {displayCents(intent.cents)} ARS</p><p>Comprobante: {intent.request.p_comprobante || '—'}</p><p>Archivos adjuntos: {attachments.length}. Se subirán después de registrar.</p><p>Observaciones: {intent.request.p_observaciones || '—'}</p><div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={busy}>{busy ? 'Guardando…' : sent ? 'Reintentar misma solicitud' : 'Confirmar y guardar'}</button>{!sent && <button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 rounded-lg border px-4`} onClick={() => setIntent(null)}>Volver a editar</button>}</div>{sent && <p>No cierres ni recargues esta página hasta resolver el resultado: el UUID y la solicitud se conservan en esta página.</p>}</form>}
  </div>;
}
