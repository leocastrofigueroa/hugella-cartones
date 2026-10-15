import { createClient } from '@/utils/supabase/server';

// Presupuesto solicitado al hosting; su límite real debe verificarse al desplegar.
export const maxDuration = 60;

export async function GET(request: Request) {
  const mode = process.env.HUGELLA_IMPORTACION_COMPRAS_HISTORICAS;
  if (mode !== 'verificar' && mode !== 'habilitada') {
    return Response.json({ error: 'No disponible' }, { status: 404 });
  }
  if (new URL(request.url).search) {
    return Response.json({ error: 'La prueba no acepta parámetros' }, { status: 400 });
  }
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return Response.json({ error: 'Sesión requerida' }, { status: 401 });
  }
  // RPC STABLE, sólo lectura. No se invoca ningún importador.
  const result = await client.rpc('verificar_plazo_hg_admin', undefined, { get: true });
  if (result.error) {
    const denied = result.error.code === '42501' && result.error.message === 'No autorizado';
    return Response.json({ error: denied ? 'Acceso rechazado: se requiere administrador.'
      : 'Falló la prueba de plazo de sólo lectura; no se importó ningún dato.' },
    { status: denied ? 403 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
}
