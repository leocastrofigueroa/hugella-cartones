// PostgreSQL WASM in memory only: no Supabase, URLs or production data.
// HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-valid-payment-queries.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const migration = read('migrations/202609210001_excluir_pagos_anulados_consultas.sql');
const client = '11111111-1111-1111-1111-111111111111';
const credit = '22222222-2222-2222-2222-222222222222';
const token = '33333333-3333-3333-3333-333333333333';
const signatures = ['buscar_creditos_admin(text)', 'acceder_creditos_cliente(text,text)', 'get_carton_publico(uuid)'];
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const catalog = () => rows(`select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc as source
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','auth') order by p.oid`);
const payments = () => rows('select * from public.pagos order by id');
const admin = () => rows("select * from public.buscar_creditos_admin('CR-0030')");
const access = () => rows("select * from public.acceder_creditos_cliente('12345678','4321')");
const card = async () => (await rows('select public.get_carton_publico($1) as card', [token]))[0].card;

async function check(paid, state, paymentCount) {
  const result = await admin();
  assert.equal(result.length, 1, 'LEFT JOIN must retain the credit');
  assert.deepEqual([result[0].cuotas_pagadas, result[0].cuotas_pendientes, result[0].estado], [paid, 3 - paid, state]);
  assert.equal((await access())[0].estado, state);
  const publicCard = await card();
  assert.deepEqual([publicCard.cuotas_pagadas, publicCard.cuotas_pendientes, publicCard.estado, publicCard.pagos.length],
    [paid, 3 - paid, state, paymentCount]);
  return publicCard;
}

try {
  await db.exec('create role anon; create role authenticated;');
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(read('tests/buscar_creditos_admin_fixture.sql'));
  await db.exec(read('migrations/202609090004_buscar_creditos_admin_estado_efectivo.sql'));
  await db.exec(`alter table public.clientes add column dni text, add column telefono text;
    alter table public.creditos add column access_token uuid;
    alter table public.pagos add column estado text not null default 'VALIDO',
      add column fecha_pago date, add column medio_pago text, add column importe numeric,
      add column created_at timestamptz, add column remanente numeric;
    create or replace function public.hugella_fecha_comercial() returns date
      language sql stable set search_path='' as $$select date '2026-09-07'$$;
    set test.uid='${client}'; set test.admin='yes';
    insert into public.clientes values ('${client}','Cliente Local','12345678','2615554321');
    insert into public.creditos values ('${credit}','${client}','CR-0030','Producto',100,3,'ATRASADO',date '2026-09-07','${token}');
    insert into public.pagos values ('pago-local','${credit}',1,'VALIDO',date '2026-09-07','Efectivo',100,now(),0);`);
  await db.exec(read('migrations/202609080001_get_carton_publico.sql'));
  await db.exec(read('migrations/202609090003_get_carton_estado_efectivo.sql'));
  // Local reference fixture only; the full production access RPC is not versioned.
  // The migration must preserve these authentication/search bytes unchanged.
  await db.exec(`create function public.acceder_creditos_cliente(p_dni text, p_ultimos4 text)
    returns table(access_token uuid, codigo text, producto text, estado text)
    language sql stable security definer set search_path='' as $$
      select cr.access_token, cr.codigo, cr.producto,
        public.hugella_estado_credito(cr.cantidad_cuotas,
          coalesce((select sum(coalesce(pg.cuotas_aplicadas,0)) from public.pagos as pg
            where pg.credito_id = cr.id),0)::bigint,
          public.hugella_cuotas_exigibles(cr.fecha_inicio,cr.cantidad_cuotas))
      from public.creditos as cr join public.clientes as cl on cl.id=cr.cliente_id
      where cl.dni=p_dni and right(cl.telefono,4)=p_ultimos4
      order by cr.codigo limit 20;
    $$;
    revoke all on function public.acceder_creditos_cliente(text,text) from public, authenticated;
    grant execute on function public.acceder_creditos_cliente(text,text) to anon;`);

  const validBefore = await check(1, 'AL DIA', 1);
  await db.exec("update public.pagos set estado='ANULADO' where id='pago-local'");
  await check(1, 'AL DIA', 1); // Reproduce the bug in all three original RPCs.
  const before = await catalog(), dataBefore = await payments();
  const targetOids = (await rows('select to_regprocedure(signature)::oid as oid from unnest($1::text[]) signature', [signatures])).map(row => row.oid);

  await db.exec(migration);
  const after = await catalog();
  assert.deepEqual(await payments(), dataBefore, 'Migration must not mutate payment rows');
  assert.deepEqual(after.map(row => row.metadata), before.map(row => row.metadata), 'All pg_proc metadata, ACL, owner, signatures and search_path preserved');
  for (let i = 0; i < before.length; i++) {
    if (targetOids.includes(before[i].oid)) {
      assert.notEqual(after[i].source, before[i].source);
      assert.equal(after[i].source.replaceAll(" and pg.estado = 'VALIDO'", ''), before[i].source, 'Only predicates were inserted');
    } else {
      assert.deepEqual(after[i], before[i], 'No other RPC or helper changed');
    }
  }
  await check(0, 'ATRASADO', 0);
  assert.deepEqual((await payments()).map(p => [p.id, p.estado, p.cuotas_aplicadas, p.remanente]), [['pago-local', 'ANULADO', 1, '0']]);

  await db.exec("update public.pagos set estado='VALIDO' where id='pago-local'");
  assert.deepEqual(await check(1, 'AL DIA', 1), validBefore, 'Valid-payment JSON is unchanged');
  await db.exec("update public.pagos set estado='ANULADO' where id='pago-local'");
  await check(0, 'ATRASADO', 0); // Same payment stops counting, but remains stored.
  await db.exec(`insert into public.pagos values ('otro-valido','${credit}',1,'VALIDO',date '2026-09-07','Transferencia',100,now(),0)`);
  const mixed = await check(1, 'AL DIA', 1);
  assert.equal(mixed.pagos[0].medio_pago, 'Transferencia');
  assert.equal((await payments()).length, 2);

  await db.exec('set role anon');
  assert.equal((await card()).cuotas_pagadas, 1);
  assert.equal((await access())[0].estado, 'AL DIA');
  assert.deepEqual(await rows("select * from public.acceder_creditos_cliente('12345678','0000')"), []);
  await assert.rejects(admin(), /permission denied/);
  await assert.rejects(rows('select * from public.pagos'), /permission denied/);
  await db.exec("reset role; set role authenticated; set test.admin='no'");
  await assert.rejects(admin(), /Admin required/);
  await db.exec("set test.admin='yes'; set test.uid=''");
  await assert.rejects(admin(), /Authentication required/);
  await db.exec(`set test.uid='${client}'`);
  assert.equal((await admin())[0].cuotas_pagadas, 1);
  await assert.rejects(card(), /permission denied/);
  await assert.rejects(access(), /permission denied/);
  await db.exec('reset role');

  await assert.rejects(db.exec(migration), /Revisión requerida/);
  assert.deepEqual(await catalog(), after, 'Second application fails without changes');

  // Roll back all three patches when the final RPC has an unexpected shape.
  const definitions = await rows('select pg_get_functiondef(to_regprocedure(signature)) as ddl from unnest($1::text[]) signature', [signatures]);
  for (const { ddl } of definitions) await db.exec(ddl.replaceAll(" and pg.estado = 'VALIDO'", ''));
  const publicDDL = definitions[2].ddl.replaceAll(" and pg.estado = 'VALIDO'", '')
    .replaceAll('where pg.credito_id = cr.id', 'where cr.id = pg.credito_id');
  await db.exec(publicDDL);
  const unexpectedBefore = await catalog();
  await assert.rejects(db.exec(migration), /Revisión requerida/);
  assert.deepEqual(await catalog(), unexpectedBefore, 'Unexpected last RPC rolls back earlier patches atomically');
  console.log('PASS: valid/annulled/mixed payments; all three RPCs; public JSON; retained historical rows; exact four-filter delta; unchanged metadata/ACL/auth; atomic rollback and repeat rejection.');
} finally {
  await db.close();
}
