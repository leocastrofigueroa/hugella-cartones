// Local PostgreSQL WASM only. Never connects to Supabase or remote services.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
const actor = '00000000-0000-0000-0000-000000000999';
const credit = '00000000-0000-0000-0000-000000000001';

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    create function public.es_admin_hugella() returns boolean language sql stable as $$
      select coalesce(current_setting('test.admin', true), '') = 'yes'
    $$;
    create table public.pagos(
      id uuid primary key,
      credito_id uuid not null,
      fecha_pago date not null,
      importe numeric not null,
      medio_pago text not null,
      cuotas_aplicadas integer not null,
      remanente numeric not null,
      observaciones text,
      origen text,
      created_at timestamptz not null,
      estado text not null,
      motivo_anulacion text,
      anulado_at timestamptz
    );
  `);
  await db.exec(read('202609090005_obtener_historial_pagos_admin.sql'));
  await db.query(`insert into public.pagos values
    ('10000000-0000-0000-0000-000000000001',$1,date '2026-09-18',7600,'Efectivo',1,0,'Primero','ADMIN','2026-09-18 10:00:00-03','VALIDO',null,null),
    ('10000000-0000-0000-0000-000000000002',$1,date '2026-09-18',7600,'Transferencia',1,0,'Duplicado','SHEETS','2026-09-18 11:00:00-03','ANULADO','Carga duplicada','2026-09-20 12:30:00-03')`, [credit]);
  const paymentsBefore = (await db.query(`select * from public.pagos order by id`)).rows;
  await db.exec(read('202609200006_historial_pagos_anulados_admin.sql'));
  assert.deepEqual((await db.query(`select * from public.pagos order by id`)).rows, paymentsBefore);

  await db.exec(`set test.uid='${actor}'; set test.admin='yes';`);

  const rows = (await db.query(`select * from public.obtener_historial_pagos_admin($1)`, [credit])).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.estado, row.motivo_anulacion, row.anulado_at !== null]), [
    ['ANULADO', 'Carga duplicada', true],
    ['VALIDO', null, false],
  ]);
  assert.ok(rows.every(row => row.pago_id && row.created_at));

  const metadata = (await db.query(`select prosecdef, provolatile, proconfig from pg_proc
    where oid='public.obtener_historial_pagos_admin(uuid)'::regprocedure`)).rows[0];
  assert.deepEqual(metadata, { prosecdef: true, provolatile: 's', proconfig: ['search_path=""'] });
  assert.equal((await db.query(`select has_function_privilege('anon',
    'public.obtener_historial_pagos_admin(uuid)','EXECUTE') allowed`)).rows[0].allowed, false);
  assert.equal((await db.query(`select has_function_privilege('authenticated',
    'public.obtener_historial_pagos_admin(uuid)','EXECUTE') allowed`)).rows[0].allowed, true);

  await db.exec(`set test.admin='no';`);
  await assert.rejects(db.query(`select * from public.obtener_historial_pagos_admin($1)`, [credit]), /Admin access required/);

  console.log('PASS: admin history returns valid and annulled payments with audit fields and preserves security metadata and ACL.');
} finally {
  await db.close();
}
