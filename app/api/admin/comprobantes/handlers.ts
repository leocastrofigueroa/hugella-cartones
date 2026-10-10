import 'server-only';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { BUCKET, MAX_FILE_SIZE, digest, uuid, validateFile } from './files';
type Receipt = {id:string;compra_gasto_id:string;actor_id:string;bucket:string;ruta:string;nombre_original:string;mime_type:string;tamano_bytes:number;sha256:string;estado:'PENDIENTE'|'DISPONIBLE'|'ANULADO';created_at:string;confirmado_at:string|null;anulado_at:string|null;anulado_por:string|null;motivo_anulacion:string|null};
class Failure extends Error { constructor(message:string, readonly status:number) { super(message); } }
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
function checked(data: unknown): Receipt {
  const r=data as Receipt | null;
  if (!r || !uuid.test(r.id) || !uuid.test(r.compra_gasto_id) || r.bucket!==BUCKET || !['PENDIENTE','DISPONIBLE','ANULADO'].includes(r.estado)
    || !/^[0-9a-f]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.tamano_bytes) || r.tamano_bytes<1 || r.tamano_bytes>MAX_FILE_SIZE
    || r.ruta!==`${r.compra_gasto_id}/${r.id}${r.mime_type==='image/jpeg'?'.jpg':r.mime_type==='image/png'?'.png':r.mime_type==='application/pdf'?'.pdf':''}`) throw new Failure('Metadatos incompatibles. Requiere revisión.',409);
  return r;
}
async function form(request:Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) throw new Failure('Formato de envío inválido.',415);
  const reader=request.body?.getReader(); if (!reader) throw new Failure('Archivo ausente.',422);
  const chunks:Uint8Array[]=[]; let size=0;
  try { while (true) { const next=await reader.read(); if(next.done)break; size+=next.value.byteLength; if(size>MAX_FILE_SIZE+65536){await reader.cancel();throw new Failure('El archivo no puede superar 3 MiB.',413);} chunks.push(next.value); } } finally {reader.releaseLock();}
  return new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();
}
async function verifiedObject(admin:ReturnType<typeof createAdminClient>,r:Receipt) {
  const object=await admin.storage.from(BUCKET).download(r.ruta);
  if (object.error || !object.data) throw new Failure('Archivo pendiente o inaccesible. Reintentá con el mismo archivo y UUID.',409);
  if (object.data.size!==r.tamano_bytes) throw new Failure('Tamaño del objeto incompatible. Requiere revisión.',409);
  const bytes=new Uint8Array(await object.data.arrayBuffer());
  if (digest(bytes)!==r.sha256) throw new Failure('Hash del objeto incompatible. Requiere revisión.',409);
  try { await validateFile(bytes,r.mime_type,r.nombre_original); } catch { throw new Failure('Contenido almacenado incompatible. Requiere revisión.',409); }
  return bytes;
}
async function finalize(admin:ReturnType<typeof createAdminClient>,r:Receipt,actor:string) {
  const response=await admin.rpc('confirmar_comprobante_compra_gasto_servidor',{p_id:r.id,p_actor_id:actor,p_sha256:r.sha256,p_tamano:r.tamano_bytes});
  if (response.error) throw new Failure('No pudimos confirmar el comprobante. Reintentá la misma operación.',502);
  const result=checked(response.data);
  if(result.id!==r.id || result.estado!=='DISPONIBLE' || result.sha256!==r.sha256) throw new Failure('Respuesta incierta. Reintentá la misma operación.',502);
  return result;
}
export async function receiptHandler(request:Request,kind:'upload'|'list'|'read'|'annul'|'recover',id:string) {
  try {
    if (!uuid.test(id)) throw new Failure('Identificador inválido.',400);
    if (request.method==='POST' && (request.headers.get('origin')!==new URL(request.url).origin || ![null,'same-origin'].includes(request.headers.get('sec-fetch-site')))) throw new Failure('Solicitud no permitida.',403);
    const client=await createClient(); const claims=await client.auth.getClaims();
    const actor=claims.data?.claims?.sub;
    if(claims.error || typeof actor!=='string' || !uuid.test(actor)) throw new Failure('Tu sesión venció.',401);
    // Esta RPC verifica Admin en DB ANTES de crear/utilizar el cliente privilegiado.
    const authorization=await client.rpc(kind==='upload'||kind==='list'?'obtener_compra_gasto_admin':'obtener_comprobante_compra_gasto_admin',kind==='upload'||kind==='list'?{p_compra_gasto_id:id}:{p_id:id});
    if(authorization.error) throw new Failure(authorization.error.code==='42501'?'Tu cuenta no tiene permisos de administración.':'Registro inexistente o inaccesible.',authorization.error.code==='42501'?403:404);
    if(kind==='list') {
      const result=await client.rpc('listar_comprobantes_compra_gasto_admin',{p_compra_gasto_id:id});
      if(result.error || !Array.isArray(result.data)) throw new Failure('No se pudo consultar comprobantes.',502);
      return json({result:result.data.map(checked)});
    }
    if(kind==='annul') {
      const body=await request.json();
      if(!body || Object.keys(body).length!==1 || typeof body.motivo!=='string' || !body.motivo.trim() || body.motivo.trim().length>500) throw new Failure('Ingresá un motivo de hasta 500 caracteres.',422);
      const result=await client.rpc('anular_comprobante_compra_gasto_admin',{p_id:id,p_motivo:body.motivo.trim()});
      if(result.error) throw new Failure('No se pudo anular. Consultá el estado antes de reintentar con el mismo motivo.',409);
      return json({result:checked(result.data)});
    }
    let r:Receipt;
    if(kind==='upload') {
      const data=await form(request);
      if([...data.keys()].length!==2 || data.getAll('archivo').length!==1 || data.getAll('id').length!==1) throw new Failure('Envío inválido.',422);
      const file=data.get('archivo'),operation=data.get('id');
      if(!(file instanceof File) || typeof operation!=='string' || !uuid.test(operation)) throw new Failure('Archivo e identificador obligatorios.',422);
      const bytes=new Uint8Array(await file.arrayBuffer());
      let valid; try {valid=await validateFile(bytes,file.type,file.name);} catch(cause){throw new Failure(cause instanceof Error?cause.message:'Archivo inválido.',422);}
      const admin=createAdminClient();
      const reservation=await admin.rpc('reservar_comprobante_compra_gasto_servidor',{p_id:operation,p_compra_gasto_id:id,p_actor_id:actor,p_nombre:valid.name,p_mime:valid.mime,p_tamano:valid.size,p_sha256:valid.hash});
      if(reservation.error) throw new Failure(reservation.error.code==='22023'?'Operación incompatible: conservá el mismo archivo y UUID.':'No se pudo reservar. Reintentá la misma operación.',reservation.error.code==='22023'?409:502);
      r=checked(reservation.data);
      if(r.id!==operation || r.actor_id!==actor || r.compra_gasto_id!==id || r.sha256!==valid.hash || r.tamano_bytes!==valid.size || r.mime_type!==valid.mime || r.nombre_original!==valid.name || r.estado==='ANULADO') throw new Failure('Reserva incompatible.',409);
      if(r.estado==='PENDIENTE') {
        // Un error de upload puede ser respuesta perdida o conflicto: siempre verificar.
        try {await admin.storage.from(BUCKET).upload(r.ruta,bytes,{contentType:r.mime_type,cacheControl:'0',upsert:false});} catch { /* Resolver mediante descarga, nunca borrar ni sobrescribir. */ }
      }
      await verifiedObject(admin,r);
      return json({result:await finalize(admin,r,actor)});
    }
    r=checked(authorization.data);
    if(r.id!==id) throw new Failure('Identidad incompatible.',409);
    if(kind==='recover' && (r.actor_id!==actor || r.estado==='ANULADO')) throw new Failure('Recuperación no permitida para esta operación.',409);
    if(kind==='read' && r.estado==='PENDIENTE') throw new Failure('Comprobante todavía pendiente.',409);
    const admin=createAdminClient(); const bytes=await verifiedObject(admin,r);
    if(kind==='recover') return json({result:await finalize(admin,r,actor)});
    // PDF como descarga: evita ejecutar contenido activo dentro del origen Admin.
    const disposition=r.mime_type==='application/pdf'?'attachment':'inline';
    return new Response(Buffer.from(bytes),{headers:{'Content-Type':r.mime_type,'Content-Disposition':`${disposition}; filename="comprobante.${r.mime_type==='image/jpeg'?'jpg':r.mime_type==='image/png'?'png':'pdf'}"; filename*=UTF-8''${encodeURIComponent(r.nombre_original)}`,'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox"}});
  } catch(cause) {
    if(cause instanceof Failure)return json({error:cause.message},cause.status);
    return json({error:'Resultado incierto. Consultá el estado y reintentá la misma operación.'},502);
  }
}
