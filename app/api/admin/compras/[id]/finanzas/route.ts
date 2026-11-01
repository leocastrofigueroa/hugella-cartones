import { createClient } from '@/utils/supabase/server';
import { uuid, validDate } from '@/app/admin/compras/purchase-types';
import { paymentCents, centsNumber } from '@/app/admin/compras/payment-types';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const origin=request.headers.get('origin');
    if(origin && new URL(origin).origin!==new URL(request.url).origin)return json({error:'Solicitud no permitida.'},403);
    const client=await createClient(); const session=await client.auth.getClaims();
    if(session.error||!session.data?.claims?.sub)return json({error:'Tu sesión venció.'},401);
    const {id}=await params;
    let body;try{body=await request.json();}catch{return json({error:'Solicitud inválida.'},400);}
    const {p_operacion_id,p_accion,p_datos:d}=body??{};
    const fields=p_accion==='CANCELAR'?['fecha','motivo','obligaciones']:p_accion==='DEVOLUCION'?['fecha','motivo','tramo_id','importe']:p_accion==='ACREDITAR'?['fecha','devolucion_id','periodo_id','importe','referencia']:null;
    if(!uuid.test(id)||typeof p_operacion_id!=='string'||!uuid.test(p_operacion_id)||!fields||!d||typeof d!=='object'||Array.isArray(d)||Object.keys(body).sort().join()!=='p_accion,p_datos,p_operacion_id'||Object.keys(d).sort().join()!==[...fields].sort().join()||!validDate(d.fecha))return json({error:'Datos inválidos.'},422);
    if(p_accion==='CANCELAR' ? !Array.isArray(d.obligaciones)||d.obligaciones.length>1000||d.obligaciones.some((v:unknown)=>typeof v!=='string'||!uuid.test(v))||new Set(d.obligaciones).size!==d.obligaciones.length : false)return json({error:'Cuotas inválidas.'},422);
    if(p_accion!=='ACREDITAR'&&(typeof d.motivo!=='string'||!d.motivo.trim()||d.motivo.trim().length>1000))return json({error:'Motivo obligatorio.'},422);
    if(p_accion!=='CANCELAR') {
      const cents=typeof d.importe==='number'?paymentCents(String(d.importe)):null;
      if(cents===null||cents<=BigInt(0)||centsNumber(cents)===null)return json({error:'Importe inválido.'},422);
      for(const k of p_accion==='DEVOLUCION'?['tramo_id']:['devolucion_id','periodo_id'])if(typeof d[k]!=='string'||!uuid.test(d[k]))return json({error:'Identificador inválido.'},422);
      if(p_accion==='ACREDITAR'&&d.referencia!==null&&(typeof d.referencia!=='string'||d.referencia.length>1000))return json({error:'Referencia inválida.'},422);
    }
    const result=await client.rpc('operar_devolucion_compra_admin',{p_operacion_id,p_compra_id:id,p_accion,p_datos:d});
    if(result.error)return json({error:result.error.code==='42501'?'Sin permisos de administración.':['22023','23514','23505','23502','23503'].includes(result.error.code)?'Revisá cuotas futuras sin pagos ni cortes, importes disponibles y período de la tarjeta. La operación no se registró.':'Resultado incierto. Reintentá la misma operación.'},result.error.code==='42501'?403:['22023','23514','23505','23502','23503'].includes(result.error.code)?409:502);
    if(result.data?.operacion_id!==p_operacion_id||result.data?.compra_id!==id||result.data?.accion!==p_accion||typeof result.data?.id!=='string'||!uuid.test(result.data.id))return json({error:'Resultado incierto. Reintentá la misma operación.'},502);
    return json({result:result.data});
  }catch{return json({error:'Resultado incierto. Reintentá la misma operación.'},502);}
}
