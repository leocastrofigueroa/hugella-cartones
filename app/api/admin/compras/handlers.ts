import { paymentCents, centsNumber, validateFinancedPurchase } from '@/app/admin/compras/payment-types';
import { createClient } from '@/utils/supabase/server';
import { validatePurchase, validateSupplier, uuid, validDate } from '@/app/admin/compras/purchase-types';
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
export async function handle(request: Request, kind: 'supplier' | 'purchase' | 'detail' | 'financed' | 'cards' | 'periods' | 'summaries' | 'edit-card' | 'summary-payment' | 'annul-purchase', id?: string) {
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ error: 'Solicitud no permitida.' }, 403);
    const client = await createClient();
    const session = await client.auth.getClaims();
    if (session.error || !session.data?.claims?.sub) return json({ error: 'Tu sesión venció. Volvé a iniciar sesión.' }, 401);
    let rpc: string; let args: Record<string, unknown>;
    if (request.method === 'POST') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
      if (kind === 'annul-purchase') {
        const v=body as Record<string,unknown>|null;
        const fields=['p_operacion_id','p_compra_gasto_id','p_motivo'];
        if(!id||!uuid.test(id)||!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==3||!fields.every(k=>Object.hasOwn(v,k))||v.p_compra_gasto_id!==id||typeof v.p_operacion_id!=='string'||!uuid.test(v.p_operacion_id)||typeof v.p_motivo!=='string'||!v.p_motivo.trim())return json({error:'Compra y motivo obligatorios.'},422);
        rpc='anular_compra_gasto_admin';args={...v,p_motivo:v.p_motivo.trim()};
      } else if (kind === 'summary-payment') {
        const v=body as Record<string,unknown>|null;
        const fields=['p_operacion_id','p_periodo_id','p_fecha_pago','p_importe','p_referencia'];
        const cents=v && typeof v.p_importe==='number'?paymentCents(String(v.p_importe)):null;
        if(!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).length!==fields.length || !fields.every(k=>Object.hasOwn(v,k)) || typeof v.p_operacion_id!=='string' || !uuid.test(v.p_operacion_id) || typeof v.p_periodo_id!=='string' || !uuid.test(v.p_periodo_id) || !validDate(v.p_fecha_pago) || cents===null || cents<=BigInt(0) || centsNumber(cents)===null || v.p_referencia!==null) return json({error:'Importe, fecha o período inválidos.'},422);
        rpc='registrar_pago_resumen_tarjeta_admin';args=v;
      } else if (kind === 'cards' || kind === 'periods' || kind === 'edit-card') {
        const v = body as Record<string, unknown> | null;
        const fields = kind === 'edit-card' ? ['p_operacion_id','p_tarjeta_id','p_nombre','p_entidad','p_nombre_anterior','p_entidad_anterior'] : kind === 'cards' ? ['p_operacion_id','p_nombre','p_entidad'] : ['p_operacion_id','p_tarjeta_id','p_fecha_cierre','p_fecha_vencimiento'];
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== fields.length || !fields.every(k => Object.hasOwn(v,k)) || typeof v.p_operacion_id !== 'string' || !uuid.test(v.p_operacion_id)) return json({error:'Solicitud inválida.'},422);
        if (kind === 'edit-card' && (typeof v.p_tarjeta_id !== 'string' || !uuid.test(v.p_tarjeta_id) || typeof v.p_nombre_anterior !== 'string' || typeof v.p_entidad_anterior !== 'string')) return json({error:'Identidad de tarjeta inválida.'},422);
        if ((kind === 'cards' || kind === 'edit-card') ? typeof v.p_nombre !== 'string' || !v.p_nombre.trim() || typeof v.p_entidad !== 'string' || !v.p_entidad.trim() : typeof v.p_tarjeta_id !== 'string' || !uuid.test(v.p_tarjeta_id) || !validDate(v.p_fecha_cierre) || !validDate(v.p_fecha_vencimiento) || v.p_fecha_vencimiento < v.p_fecha_cierre) return json({error:'Revisá nombre, entidad o fechas de cierre y vencimiento.'},422);
        rpc = kind === 'edit-card' ? 'editar_tarjeta_credito_admin' : kind === 'cards' ? 'crear_tarjeta_credito_admin' : 'registrar_periodo_tarjeta_admin'; args = v;
      } else {
        if (kind === 'supplier' ? !validateSupplier(body) : kind === 'financed' ? !validateFinancedPurchase(body) : !validatePurchase(body)) return json({ error: 'Revisá proveedor, fecha, ítems y distribución de pagos.' }, 422);
        rpc = kind === 'supplier' ? 'crear_proveedor_admin' : kind === 'financed' ? 'crear_compra_financiada_admin' : 'crear_compra_gasto_admin';
        args = body as unknown as Record<string, unknown>;
      }
    } else if (kind === 'cards') {
      rpc = 'listar_tarjetas_financieras_admin'; args = {};
    } else if ((kind === 'periods' || kind === 'summaries')) {
      const url = new URL(request.url); const card = url.searchParams.get('tarjeta_id'); const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!card || !uuid.test(card) || !Number.isSafeInteger(offset) || offset < 0) return json({ error: 'Tarjeta o paginación inválida.' }, 422);
      rpc = kind === 'summaries' ? 'listar_resumenes_tarjeta_admin' : 'listar_periodos_tarjeta_admin'; args = { p_tarjeta_id: card, p_limite: 100, p_offset: offset };
    } else if (kind === 'detail') {
      if (!id || !uuid.test(id)) return json({ error: 'Identificador inválido.' }, 400);
      rpc = 'obtener_compra_gasto_admin'; args = { p_compra_gasto_id: id };
    } else {
      const url = new URL(request.url);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: 'Paginación inválida.' }, 422);
      rpc = kind === 'supplier' ? 'buscar_proveedores_admin' : 'buscar_compras_gastos_admin';
      args = { p_limite: 50, p_offset: offset };
      if (kind === 'supplier') args.p_busqueda = url.searchParams.get('q') || null;
    }
    const result = await client.rpc(rpc, args);
    if (result.error) {
      console.error('Compras/gastos RPC', rpc, result.error.code);
      if(kind==='annul-purchase' && result.error.code==='23514') {
        const message=result.error.message || '';
        if(message==='La compra tiene pagos de tarjeta aplicados y requiere corrección financiera')return json({error:'La compra tiene pagos de tarjeta aplicados y requiere corrección financiera. No fue anulada.'},409);
        if(message==='La compra ya está anulada')return json({error:'La compra ya está anulada. Volvé a consultar el detalle.'},409);
      }
      if (result.error.code === '42501') return json({ error: 'Tu cuenta no tiene permisos de administración.' }, 403);
      return json({ error: request.method === 'POST' ? 'No se pudo confirmar el registro. Reintentá la misma solicitud.' : 'No se pudo consultar el registro.' }, request.method === 'POST' ? 502 : 400);
    }
    if (request.method === 'POST') {
      const data = result.data as Record<string, unknown> | null;
      const createdId = kind === 'summary-payment' ? data?.pago_id : (kind === 'cards' || kind === 'edit-card') ? data?.tarjeta_id : kind === 'periods' ? data?.periodo_id : kind === 'supplier' ? data?.id : kind === 'financed' ? data?.compra_id : data?.compra_gasto_id;
      if (kind==='annul-purchase' && (data?.estado!=='ANULADA'||data?.compra_gasto_id!==id||data?.operacion_id!==args.p_operacion_id))return json({error:'Resultado incierto. Reintentá la misma anulación.'},502);
      if ((kind === 'edit-card' && data?.tarjeta_id !== args.p_tarjeta_id) || (kind === 'financed' && data?.estado !== 'CONFIRMADA') || typeof createdId !== 'string' || !uuid.test(createdId) || ((kind === 'purchase' || kind === 'financed' || kind === 'cards' || kind === 'periods' || kind === 'edit-card' || kind === 'summary-payment') && data?.operacion_id !== args.p_operacion_id)) return json({ error: 'Respuesta incierta. Reintentá la misma solicitud.' }, 502);
    } else if (kind !== 'detail' && !Array.isArray(result.data)) return json({ error: 'No se pudo consultar el listado.' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'No pudimos confirmar el resultado. Reintentá la misma solicitud.' }, 502); }
}
