'use client';
import { useRef, useState } from 'react';
import { buttonStyle, cardStyle, inputStyle, uuid } from './purchase-types';
export default function AnnulPurchase({id,onDone}:{id:string;onDone:()=>void}) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState('');
  const [intent,setIntent]=useState<{p_operacion_id:string;p_compra_gasto_id:string;p_motivo:string}|null>(null);
  const [sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sending=useRef(false),completed=useRef(false);
  const [done,setDone]=useState(false);
  async function save(e:React.FormEvent) {
    e.preventDefault();if(!intent||sending.current||completed.current)return;
    sending.current=true;setBusy(true);setSent(true);setError('');
    try {
      const response=await fetch(`/api/admin/compras/${encodeURIComponent(id)}/anular`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent)});
      const body=await response.json();if(!response.ok)throw new Error(body.error||'Resultado incierto. Reintentá la misma operación.');
      if(body.result?.estado!=='ANULADA'||body.result?.compra_gasto_id!==id||body.result?.operacion_id!==intent.p_operacion_id)throw new Error('Resultado incierto. Reintentá la misma operación.');
      completed.current=true;setDone(true);setOpen(false);onDone();
    }catch(e){setError(e instanceof Error?e.message:'Resultado incierto. Reintentá la misma operación.');}
    finally{sending.current=false;setBusy(false);}
  }
  return <section className={`${cardStyle} space-y-3`}>
    <button type="button" className={buttonStyle} disabled={busy||done} onClick={()=>setOpen(true)}>Anular compra</button>
    {open && <><p>La compra {id} quedará ANULADA. No se borra el historial ni se revierte una salida de dinero. Si tiene pagos de tarjeta aplicados, requiere corrección financiera.</p>
      {!intent?<form onSubmit={e=>{e.preventDefault();setError('');if(!reason.trim()||!uuid.test(id)){setError('Ingresá un motivo obligatorio.');return;}setIntent({p_operacion_id:crypto.randomUUID(),p_compra_gasto_id:id,p_motivo:reason.trim()});}} className="space-y-3"><label className="block">Motivo obligatorio<textarea name="motivo_anulacion" className={inputStyle} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="flex flex-wrap gap-3"><button className={buttonStyle}>Revisar anulación</button><button type="button" className={buttonStyle} onClick={()=>setOpen(false)}>Cancelar</button></div></form>:
      <form onSubmit={save} className="space-y-3"><p className="whitespace-pre-wrap">Motivo: {intent.p_motivo}</p><p>Confirmá explícitamente la anulación de esta compra.</p><div className="flex flex-wrap gap-3"><button className={buttonStyle} disabled={busy}>{busy?'Anulando…':sent?'Reintentar misma anulación':'Confirmar anulación'}</button>{!sent && <button type="button" className={buttonStyle} onClick={()=>setIntent(null)}>Volver a editar</button>}</div>{sent && <p>No cierres esta página hasta resolver el resultado: conservamos UUID y motivo para reintentar sin duplicar.</p>}</form>}
      {error && <p role="alert">{error}</p>}</>}
  </section>;
}
