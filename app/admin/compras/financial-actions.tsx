'use client';
import { useEffect, useRef, useState } from 'react';
import { buttonStyle, cardStyle, inputStyle, money, validDate } from './purchase-types';
import { paymentCents, centsNumber } from './payment-types';
import { formatDateAR } from '@/utils/date-format';
type Quota={obligacion_id:string;numero_cuota:number;importe:number;saldo:number;estado:string;fecha_cierre:string|null;total_aplicado:number;importe_corte_historico:number};
type Refund={id:string;tarjeta_id:string;importe_esperado:number;importe_acreditado:number;importe_pendiente:number;estado:string;acreditaciones:{id:string;importe:number;fecha_acreditacion:string;periodo_id:string}[]};
export type PurchaseFinance={estado:string;estado_financiacion:string;total_pagado:number|null;total_corte_historico?:number;saldo_pendiente:number|null;cancelacion_financiera?:{motivo:string;fecha_cancelacion:string;actor_id:string;operacion_id:string}|null;cuotas:Quota[];formas_pago:{tramo_id:string;medio:string;tarjeta_nombre:string;tarjeta_id:string;importe:number}[];devoluciones?:Refund[]};
type Intent={p_operacion_id:string;p_accion:string;p_datos:Record<string,unknown>};
export default function FinancialActions({id,finance:f,onDone}:{id:string;finance:PurchaseFinance;onDone:()=>void}) {
  const [action,setAction]=useState(''),[date,setDate]=useState(''),[reason,setReason]=useState(''),[amount,setAmount]=useState(''),[target,setTarget]=useState(''),[period,setPeriod]=useState(''),[reference,setReference]=useState('');
  const [selected,setSelected]=useState<string[]>([]),[periods,setPeriods]=useState<{id:string;fecha_cierre:string;fecha_vencimiento:string}[]>([]),[periodError,setPeriodError]=useState('');
  const [intent,setIntent]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const sending=useRef(false);
  const refunds=f.devoluciones??[],cards=f.formas_pago.filter(t=>t.medio==='TARJETA_CREDITO');
  const refund=refunds.find(d=>d.id===target);const card=action==='ACREDITAR'?refund?.tarjeta_id:undefined;
  useEffect(()=>{let active=true;
    if(card)void(async()=>{try{const rows:typeof periods=[];for(let offset=0;;offset+=100){const r=await fetch(`/api/admin/compras/periodos?tarjeta_id=${card}&offset=${offset}`,{cache:'no-store'});const b=await r.json();if(!r.ok||!Array.isArray(b.result))throw new Error('No se pudieron cargar los períodos.');rows.push(...b.result);if(b.result.length<100)break;}if(active)setPeriods(rows);}catch{if(active)setPeriodError('No se pudieron cargar los períodos. Volvé a elegir la devolución.');}})();
    return()=>{active=false;};
  },[card,target]);
  const future=f.cuotas.filter(q=>q.estado!=='CANCELADA'&&Number(q.total_aplicado)===0&&Number(q.importe_corte_historico)===0&&(!q.fecha_cierre||q.fecha_cierre>date));
  async function save(e:React.FormEvent){e.preventDefault();if(sending.current)return;setError('');let payload=intent;
    if(!payload){
      const cents=paymentCents(amount),number=cents===null?null:centsNumber(cents);
      if(!validDate(date)||(action!=='ACREDITAR'&&!reason.trim())||(action!=='CANCELAR'&&(number===null||number<=0||!target))||(action==='ACREDITAR'&&!period)){setError('Completá fecha, motivo, importe y destino según corresponda.');return;}
      if(action==='CANCELAR'&&selected.some(v=>!future.some(q=>q.obligacion_id===v))){setError('Revisá las cuotas para la fecha elegida.');return;}
      const data=action==='CANCELAR'?{fecha:date,motivo:reason.trim(),obligaciones:selected}:action==='DEVOLUCION'?{fecha:date,motivo:reason.trim(),tramo_id:target,importe:number}:{fecha:date,devolucion_id:target,periodo_id:period,importe:number,referencia:reference.trim()||null};
      payload={p_operacion_id:crypto.randomUUID(),p_accion:action,p_datos:data};setIntent(payload);
    }
    sending.current=true;setBusy(true);
    try{const r=await fetch(`/api/admin/compras/${id}/finanzas`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const b=await r.json();if(!r.ok){if([400,401,403,409,422].includes(r.status))setIntent(null);throw new Error(b.error||'Resultado incierto. Reintentá la misma operación.');}setIntent(null);setAction('');onDone();}
    catch(e){setError(e instanceof Error?e.message:'Resultado incierto. Reintentá la misma operación.');}finally{sending.current=false;setBusy(false);}
  }
  return <section className={`${cardStyle} space-y-3`}><h2 className="text-xl font-semibold">Situación financiera · {f.estado}</h2><p>Pagos reales: {f.total_pagado===null?'Sin financiación registrada':money(f.total_pagado,'ARS')} · Corte histórico: {money(f.total_corte_historico??0,'ARS')} · Saldo operativo: {f.saldo_pendiente===null?'Sin financiación registrada':money(f.saldo_pendiente,'ARS')}</p>
    {f.cancelacion_financiera&&<div><strong>CANCELADA</strong><p>{formatDateAR(f.cancelacion_financiera.fecha_cancelacion)} · {f.cancelacion_financiera.motivo}</p><p>Actor: {f.cancelacion_financiera.actor_id} · Operación: {f.cancelacion_financiera.operacion_id}</p><p>Las cuotas no seleccionadas conservan su saldo.</p></div>}
    <ul>{f.cuotas.map(q=><li key={q.obligacion_id}>Cuota {q.numero_cuota} · {q.estado} · Original {money(q.importe,'ARS')} · Pendiente {money(q.saldo,'ARS')}</li>)}</ul>
    <p>Las devoluciones esperadas no reducen saldos. Sólo las acreditaciones recibidas en un resumen generan crédito; no son pagos de caja.</p>
    {refunds.map(d=><div key={d.id} className="rounded border p-3"><strong>Devolución {d.estado}</strong><p>Esperada: {money(d.importe_esperado,'ARS')} · Acreditada: {money(d.importe_acreditado,'ARS')} · Pendiente: {money(d.importe_pendiente,'ARS')}</p>{d.acreditaciones.map(a=><p key={a.id}>{formatDateAR(a.fecha_acreditacion)} · {money(a.importe,'ARS')} · Resumen {a.periodo_id}</p>)}</div>)}
    {f.estado_financiacion==='CONFIRMADA'&&f.estado!=='ANULADA'&&<>
      {!action&&<div className="flex flex-wrap gap-3">{!f.cancelacion_financiera&&<button className={buttonStyle} onClick={()=>{setAction('CANCELAR');setTarget('');}}>Cancelar compra / cuotas futuras</button>}{cards.length>0&&<button className={buttonStyle} onClick={()=>{setAction('DEVOLUCION');setTarget('');}}>Registrar devolución esperada</button>}{refunds.some(d=>Number(d.importe_pendiente)>0&&d.estado!=='CANCELADA')&&<button className={buttonStyle} onClick={()=>{setAction('ACREDITAR');setTarget('');}}>Acreditar devolución recibida</button>}</div>}
      {action&&<form onSubmit={save} className="space-y-3"><h3 className="font-semibold">{action==='CANCELAR'?'Cancelar compra y seleccionar cuotas futuras':action==='DEVOLUCION'?'Devolución esperada · sin efecto en el saldo':'Crédito efectivamente recibido en la tarjeta'}</h3>
        <fieldset disabled={busy||!!intent} className="grid gap-3"><label>Fecha<input required type="date" className={inputStyle} value={date} onChange={e=>{setDate(e.target.value);setSelected([]);}}/></label>
          {action!=='ACREDITAR'&&<label>Motivo<input required maxLength={1000} className={inputStyle} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
          {action==='CANCELAR'?<><p>Seleccioná únicamente cuotas que el emisor haya cancelado. Sin selección sólo se registra la cancelación de la compra. No se revierten pagos ni cortes históricos.</p>{date&&future.map(q=><label key={q.obligacion_id}><input type="checkbox" checked={selected.includes(q.obligacion_id)} onChange={e=>setSelected(v=>e.target.checked?[...v,q.obligacion_id]:v.filter(x=>x!==q.obligacion_id))}/> Cuota {q.numero_cuota} · {money(q.importe,'ARS')}</label>)}</>:<><label>{action==='DEVOLUCION'?'Tramo de tarjeta':'Devolución pendiente'}<select required className={inputStyle} value={target} onChange={e=>{setTarget(e.target.value);setPeriod('');setPeriods([]);setPeriodError('');}}><option value="">Elegir…</option>{action==='DEVOLUCION'?cards.map(t=><option key={t.tramo_id} value={t.tramo_id}>{t.tarjeta_nombre} · {money(t.importe,'ARS')}</option>):refunds.filter(d=>Number(d.importe_pendiente)>0&&d.estado!=='CANCELADA').map(d=><option key={d.id} value={d.id}>{d.id} · Pendiente {money(d.importe_pendiente,'ARS')}</option>)}</select></label><label>Importe<input required inputMode="decimal" className={inputStyle} value={amount} onChange={e=>setAmount(e.target.value)}/></label></>}
          {action==='ACREDITAR'&&<><label>Resumen donde apareció el crédito<select required className={inputStyle} value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Elegir…</option>{periods.map(p=><option key={p.id} value={p.id}>Cierre {formatDateAR(p.fecha_cierre)} · Vence {formatDateAR(p.fecha_vencimiento)}</option>)}</select></label>{periodError&&<p role="alert">{periodError}</p>}<label>Referencia<input maxLength={1000} className={inputStyle} value={reference} onChange={e=>setReference(e.target.value)}/></label></>}
        </fieldset>{error&&<p role="alert">{error}</p>}{intent&&<p>Resultado pendiente de confirmación. Conservamos UUID y datos para reintentar. No cierres esta página.</p>}<div className="flex gap-3"><button className={buttonStyle} disabled={busy}>{busy?'Registrando…':intent?'Reintentar misma operación':'Confirmar'}</button><button type="button" className={buttonStyle} disabled={busy||!!intent} onClick={()=>{setAction('');setError('');}}>Volver</button></div>
      </form>}
    </>}
  </section>;
}
