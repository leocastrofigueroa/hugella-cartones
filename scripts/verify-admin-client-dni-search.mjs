// Prueba manual remota: ejecutar SOLO tras verificar la definición instalada.
// Usa un access token de la sesión Admin existente; nunca service_role.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

async function prompt(label, hidden = false) {
  // readline debe gestionar el prompt visible para no borrarlo al redibujar.
  // Las instrucciones de entrada oculta quedan en una línea independiente.
  if (hidden) console.log(`${label}\nLa entrada no se verá. Pegá/escribí el dato y presioná Enter.`);
  const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    return (await rl.question(hidden ? '' : label)).trim();
  } finally {
    rl.close();
    if (hidden) process.stdout.write('\n');
  }
}

const normalize = value => value.replace(/[^0-9]/g, '');

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Ejecutar interactivamente en una terminal; no pasar tokens como argumentos.');
  }
  const config = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8'));
  const url = new URL(config.NEXT_PUBLIC_SUPABASE_URL);
  const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || !key) {
    throw new Error('Configuración pública de Supabase inválida.');
  }
  // Solo se usan estas dos variables públicas. No se usa SUPABASE_SECRET_KEY.
  console.log(`Destino: ${url.origin}`);
  const confirmation = await prompt('¿Verificaste la definición de la RPC y este proyecto? Escribí VERIFICADO y presioná Enter: ');
  if (confirmation !== 'VERIFICADO') throw new Error('Prueba cancelada sin solicitudes remotas.');

  const token = await prompt('Ingresá únicamente el access token de la sesión Admin, sin el prefijo Bearer (entrada oculta):', true);
  if (/^Bearer\s/i.test(token)) {
    throw new Error('Pegá únicamente el access token, sin Bearer ni el nombre del encabezado Authorization.');
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('El access token debe ser un JWT completo, sin espacios, comillas ni encabezados.');
  }
  let claims;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Access token JWT inválido.');
  }
  if (claims.role !== 'authenticated' || !claims.sub || !Number.isFinite(claims.exp)
    || claims.exp <= Date.now() / 1000) {
    throw new Error('Se requiere una sesión authenticated vigente; no se admite service_role.');
  }
  // La decodificación anterior no autentica: Supabase valida el JWT en cada llamada.
  const existing = normalize(await prompt('Ingresá el DNI de un cliente existente, de 7 a 9 dígitos (entrada oculta):', true));
  const missing = normalize(await prompt('Ingresá un DNI confirmado inexistente, de 7 a 9 dígitos (entrada oculta):', true));
  if (!/^[0-9]{7,9}$/.test(existing) || !/^[0-9]{7,9}$/.test(missing) || existing === missing) {
    throw new Error('Se requieren dos DNI distintos, de 7 a 9 dígitos.');
  }
  const endpoint = new URL('/rest/v1/rpc/buscar_cliente_por_dni_admin', url);
  const lookup = async dni => {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_dni: dni }),
    });
    if (!response.ok) {
      throw new Error(`La búsqueda falló (HTTP ${response.status}); no se muestran respuestas privadas.`);
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !row || typeof row !== 'object'
      || Object.keys(row).sort().join(',') !== 'dni,domicilio,id,nombre,telefono')) {
      throw new Error('Respuesta RPC inesperada; contenido omitido.');
    }
    return rows;
  };

  // Exactamente tres llamadas de búsqueda, sin login, refresh ni escritores.
  const exact = await lookup(existing);
  if (exact.length !== 1 || normalize(exact[0].dni ?? '') !== existing) {
    throw new Error('El DNI indicado como existente no devolvió un cliente coherente.');
  }
  const formatted = await lookup(existing.split('').join(' '));
  try { assert.deepEqual(formatted, exact); }
  catch { throw new Error('La búsqueda formateada no coincide; datos privados omitidos.'); }
  const absent = await lookup(missing);
  if (absent.length !== 0) throw new Error('El DNI indicado como inexistente devolvió un cliente.');
  console.log('PASS: existente=1; mismo DNI con espacios=mismo resultado; inexistente=0.');
  console.log('Solo se invocó buscar_cliente_por_dni_admin; sin solicitudes de escritura.');
}

main().catch(error => {
  console.error(error instanceof Error && error.name !== 'AssertionError'
    ? error.message : 'Prueba fallida; detalles privados omitidos.');
  process.exitCode = 1;
});
