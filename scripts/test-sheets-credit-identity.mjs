import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/202610080001_proteger_identidad_credito_sheets.sql', import.meta.url), 'utf8');
const mansilla = '564428ef-070a-440b-9267-a05c375befa6';
const guajardo = '91fb221b-8a06-42a5-94c5-2b10fbc2f0d0';
// Exact production body supplied by the user, including JSON return and search_path.
const original = `-- Literal supplied by the user; local test fixture only. Never deploy this unsafe original.
CREATE OR REPLACE FUNCTION public.actualizar_credito_desde_sheets(
  p_codigo text,
  p_nombre text,
  p_dni text,
  p_telefono text,
  p_domicilio text,
  p_producto text,
  p_fecha_inicio date,
  p_cantidad_cuotas integer,
  p_importe_cuota numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_credito_id uuid;
  v_cliente_id uuid;
begin

  select
    id,
    cliente_id
  into
    v_credito_id,
    v_cliente_id
  from public.creditos
  where codigo = p_codigo
  limit 1;

  if v_credito_id is null then
    raise exception 'No existe el crédito %', p_codigo;
  end if;

  if v_cliente_id is null then
    raise exception 'El crédito % no tiene cliente asociado', p_codigo;
  end if;

  update public.clientes
  set
    nombre = p_nombre,
    dni = p_dni,
    telefono = p_telefono,
    domicilio = p_domicilio
  where id = v_cliente_id;

  update public.creditos
  set
    producto = p_producto,
    fecha_inicio = p_fecha_inicio,
    cantidad_cuotas = p_cantidad_cuotas,
    importe_cuota = p_importe_cuota
  where id = v_credito_id;

  return jsonb_build_object(
    'ok', true,
    'codigo', p_codigo,
    'credito_id', v_credito_id,
    'cliente_id', v_cliente_id
  );

end;
$function$;
`;
const snapshot = async () => (await db.query(`select
 (select jsonb_agg(to_jsonb(c) order by id) from clientes c) as clientes,
 (select jsonb_agg(to_jsonb(c) order by id) from creditos c) as creditos`)).rows;
const call = (overrides = {}) => {
 const p = { code: 'CR-0046', name: 'GUAJARDO SOLEDAD', dni: '27904656',
   phone: 'NO ESCRIBIR', address: 'NO ESCRIBIR', product: 'Producto actualizado',
   date: '2026-10-08', count: 12, amount: 1500, ...overrides };
 return db.query(`select public.actualizar_credito_desde_sheets($1,$2,$3,$4,$5,$6,$7::date,$8::integer,$9::numeric)`, Object.values(p));
};
async function rejected(parameters, pattern) {
 const before = await snapshot();
 await assert.rejects(call(parameters), pattern);
 assert.deepEqual(await snapshot(), before);
}
try {
 await db.exec(`create table clientes(id uuid primary key, nombre text not null, dni text, telefono text, domicilio text);
 create table creditos(id uuid primary key default gen_random_uuid(),codigo text,cliente_id uuid references clientes,
 producto text,fecha_inicio date,cantidad_cuotas integer,importe_cuota numeric,
 access_token uuid default gen_random_uuid(),estado text default 'AL DIA',created_at timestamptz default now());
 create role authenticated;
 create role denied;`);
 await db.query(`insert into clientes values ($1,'MANSILLA LAURA','25136933','2634-956427','Ruta 50'),($2,'GUAJARDO SOLEDAD','27904656','2634-651241','Domicilio Guajardo')`, [mansilla, guajardo]);
 for (const code of ['CR-0005','CR-0023','CR-0045','CR-0046']) {
   await db.query(`insert into creditos(codigo,cliente_id,producto,fecha_inicio,cantidad_cuotas,importe_cuota) values ($1,$2,'Original','2026-10-07',10,1000)`, [code, code === 'CR-0046' ? guajardo : mansilla]);
 }
 await db.exec(original);
 await db.exec(`revoke all on function public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric) from public;
 grant execute on function public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric) to authenticated;`);
 const metadata = async () => (await db.query(`select to_jsonb(p)-'prosrc' as metadata from pg_proc p where proname='actualizar_credito_desde_sheets'`)).rows;
 const beforeMetadata = await metadata();
 await db.exec(migration);
 assert.deepEqual(await metadata(), beforeMetadata);
 const installed = (await db.query(`select prosrc,prosecdef,proconfig,pg_get_function_result(oid) as result from pg_proc where proname='actualizar_credito_desde_sheets'`)).rows[0];
 assert.equal(installed.result, 'jsonb');
 assert.equal(installed.prosecdef, true);
 assert.deepEqual(installed.proconfig, ['search_path=public']);
 assert.doesNotMatch(installed.prosrc, /update\s+public\.clientes/i);
 assert.ok(installed.prosrc.indexOf('sheet_dni :=') < installed.prosrc.indexOf('update public.creditos'));
 assert.ok(installed.prosrc.indexOf('sheet_name :=') < installed.prosrc.indexOf('update public.creditos'));
 await rejected({ name: 'MANSILLA LAURA', dni: '25136933' }, /CR-0046.*DNI/);
 await rejected({ name: 'MANSILLA LAURA' }, /CR-0046.*nombre/);
 for (const dni of ['', null, '---']) await rejected({ dni }, /DNI/);
 for (const name of ['', null, '   ']) await rejected({ name }, /nombre/);
 for (const parameters of [{product:''},{product:' \t '},{date:null},{date:'infinity'},
   {count:0},{count:-1},{count:null},{amount:0},{amount:-1},{amount:null},{amount:'NaN'},{amount:'Infinity'}]) {
   await rejected(parameters, /inválido/);
 }
 await rejected({code:'CR-9999'}, /No existe/);
 await db.exec('set role denied');
 await assert.rejects(call(), /permission denied/);
 await db.exec('reset role');
 const before = (await snapshot())[0];
 await db.exec('set role authenticated');
 const result = await call({name:'  guajardo   soledad\t', dni:'27.904.656'});
 await db.exec('reset role');
 assert.deepEqual(result.rows[0].actualizar_credito_desde_sheets, {ok:true,codigo:'CR-0046',credito_id:before.creditos.find(c=>c.codigo==='CR-0046').id,cliente_id:guajardo});
 const after = (await snapshot())[0];
 assert.deepEqual(after.clientes, before.clientes);
 const allowed = ['producto','fecha_inicio','cantidad_cuotas','importe_cuota'];
 for (const old of before.creditos) {
   const updated = after.creditos.find(c => c.id === old.id);
   if (old.codigo !== 'CR-0046') assert.deepEqual(updated, old);
   else {
     assert.equal(updated.producto, 'Producto actualizado');
     assert.equal(updated.fecha_inicio, '2026-10-08');
     assert.equal(updated.cantidad_cuotas, 12);
     assert.equal(updated.importe_cuota, 1500);
     for (const key of Object.keys(old).filter(k => !allowed.includes(k))) assert.deepEqual(updated[key], old[key]);
   }
 }
 await db.query(`update clientes set dni=null where id=$1`, [guajardo]);
 await rejected({}, /DNI/);
 await db.query(`update clientes set dni='27904656' where id=$1`, [guajardo]);
 await db.exec(`insert into creditos(codigo,cliente_id) select codigo,cliente_id from creditos where codigo='CR-0046'`);
 await rejected({}, /ambiguo/);
 // A second application must abort rather than accidentally patch another write.
 await assert.rejects(db.exec(migration), /no compatible/);
 await db.exec('rollback');
 assert.deepEqual(await metadata(), beforeMetadata);
 // Unexpected source must remain untouched after the migration fails.
 await db.exec(original.replace('producto = p_producto,', 'producto = trim(p_producto),'));
 const source = async () => (await db.query(`select prosrc from pg_proc where proname='actualizar_credito_desde_sheets'`)).rows;
 const unexpected = await source();
 await assert.rejects(db.exec(migration), /no compatible/);
 await db.exec('rollback');
 assert.deepEqual(await source(), unexpected);
 // Formatting variants: indentation, CRLF, keyword case and spacing around '='.
 await db.exec(original.replaceAll('update public.', 'UPDATE public.')
   .replaceAll(' = ', '=').replaceAll('\n', '\r\n    '));
 const formattedMetadata = await metadata();
 await db.exec(migration);
 assert.deepEqual(await metadata(), formattedMetadata);
 assert.doesNotMatch((await source())[0].prosrc, /update\s+public\.clientes/i);
 console.log('PASS: identity regression, normalization, invalid inputs, authorization, unchanged clients/other credits, allowed fields only, metadata/ACL, unsupported migration rollback.');
} finally { await db.close(); }
