'use client';
import { useEffect, useRef, useState } from 'react';
import { secondaryButtonInteractionStyle, buttonStyle, cardStyle } from './purchase-types';
export type Attachment = { id:string; file:File };
type Receipt = {id:string;nombre_original:string;mime_type:string;tamano_bytes:number;estado:'PENDIENTE'|'DISPONIBLE'|'ANULADO';created_at:string;motivo_anulacion:string|null;anulado_at:string|null;anulado_por:string|null;actor_id:string};
const accept='image/jpeg,image/png,application/pdf';
export function AttachmentPicker({files,onChange,disabled=false}:{files:Attachment[];onChange:(files:Attachment[])=>void;disabled?:boolean}) {
  const [error,setError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  return <section className={`${cardStyle} space-y-3`}><h2 className="text-xl font-semibold">Comprobantes</h2><button type="button" className={buttonStyle} disabled={disabled} onClick={()=>fileInput.current?.click()}><span aria-hidden="true">📎 </span>Adjuntar archivos</button><input ref={fileInput} aria-label="Adjuntar archivos" type="file" accept={accept} multiple disabled={disabled} className="sr-only" style={{position:'absolute',width:1,height:1,overflow:'hidden',clipPath:'inset(50%)'}} onChange={event=>{
    const selected=[...event.target.files??[]];
    if(selected.some(file=>!accept.split(',').includes(file.type)||!file.size||file.size>3*1024*1024)){setError('Elegí JPG, PNG o PDF, con contenido y hasta 3 MiB por archivo.');event.target.value='';return;}
    setError('');onChange([...files,...selected.map(file=>({id:crypto.randomUUID(),file}))]);event.target.value='';
  }}/><p className="text-sm">JPG, PNG o PDF · hasta 3 MiB cada uno. Se guardan después de registrar la compra.</p>{error&&<p role="alert">{error}</p>}
    <ul className="space-y-2">{files.map(entry=><li className="flex min-w-0 flex-wrap items-center gap-3" key={entry.id}><span className="min-w-0 break-all">{entry.file.name} · {(entry.file.size/1024).toFixed(1)} KiB</span><button type="button" className={`${secondaryButtonInteractionStyle} min-h-12 underline`} disabled={disabled} onClick={()=>onChange(files.filter(file=>file.id!==entry.id))}>Quitar archivo</button></li>)}</ul></section>;
}
export default function ReceiptFiles({purchaseId,initialFiles=[],onBusyChange}:{purchaseId:string;initialFiles?:Attachment[];onBusyChange?:(busy:boolean)=>void}) {
  const [rows,setRows]=useState<Receipt[]>([]); const [files,setFiles]=useState<Attachment[]>(initialFiles);
  const [busy,setBusy]=useState(false); const [loaded,setLoaded]=useState(false); const [error,setError]=useState('');
  const [messages,setMessages]=useState<Record<string,string>>({}); const [annul,setAnnul]=useState<string|null>(null);const [reason,setReason]=useState('');
  const lock=useRef(false); const started=useRef(false);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  async function load() {
    const response=await fetch(`/api/admin/compras/${purchaseId}/comprobantes`,{cache:'no-store'});const body=await response.json();
    if(!response.ok || !Array.isArray(body.result))throw new Error(body.error||'No se pudieron consultar comprobantes.');
    setRows(body.result);setLoaded(true);
  }
  async function upload(entries:Attachment[]) {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      for(const entry of entries){
        try {
          const form=new FormData();form.append('id',entry.id);form.append('archivo',entry.file);
          const response=await fetch(`/api/admin/compras/${purchaseId}/comprobantes`,{method:'POST',body:form});const body=await response.json();
          if(!response.ok || body.result?.id!==entry.id || body.result?.estado!=='DISPONIBLE')throw new Error(body.error||'Respuesta incierta.');
          setMessages(old=>({...old,[entry.id]:'Guardado'}));setFiles(old=>old.filter(file=>file.id!==entry.id));
        } catch(cause) {setMessages(old=>({...old,[entry.id]:`${entry.file.name}: ${cause instanceof Error?cause.message:'No pudo completarse.'} Reintentá el mismo archivo.`}));}
      }
      await load();
    } catch(cause){setError(cause instanceof Error?cause.message:'No se pudo consultar.');}
    finally{lock.current=false;setBusy(false);}
  }
  useEffect(()=>{
    if(started.current)return;started.current=true;
    // Un solo envío por UUID, también con StrictMode. La compra ya existe.
    void (async()=>{try{if(initialFiles.length)await upload(initialFiles);else await load();}catch{setError('No se pudo consultar comprobantes.');}})();
    // El componente se monta con key=compra: identidad estable durante su vida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(!busy&&!files.length)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[busy,files.length]);
  async function action(id:string,kind:'annul'|'recover'){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/admin/comprobantes/${id}${kind==='recover'?'/recuperar':''}`,{method:'POST',...(kind==='annul'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({motivo:reason.trim()})}:{})});const body=await response.json();
      if(!response.ok)throw new Error(body.error||'No se pudo completar.');
      if(kind==='annul'){setAnnul(null);setReason('');}await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Resultado incierto.');}finally{lock.current=false;setBusy(false);}
  }
  function receipt(row:Receipt){return <li key={row.id} className="space-y-2 rounded-lg border p-3"><p className="break-all">{row.nombre_original} · {(row.tamano_bytes/1024).toFixed(1)} KiB</p><p className="text-sm">{row.estado} · {new Date(row.created_at).toLocaleString('es-AR')}</p>
    {row.estado!=='PENDIENTE'&&<a className={`${secondaryButtonInteractionStyle} mr-3 inline-flex min-h-12 items-center rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-[var(--hugella-navy)]`} target="_blank" rel="noopener noreferrer" href={`/api/admin/comprobantes/${row.id}/archivo`}>Ver comprobante</a>}
    {row.estado!=='ANULADO'&&<button type="button" disabled={busy} className={buttonStyle} onClick={()=>{setAnnul(row.id);setReason('');}}>Anular comprobante</button>}
    {row.estado==='PENDIENTE'&&<div className="space-y-2"><p>No confirmado. Recuperá el archivo ya subido o seleccioná exactamente el original para reintentar con el mismo UUID.</p><button type="button" disabled={busy} className={`${secondaryButtonInteractionStyle} min-h-12 underline`} onClick={()=>void action(row.id,'recover')}>Recuperar archivo subido</button><label className="block">Reintentar archivo original<input type="file" accept={accept} disabled={busy} className="block min-h-12 w-full min-w-0" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload([{id:row.id,file}]);}}/></label></div>}
    {row.estado==='ANULADO'&&<p className="break-words">Motivo: {row.motivo_anulacion} · {row.anulado_at&&new Date(row.anulado_at).toLocaleString('es-AR')} · actor {row.anulado_por}</p>}
  </li>;}
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Comprobantes digitales</h2>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">Procesando comprobantes. La compra ya está registrada.</p>}
    <button type="button" className={buttonStyle} disabled={busy} onClick={()=>void load().catch(()=>setError('No se pudo consultar.'))}>Actualizar comprobantes</button>
    {loaded&&rows.length===0&&<p>Sin comprobantes guardados.</p>}
    <ul className="space-y-3">{rows.filter(row=>row.estado!=='ANULADO').map(receipt)}</ul>
    {rows.some(row=>row.estado==='ANULADO')&&<section><h3 className="font-semibold">Historial de anulados</h3><ul className="space-y-3">{rows.filter(row=>row.estado==='ANULADO').map(receipt)}</ul></section>}
    {Object.entries(messages).map(([id,message])=><p role="status" key={id} className="break-words">{message}</p>)}
    <AttachmentPicker files={files} onChange={setFiles} disabled={busy||!loaded}/>{files.length>0&&<button type="button" className={buttonStyle} disabled={busy||!loaded} onClick={()=>void upload(files)}>Guardar / reintentar comprobantes</button>}
    {annul&&<form className={`${cardStyle} space-y-3`} onSubmit={event=>{event.preventDefault();void action(annul,'annul');}}><h3 className="font-semibold">Confirmar anulación</h3><p>Se conservan el archivo y su historial. Esta acción no modifica la compra.</p><label className="block">Motivo<textarea required maxLength={500} disabled={busy} className="block min-h-24 w-full rounded border p-3" value={reason} onChange={event=>setReason(event.target.value)}/></label><button className={buttonStyle} disabled={busy||!reason.trim()}>Confirmar anulación</button><button type="button" disabled={busy} className={`${secondaryButtonInteractionStyle} ml-3 min-h-12 underline`} onClick={()=>setAnnul(null)}>Cancelar</button></form>}
  </section>;
}
