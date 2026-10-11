'use client';
import Link from 'next/link';
import SummaryPayment from './summary-payment';
import { useEffect, useState } from 'react';
import { buttonStyle, cardStyle, inputStyle, money, validDate } from './purchase-types';
type Card = {id:string;nombre:string;entidad:string;activo:boolean};
type Summary = {periodo_id:string;fecha_cierre:string;fecha_vencimiento:string;total_obligaciones_hugella:number;total_pagado:number;saldo:number;estado:string};
async function api(url:string, payload?:Record<string,string>) {
  const response=await fetch(url,payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{cache:'no-store'});
  const body=await response.json(); if(!response.ok) throw new Error(body.error || 'No se pudo confirmar. Reintentá la misma operación.'); return body.result;
}
function Entry({card,onDone,onPending}:{card?:string;onDone:()=>void;onPending?:(pending:boolean)=>void}) {
  const [open,setOpen]=useState(false),[a,setA]=useState(''),[b,setB]=useState('');
  const [intent,setIntent]=useState<Record<string,string>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:React.FormEvent) {
    e.preventDefault();setError('');
    if(!intent && (card ? !validDate(a)||!validDate(b)||b<a : !a.trim()||!b.trim())) {setError('Revisá los campos. El vencimiento debe ser igual o posterior al cierre.');return;}
    const payload=intent || (card?{p_operacion_id:crypto.randomUUID(),p_tarjeta_id:card,p_fecha_cierre:a,p_fecha_vencimiento:b}:{p_operacion_id:crypto.randomUUID(),p_nombre:a.trim(),p_entidad:b.trim()});
    setIntent(payload);onPending?.(true);setBusy(true);
    try {await api(`/api/admin/compras/${card?'periodos':'tarjetas'}`,payload);setIntent(null);onPending?.(false);setA('');setB('');setOpen(false);onDone();}
    catch(cause){setError(cause instanceof Error?cause.message:'Resultado incierto. Reintentá la misma operación.');}
    finally{setBusy(false);}
  }
  return <div className="space-y-3"><button className={buttonStyle} disabled={busy} onClick={()=>setOpen(true)}>+ {card?'Nuevo período':'Nueva tarjeta'}</button>{open && <form onSubmit={save} className={`${cardStyle} space-y-3`}>
    <fieldset disabled={busy||!!intent} className="grid gap-4 sm:grid-cols-2"><label>{card?'Fecha de cierre':'Nombre'}<input name={card?'cierre':'nombre'} type={card?'date':'text'} className={inputStyle} value={a} onChange={e=>setA(e.target.value)}/></label><label>{card?'Fecha de vencimiento':'Entidad'}<input name={card?'vencimiento':'entidad'} type={card?'date':'text'} className={inputStyle} value={b} onChange={e=>setB(e.target.value)}/></label></fieldset>
    {card && <p>Ingresá solamente fechas reales informadas por el banco. Los períodos nuevos deben ser posteriores a los ya registrados.</p>}
    {error && <p role="alert">{error}</p>}{intent && <p>Operación pendiente: conservamos sus datos para reintentar. No cierres esta página.</p>}
    <div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={busy}>{busy?'Guardando…':intent?'Reintentar misma operación':'Guardar'}</button><button type="button" className={buttonStyle} disabled={busy||!!intent} onClick={()=>setOpen(false)}>Cancelar</button></div>
  </form>}</div>;
}
function EditCard({card,onDone,onPending}:{card:Card;onDone:()=>void;onPending:(pending:boolean)=>void}) {
  const [name,setName]=useState(card.nombre),[entity,setEntity]=useState(card.entidad);
  const [intent,setIntent]=useState<Record<string,string>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:React.FormEvent) {
    e.preventDefault();if(busy)return;setError('');
    if(!intent && (!name.trim()||!entity.trim())){setError('Nombre y entidad obligatorios.');return;}
    const payload=intent || {p_operacion_id:crypto.randomUUID(),p_tarjeta_id:card.id,p_nombre:name.trim(),p_entidad:entity.trim(),p_nombre_anterior:card.nombre,p_entidad_anterior:card.entidad};
    setIntent(payload);setBusy(true);onPending(true);
    try {await api('/api/admin/compras/tarjetas/editar',payload);onPending(false);onDone();}
    catch(e){setError(e instanceof Error?e.message:'Resultado incierto. Reintentá la misma operación.');}
    finally{setBusy(false);}
  }
  return <form onSubmit={save} className={`${cardStyle} space-y-3`}><h2 className="text-xl font-semibold">Editar {card.nombre} · {card.entidad}</h2><p>Corrección descriptiva de la misma tarjeta. Sus deudas y períodos no se trasladan.</p>
    <fieldset disabled={busy||!!intent} className="grid gap-3 sm:grid-cols-2"><label>Nombre<input name="editar_nombre" className={inputStyle} value={name} onChange={e=>setName(e.target.value)}/></label><label>Entidad<input name="editar_entidad" className={inputStyle} value={entity} onChange={e=>setEntity(e.target.value)}/></label></fieldset>
    {error && <p role="alert">{error}</p>}{intent && <p>Conservamos UUID y datos. No cierres esta página mientras el resultado sea incierto.</p>}
    <div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={busy}>{busy?'Guardando…':intent?'Reintentar misma edición':'Guardar cambios'}</button><button type="button" className={buttonStyle} disabled={busy||!!intent} onClick={onDone}>Cancelar</button></div></form>;
}
export default function CardsView() {
  const [cards,setCards]=useState<Card[]>([]),[selected,setSelected]=useState(''),[rows,setRows]=useState<Summary[]>([]);
  const [revision,setRevision]=useState(0),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [cardError,setCardError]=useState('');
  const [periodPending,setPeriodPending]=useState(false);
  const [payPending,setPayPending]=useState(false);
  const [editing,setEditing]=useState<Card|null>(null),[editPending,setEditPending]=useState(false);
  function refresh() {setRows([]);setError('');setLoading(true);setRevision(r=>r+1);}
  function page(next:number) {setRows([]);setError('');setLoading(true);setOffset(next);}
  useEffect(()=>{let active=true;api('/api/admin/compras/tarjetas').then(result=>{if(active){setCards(result);setCardError('');}}).catch(e=>{if(active)setCardError(e.message);});return()=>{active=false;};},[revision]);
  useEffect(()=>{let active=true;if(!selected)return;
    api(`/api/admin/compras/resumenes?tarjeta_id=${encodeURIComponent(selected)}&offset=${offset}`).then(result=>{if(active)setRows(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[selected,offset,revision]);
  return <div className="space-y-6"><h1 className="text-3xl font-bold">Tarjetas y resúmenes</h1><Link href="/admin/compras" className="underline">Volver a Compras</Link>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Tarjetas</h2>{cardError && <p role="alert">{cardError}</p>}{!cardError && cards.length===0 && <p>No hay tarjetas registradas.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{cards.map(card=><div key={card.id} className="flex flex-wrap items-start gap-3"><button key={card.id} disabled={periodPending||editPending||payPending} aria-pressed={selected===card.id} className={`${buttonStyle} text-left break-words`} onClick={()=>{setRows([]);setError('');setLoading(true);setSelected(card.id);setOffset(0);if(card.id===selected)refresh();}}><span className="block">{card.nombre}</span><span className="block">{card.entidad}</span><span className="block">{card.activo?'Activa':'Inactiva'}</span></button><button className={buttonStyle} disabled={periodPending||editPending||payPending} onClick={()=>setEditing(card)}>Editar</button></div>)}</div>
      <div inert={payPending}><Entry onDone={refresh}/></div>{editing && <div inert={payPending}><EditCard key={editing.id} card={editing} onPending={setEditPending} onDone={()=>{setEditing(null);refresh();}}/></div>}</section>
    {selected && <section className="space-y-4"><h2 className="text-xl font-semibold">Períodos / resúmenes</h2>{cards.find(c=>c.id===selected)?.activo && <div inert={payPending}><Entry key={selected} card={selected} onPending={setPeriodPending} onDone={()=>{setOffset(0);refresh();}}/></div>}
      {loading && <p role="status">Cargando…</p>}{error && <p role="alert">{error}</p>}{!loading&&!error&&rows.length===0 && <p>No hay períodos registrados para esta tarjeta.</p>}
      {rows.map(row=><article key={row.periodo_id} className={`${cardStyle} space-y-2`}><p>Cierre: {row.fecha_cierre}</p><p>Vencimiento: {row.fecha_vencimiento}</p><p>Total obligaciones HUGELLA: {money(row.total_obligaciones_hugella,'ARS')}</p><p>Pagado: {money(row.total_pagado,'ARS')}</p><p>Saldo: {money(row.saldo,'ARS')}</p><p>Estado: {row.estado}</p><SummaryPayment locked={payPending||editPending||periodPending} row={row} card={cards.find(c=>c.id===selected)?.nombre+' · '+cards.find(c=>c.id===selected)?.entidad} onPending={setPayPending} onDone={refresh}/></article>)}
      <div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={payPending||loading||offset===0} onClick={()=>page(offset-100)}>Anterior</button><button className={buttonStyle} disabled={payPending||loading||rows.length<100} onClick={()=>page(offset+100)}>Siguiente</button></div>
    </section>}</div>;
}
