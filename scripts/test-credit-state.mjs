// Local-only PostgreSQL WASM runner. No URLs, credentials, or remote connections.
// HUGELLA_TEST_DEPS=/absolute/path/to/node_modules node scripts/test-credit-state.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const sql = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const constraint = sql('migrations/202609090002_creditos_estado_check.sql');
try {
  await db.exec(`create role anon; create role authenticated;
    create table public.clientes(id uuid primary key, nombre text);
    create table public.creditos(id uuid primary key, cliente_id uuid, codigo text, producto text,
      fecha_inicio date, cantidad_cuotas integer, importe_cuota numeric, access_token uuid,
      estado text check(estado in ('AL DIA','ATRASADO','CANCELADO')));
    create table public.pagos(id text primary key, credito_id uuid, fecha_pago date,
      medio_pago text, importe numeric, cuotas_aplicadas integer, remanente numeric, created_at timestamptz);`);
  await db.exec(sql('migrations/202609080001_get_carton_publico.sql'));
  const aclBefore = (await db.query(`select proacl::text from pg_proc where oid='public.get_carton_publico(uuid)'::regprocedure`)).rows;
  await db.exec(sql('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(constraint);
  await db.exec(sql('migrations/202609090003_get_carton_estado_efectivo.sql'));
  assert.deepEqual((await db.query(`select proacl::text from pg_proc where oid='public.get_carton_publico(uuid)'::regprocedure`)).rows, aclBefore);
  await db.exec(sql('tests/estado_efectivo.sql'));
  console.log('PASS: cases 1–10, calendar property checks, Mendoza timezone, preserved RPC ACL.');

  const client='11111111-1111-1111-1111-111111111111', credit='22222222-2222-2222-2222-222222222222', token='33333333-3333-3333-3333-333333333333';
  await db.exec(`insert into clientes values ('${client}', 'Cliente de prueba local');
    insert into creditos values ('${credit}','${client}','HG-LOCAL','Producto',public.hugella_fecha_comercial(),30,100,'${token}','CANCELADO');
    insert into pagos values ('PG-LOCAL','${credit}',public.hugella_fecha_comercial(),'Efectivo',40,0,40,now());`);
  // Fixed start date is a valid Monday; fixture-only clock override for determinism.
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-07'$$;
    update creditos set fecha_inicio='2026-09-07';`);
  const card = async () => (await db.query('select public.get_carton_publico($1) as card',[token])).rows[0].card;
  let result=await card();
  assert.equal(result.cuotas_pagadas,0); assert.equal(result.estado,'ATRASADO');
  // Recorded allocations represent the EXISTING monetary engine's output:
  // 40 + 70 = one installment of 100 and remanente 10. We do not reimplement it.
  await db.exec(`insert into pagos values ('ADM-LOCAL','${credit}',date '2026-09-07','Efectivo',70,1,10,now());`);
  result=await card();
  assert.equal(result.cuotas_pagadas,1); assert.equal(result.cuotas_pendientes,29); assert.equal(result.estado,'AL DIA');
  assert.equal(result.pagos.length,2);
  assert.equal((await db.query(`select remanente from pagos where id='ADM-LOCAL'`)).rows[0].remanente,'10');
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-08'$$;`);
  assert.equal((await card()).estado,'ATRASADO');
  assert.deepEqual(Object.keys(result).sort(), ['nombre_cliente','codigo_credito','producto','fecha_inicio','cantidad_cuotas','importe_cuota','estado','cuotas_pagadas','cuotas_pendientes','pagos'].sort());
  await db.exec('set role anon');
  assert.equal((await card()).cuotas_pagadas,1);
  for (const table of ['clientes','creditos','pagos']) await assert.rejects(db.query(`select * from public.${table}`));
  await assert.rejects(db.query(`insert into pagos(id) values ('forbidden')`));
  assert.equal((await db.query('select public.get_carton_publico($1) as card',['44444444-4444-4444-4444-444444444444'])).rows[0].card,null);
  await db.exec('reset role');
  await db.exec(`update creditos set estado='ADELANTADO'`);
  await assert.rejects(db.exec(`update creditos set estado='UNKNOWN'`));
  console.log('PASS: cases 11–12 (recorded partial allocations), no-payment next-day change, exact public fields, anon read-only, ADELANTADO CHECK.');

  // Unknown CHECK must survive an aborted migration unchanged.
  await db.exec(`alter table creditos drop constraint creditos_estado_check;
    alter table creditos add constraint custom_check check (estado <> 'UNKNOWN');`);
  await assert.rejects(db.exec(constraint), /Review required/);
  assert.equal((await db.query(`select count(*)::int as n from pg_constraint where conname='custom_check'`)).rows[0].n,1);
  console.log('PASS: unknown constraint fails closed without dropping it.');
} finally { await db.close(); }
