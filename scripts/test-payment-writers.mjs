// Local PostgreSQL WASM only. Never connects to Supabase or remote services.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const adminPayment = async (creditId, amount) => (await db.query(
  `select * from public.registrar_pago_admin($1,date '2026-09-09',$2,' Efectivo ',' nota ')`,
  [creditId, amount]
)).rows[0];
const importWithoutReference = async (code, amount) => (await db.query(
  `select public.importar_pago_hugella($1,date '2026-09-09',$2,' Transferencia ',' nota ') as id`,
  [code, amount]
)).rows[0].id;
const importWithReference = async (code, amount, reference) => (await db.query(
  `select public.importar_pago_hugella($1,date '2026-09-09',$2,' Transferencia ',' nota ',$3) as id`,
  [code, amount, reference]
)).rows[0].id;
const paymentOrigin = async id => (await db.query(
  `select origen from public.pagos where id=$1`, [id]
)).rows[0].origen;
const countPayments = async creditId => (await db.query(
  `select count(*)::integer as count from public.pagos where credito_id=$1`, [creditId]
)).rows[0].count;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('test.role', true), '')
    $$;
    create function public.es_admin_hugella() returns boolean language sql stable as $$
      select coalesce(current_setting('test.admin', true), '') = 'yes'
    $$;
    create table public.creditos(
      id uuid primary key,
      codigo text not null unique,
      importe_cuota numeric not null,
      cantidad_cuotas integer not null,
      fecha_inicio date not null,
      estado text not null check (estado in ('AL DIA','ADELANTADO','ATRASADO','CANCELADO'))
    );
    create table public.pagos(
      id uuid primary key default gen_random_uuid(),
      credito_id uuid not null references public.creditos(id),
      fecha_pago date not null,
      importe numeric not null check (importe > 0),
      medio_pago text not null,
      cuotas_aplicadas integer not null default 0 check (cuotas_aplicadas >= 0),
      remanente numeric not null default 0 check (remanente >= 0),
      observaciones text,
      created_at timestamptz not null default clock_timestamp(),
      referencia_importacion text,
      estado text not null default 'VALIDO' check (estado in ('VALIDO','ANULADO')),
      origen text not null default 'ADMIN' check (origen in ('ADMIN','SHEETS'))
    );
    create unique index pagos_referencia_importacion_unique
      on public.pagos(referencia_importacion) where referencia_importacion is not null;
  `);
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(`create or replace function public.hugella_fecha_comercial()
    returns date language sql stable set search_path=''
    as $$select date '2026-09-09'$$;`);
  await db.exec(read('migrations/202609200001_recalcular_pagos_credito.sql'));

  // Installed-function fixture: CREATE OR REPLACE must preserve owner/ACL/contract.
  await db.exec(`
    create function public.importar_pago_hugella(
      p_codigo_credito text, p_fecha_pago date, p_importe numeric,
      p_medio_pago text, p_observaciones text default null::text)
      returns uuid language plpgsql volatile security definer set search_path=''
      as $$begin return null; end$$;
    create function public.importar_pago_hugella(
      p_codigo_credito text, p_fecha_pago date, p_importe numeric,
      p_medio_pago text, p_observaciones text default null::text,
      p_referencia_importacion text default null::text)
      returns uuid language plpgsql volatile security definer set search_path=''
      as $$begin return null; end$$;
    create function public.registrar_pago_admin(
      p_credito_id uuid, p_fecha_pago date, p_importe numeric,
      p_medio_pago text, p_observaciones text default null::text)
      returns table(pago_id uuid, cuotas_aplicadas integer, remanente numeric,
        cuotas_pagadas integer, cuotas_pendientes integer)
      language plpgsql volatile security definer set search_path=''
      as $$begin return; end$$;
    revoke all on function public.importar_pago_hugella(text,date,numeric,text,text) from public, anon;
    revoke all on function public.importar_pago_hugella(text,date,numeric,text,text,text) from public, anon;
    revoke all on function public.registrar_pago_admin(uuid,date,numeric,text,text) from public, anon;
    grant execute on function public.importar_pago_hugella(text,date,numeric,text,text) to authenticated;
    grant execute on function public.importar_pago_hugella(text,date,numeric,text,text,text) to authenticated;
    grant execute on function public.registrar_pago_admin(uuid,date,numeric,text,text) to authenticated;
  `);
  const signatures = [
    'public.importar_pago_hugella(text,date,numeric,text,text)',
    'public.importar_pago_hugella(text,date,numeric,text,text,text)',
    'public.registrar_pago_admin(uuid,date,numeric,text,text)'
  ];
  const metadata = async signature => (await db.query(
    `select to_jsonb(p)-'prosrc' as value from pg_proc p where p.oid=$1::regprocedure`, [signature]
  )).rows[0].value;
  const beforeMetadata = await Promise.all(signatures.map(metadata));
  await db.exec(read('migrations/202609200002_adaptar_escrituras_pagos_validos.sql'));
  assert.deepEqual(await Promise.all(signatures.map(metadata)), beforeMetadata);
  for (const signature of signatures) {
    assert.equal((await db.query(`select has_function_privilege('authenticated',$1,'EXECUTE') as allowed`,
      [signature])).rows[0].allowed, true);
  }

  // The Stage 3 replacement changes no pre-existing row and preserves every
  // function attribute and ACL outside the function source.
  await db.query(`insert into public.creditos values ($1,'PRE-1',5000,2,date '2026-09-07','AL DIA')`, [uuid(90)]);
  await db.query(`insert into public.pagos
    (id,credito_id,fecha_pago,importe,medio_pago,origen,referencia_importacion)
    values ($1,$2,date '2026-09-08',1000,'Efectivo','ADMIN',null)`, [uuid(91), uuid(90)]);
  const preexistingBefore = (await db.query(`select to_jsonb(pg) value from public.pagos pg where id=$1`,
    [uuid(91)])).rows[0].value;
  const beforeClassificationMetadata = await Promise.all(signatures.map(metadata));
  await db.exec(read('migrations/202609200003_clasificar_origen_importacion_sheets.sql'));
  assert.deepEqual(await Promise.all(signatures.map(metadata)), beforeClassificationMetadata);
  assert.deepEqual((await db.query(`select to_jsonb(pg) value from public.pagos pg where id=$1`,
    [uuid(91)])).rows[0].value, preexistingBefore);

  await db.exec(`set test.uid='${uuid(999)}'; set test.role='authenticated'; set test.admin='yes';`);

  // Admin: partial, accumulated installment and exact cancellation.
  await db.query(`insert into public.creditos values ($1,'ADM-1',5000,2,date '2026-09-07','AL DIA')`, [uuid(1)]);
  let result = await adminPayment(uuid(1), 3000);
  assert.equal(await paymentOrigin(result.pago_id), 'ADMIN');
  assert.deepEqual([result.cuotas_aplicadas, result.remanente, result.cuotas_pagadas, result.cuotas_pendientes],
    [0, '3000', 0, 2]);
  result = await adminPayment(uuid(1), 2000);
  assert.deepEqual([result.cuotas_aplicadas, result.remanente, result.cuotas_pagadas, result.cuotas_pendientes],
    [1, '0', 1, 1]);
  result = await adminPayment(uuid(1), 5000);
  assert.deepEqual([result.cuotas_aplicadas, result.remanente, result.cuotas_pagadas, result.cuotas_pendientes],
    [1, '0', 2, 0]);
  assert.equal((await db.query(`select estado from public.creditos where id=$1`, [uuid(1)])).rows[0].estado, 'CANCELADO');

  // Admin overpayment is rejected before insert.
  await db.query(`insert into public.creditos values ($1,'ADM-2',5000,2,date '2026-09-07','AL DIA')`, [uuid(2)]);
  await adminPayment(uuid(2), 6000);
  await assert.rejects(adminPayment(uuid(2), 5000), /supera el valor pendiente/);
  assert.equal(await countPayments(uuid(2)), 1);

  // Stored CANCELADO and annulled money do not prevent a valid new payment.
  await db.query(`insert into public.creditos values ($1,'ADM-3',5000,2,date '2026-09-07','CANCELADO')`, [uuid(3)]);
  await db.query(`insert into public.pagos(credito_id,fecha_pago,importe,medio_pago,cuotas_aplicadas,remanente,estado)
    values ($1,date '2026-09-07',3000,'Efectivo',0,3000,'VALIDO'),
           ($1,date '2026-09-08',7000,'Efectivo',2,0,'ANULADO')`, [uuid(3)]);
  result = await adminPayment(uuid(3), 2000);
  assert.deepEqual([result.cuotas_aplicadas, result.remanente, result.cuotas_pagadas], [1, '0', 1]);
  assert.equal((await db.query(`select estado from public.creditos where id=$1`, [uuid(3)])).rows[0].estado, 'ATRASADO');

  // The referenced overload remains idempotent.
  await db.query(`insert into public.creditos values ($1,'IMP-1',5000,3,date '2026-09-07','AL DIA')`, [uuid(4)]);
  const referencedId = await importWithReference('IMP-1', 3000, 'SHEETS-PG-000001');
  assert.ok(referencedId);
  assert.equal(await paymentOrigin(referencedId), 'SHEETS');
  assert.equal(await importWithReference('IMP-1', 3000, 'SHEETS-PG-000001'), referencedId);
  assert.equal(await paymentOrigin(referencedId), 'SHEETS');
  assert.equal(await countPayments(uuid(4)), 1);

  // An annulled reference is an explicit error and is never recreated.
  await db.query(`update public.pagos set estado='ANULADO' where id=$1`, [referencedId]);
  await assert.rejects(importWithReference('IMP-1', 3000, 'SHEETS-PG-000001'),
    /La referencia de importación corresponde a un pago anulado/);
  assert.equal(await countPayments(uuid(4)), 1);

  // The import insert rolls back when the central engine detects overpayment.
  await db.query(`insert into public.creditos values ($1,'IMP-2',5000,2,date '2026-09-07','AL DIA')`, [uuid(5)]);
  await assert.rejects(importWithReference('IMP-2', 11000, 'SHEETS-PG-OVER'),
    /Valid payments exceed credit total/);
  assert.equal(await countPayments(uuid(5)), 0);
  assert.equal((await db.query(`select count(*)::integer count from public.pagos
    where credito_id=$1
      and (referencia_importacion='SHEETS-PG-OVER' or origen='SHEETS')`,
  [uuid(5)])).rows[0].count, 0);

  // An explicit six-argument call with NULL remains an ADMIN payment.
  await db.query(`insert into public.creditos values ($1,'IMP-NULL',5000,3,date '2026-09-07','AL DIA')`, [uuid(7)]);
  const explicitNullId = await importWithReference('IMP-NULL', 1000, null);
  assert.equal(await paymentOrigin(explicitNullId), 'ADMIN');

  // PostgreSQL considers a five-argument positional call ambiguous while the
  // six-argument overload has defaults. Remove only that overload in this
  // isolated fixture to execute and verify the legacy five-argument body.
  await db.exec(`drop function public.importar_pago_hugella(text,date,numeric,text,text,text)`);
  await db.query(`insert into public.creditos values ($1,'IMP-3',5000,3,date '2026-09-07','AL DIA')`, [uuid(6)]);
  const noReferenceId = await importWithoutReference('IMP-3', 2000);
  assert.ok(noReferenceId);
  assert.equal(await paymentOrigin(noReferenceId), 'ADMIN');
  assert.equal(await countPayments(uuid(6)), 1);

  // The internal engine stays inaccessible to the application role.
  assert.equal((await db.query(`select has_function_privilege(
    'authenticated','public.recalcular_pagos_credito(uuid)','EXECUTE') as allowed`)).rows[0].allowed, false);

  console.log('PASS: valid-only admin/import writes, centralized recalculation, exact cancellation, stale CANCELADO recovery, idempotent references, annulled-reference error, rollback and preserved RPC metadata/ACL.');
} finally {
  await db.close();
}
