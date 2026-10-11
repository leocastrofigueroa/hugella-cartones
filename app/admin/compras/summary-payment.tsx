'use client';
import { useRef, useState } from 'react';
import { buttonStyle, cardStyle, inputStyle, money, validDate } from './purchase-types';
import { paymentCents, centsNumber } from './payment-types';
export type Summary = {periodo_id:string;fecha_cierre:string;fecha_vencimiento:string;total_obligaciones_hugella:number;total_pagado:number;saldo:number;estado:string};
export default function SummaryPayment({row,card,onDone,onPending,locked=false}:{locked?:boolean;row:Summary;card:string;onDone:()=>void;onPending:(value:boolean)=>void}) {
  const [open,setOpen]=useState(false),[amount,setAmount]=useState(String(row.saldo)),[date,setDate]=useState('');
  const [intent,setIntent]=useState<Record<string,unknown>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sending=useRef(false);
  const eligible=Number(row.total_obligaciones_hugella)>0 && Number(row.saldo)>0 && (row.estado==='PENDIENTE'||row.estado==='PAGO_PARCIAL');
  async function save(e:React.FormEvent) {
    e.preventDefault();if(sending.current)return;setError('');
    const cents=paymentCents(amount),balance=paymentCents(String(row.saldo));
    if(!intent && (!eligible || cents===null || balance===null || cents<=BigInt(0) || cents>balance || centsNumber(cents)===null || !validDate(date))) {setError('Ingresá un importe mayor a cero, no superior al saldo, y una fecha válida.');return;}
    const payload=intent || {p_operacion_id:crypto.randomUUID(),p_periodo_id:row.periodo_id,p_fecha_pago:date,p_importe:centsNumber(cents!),p_referencia:null};
    sending.current=true;setBusy(true);setIntent(payload);onPending(true);
    try {
      const response=await fetch('/api/admin/compras/resumenes/pagos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Resultado incierto. Reintentá la misma operación.');
      setIntent(null);setOpen(false);onPending(false);onDone();
    } catch(e){setError(e instanceof Error?e.message:'Resultado incierto. Reintentá la misma operación.');}
    finally{sending.current=false;setBusy(false);}
  }
  if(!eligible && !intent)return null;
  return <div className="space-y-3"><button className={buttonStyle} disabled={busy||(locked&&!intent)} onClick={()=>setOpen(true)}>Registrar pago</button>{open && <form onSubmit={save} className={`${cardStyle} space-y-3`}>
    <h3 className="text-xl font-semibold">Pago real · {card}</h3><p>Cierre: {row.fecha_cierre} · Vencimiento: {row.fecha_vencimiento}</p><p>Total obligaciones HUGELLA: {money(row.total_obligaciones_hugella,'ARS')}</p><p>Pagado: {money(row.total_pagado,'ARS')} · Saldo pendiente: {money(row.saldo,'ARS')}</p><p>Estado: {row.estado}</p><p>Este pago registra una salida real de dinero.</p>
    <fieldset disabled={busy||!!intent} className="grid gap-3 sm:grid-cols-2"><label>Importe a pagar<input name="importe_pago" inputMode="decimal" className={inputStyle} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Fecha de pago<input name="fecha_pago_resumen" type="date" className={inputStyle} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Origen<input className={inputStyle} readOnly value="Caja Efectivo"/></label></fieldset>
    {error && <p role="alert">{error}</p>}{intent && <p>Conservamos UUID y datos para reintentar el mismo pago. No cierres esta página.</p>}
    <div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={busy||(locked&&!intent)}>{busy?'Registrando…':intent?'Reintentar mismo pago':'Confirmar pago'}</button><button type="button" className={buttonStyle} disabled={busy||!!intent} onClick={()=>setOpen(false)}>Cancelar</button></div>
  </form>}</div>;
}
