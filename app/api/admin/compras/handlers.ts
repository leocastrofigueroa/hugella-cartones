import { createClient } from '@/utils/supabase/server';
import { validatePurchase, validateSupplier, uuid } from '@/app/admin/compras/purchase-types';
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
export async function handle(request: Request, kind: 'supplier' | 'purchase' | 'detail', id?: string) {
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
      if (kind === 'supplier' ? !validateSupplier(body) : !validatePurchase(body)) return json({ error: 'Revisá proveedor, fecha, cantidad y costo.' }, 422);
      rpc = kind === 'supplier' ? 'crear_proveedor_admin' : 'crear_compra_gasto_admin';
      args = body as unknown as Record<string, unknown>;
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
      if (result.error.code === '42501') return json({ error: 'Tu cuenta no tiene permisos de administración.' }, 403);
      return json({ error: request.method === 'POST' ? 'No se pudo confirmar el registro. Reintentá la misma solicitud.' : 'No se pudo consultar el registro.' }, request.method === 'POST' ? 502 : 400);
    }
    if (request.method === 'POST') {
      const data = result.data as Record<string, unknown> | null;
      const createdId = kind === 'supplier' ? data?.id : data?.compra_gasto_id;
      if (typeof createdId !== 'string' || !uuid.test(createdId) || (kind === 'purchase' && data?.operacion_id !== args.p_operacion_id)) return json({ error: 'Respuesta incierta. Reintentá la misma solicitud.' }, 502);
    } else if (kind !== 'detail' && !Array.isArray(result.data)) return json({ error: 'No se pudo consultar el listado.' }, 502);
    return json({ result: result.data });
  } catch { return json({ error: 'No pudimos confirmar el resultado. Reintentá la misma solicitud.' }, 502); }
}
