// Local PostgreSQL WASM only. Never connects to Supabase or executes real payments.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url),'utf8');
const migration = read('migrations/202609090004_buscar_creditos_admin_estado_efectivo.sql');
const rpc = async query => (await db.query('select * from public.buscar_creditos_admin($1)',[query])).rows;
const metadata = async () => (await db.query(`select to_jsonb(p)-'prosrc' as metadata from pg_proc p where oid='public.buscar_creditos_admin(text)'::regprocedure`)).rows[0].metadata;
const source = async () => (await db.query(`select prosrc from pg_proc where oid='public.buscar_creditos_admin(text)'::regprocedure`)).rows[0].prosrc;
try {
  await db.exec('create role anon; create role authenticated;');
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(read('tests/buscar_creditos_admin_fixture.sql'));
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-07'$$;
    set test.uid='11111111-1111-1111-1111-111111111111'; set test.admin='yes';
    insert into clientes values ('11111111-1111-1111-1111-111111111111','Cliente Local');
    insert into creditos select md5(i::text)::uuid,'11111111-1111-1111-1111-111111111111',
      'HG-'||lpad(i::text,2,'0'),'Producto',100,30,'HISTORICO',date '2026-09-07'
      from generate_series(1,25) as g(i);
    insert into pagos values
      ('partial',md5('1')::uuid,0),('one',md5('2')::uuid,1),
      ('advance',md5('3')::uuid,2),('complete',md5('4')::uuid,30),
      ('excess',md5('5')::uuid,35),('null',md5('6')::uuid,null),
      ('negative',md5('7')::uuid,-1),('part1',md5('8')::uuid,0),('part2',md5('8')::uuid,1);`);
  const beforeMeta=await metadata(), beforeSource=await source();
  const beforeAll=await rpc('Cliente');
  const queries=['HG-2','Cliente','HG-01',' HG-02 '];
  const beforeQueries=await Promise.all(queries.map(rpc));
  await db.exec(migration);
  assert.deepEqual(await metadata(),beforeMeta);
  const afterSource=await source();
  // Prove the only source changes are the state expression and GROUP BY field.
  const restored=afterSource.replace(/public\.hugella_estado_credito\([\s\S]*?\)::text/, 'cr.estado::text')
    .replace(/(group by[^;]*?)cr\.fecha_inicio/i,'$1cr.estado');
  assert.equal(restored,beforeSource);
  assert(!/cr\.estado/.test(afterSource)); assert(/cr\.fecha_inicio/.test(afterSource));
  const withoutState=rows=>rows.map(row=>{ const fields={...row}; delete fields.estado; return fields; });
  assert.deepEqual(withoutState(await rpc('Cliente')),withoutState(beforeAll));
  for(let i=0;i<queries.length;i++) assert.deepEqual(withoutState(await rpc(queries[i])),withoutState(beforeQueries[i]));
  for(const [code,state] of [['HG-01','ATRASADO'],['HG-02','AL DIA'],['HG-03','ADELANTADO'],['HG-04','CANCELADO'],['HG-05','CANCELADO']]) assert.equal((await rpc(code))[0].estado,state);
  // HG-20..25 also match HG-2; exact HG-2 must precede every partial match.
  await db.exec(`insert into creditos values (md5('26')::uuid,'11111111-1111-1111-1111-111111111111','HG-2','Producto',100,30,'HISTORICO',date '2026-09-07');`);
  assert.equal((await rpc('HG-2'))[0].codigo_credito,'HG-2');
  assert.equal((await rpc('Cliente')).length,20);
  await assert.rejects(rpc('   '), /Empty search/);
  await db.exec('set role anon'); await assert.rejects(rpc('HG-01'), /permission denied/); await db.exec('reset role');
  await db.exec("set role authenticated; set test.admin='no'"); await assert.rejects(rpc('HG-01'), /Admin required/);
  await db.exec("set test.admin='yes'; set test.uid=''"); await assert.rejects(rpc('HG-01'), /Authentication required/);
  await db.exec("set test.uid='11111111-1111-1111-1111-111111111111'"); assert.equal((await rpc('HG-02'))[0].estado,'AL DIA');
  await db.exec('reset role');
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-08'$$;`);
  const nextDay=(await rpc('HG-02'))[0]; assert.equal(nextDay.estado,'ATRASADO'); assert.equal(nextDay.cuotas_pagadas,1);
  // Second application fails closed (already migrated) and preserves metadata/source.
  await assert.rejects(db.exec(migration),/Review required/);
  assert.deepEqual(await metadata(),beforeMeta); assert.equal(await source(),afterSource);
  console.log('PASS: all 10 requested cases; empty search, anon, absent auth, partial/null/negative/excess allocations; exact source delta; identical pg_proc metadata including ACL/owner/contract; safe abort on unexpected/already updated source.');
} finally {await db.close();}
