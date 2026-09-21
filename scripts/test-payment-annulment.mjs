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
const payment = n => `${(0x10000000 + n).toString(16).padStart(8, '0')}-0000-0000-0000-${String(n).padStart(12, '0')}`;
const operation = n => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = uuid(999);

async function addCredit(id, code, state = 'AL DIA', installment = 5000, count = 3) {
  await db.query(`insert into public.creditos
    (id,codigo,importe_cuota,cantidad_cuotas,fecha_inicio,estado)
    values ($1,$2,$3,$4,date '2026-09-07',$5)`, [id, code, installment, count, state]);
}

async function addPayment(id, creditId, amount, {
  origin = 'ADMIN', reference = null, synced = '2026-09-20T10:00:00Z',
  created = '2026-09-10T10:00:00Z', applied = 0, remainder = 0
} = {}) {
  await db.query(`insert into public.pagos
    (id,credito_id,fecha_pago,importe,medio_pago,cuotas_aplicadas,remanente,
     created_at,referencia_importacion,origen,sincronizado_sheets_at)
    values ($1,$2,date '2026-09-10',$3,'Efectivo',$4,$5,$6,$7,$8,$9)`,
  [id, creditId, amount, applied, remainder, created, reference, origin, synced]);
}

const annul = async (paymentId, operationId, reason = 'Carga duplicada') => (await db.query(
  `select * from public.anular_pago_admin($1,$2,$3)`, [paymentId, operationId, reason]
)).rows[0];
const paymentRow = async id => (await db.query(`select * from public.pagos where id=$1`, [id])).rows[0];
const pending = async () => (await db.query(`select * from public.obtener_pagos_admin_pendientes_sheets()`)).rows;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
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
      credito_id uuid not null references public.creditos(id) on delete cascade,
      fecha_pago date not null,
      importe numeric not null check (importe > 0),
      medio_pago text not null,
      cuotas_aplicadas integer not null default 0 check (cuotas_aplicadas >= 0),
      remanente numeric not null default 0 check (remanente >= 0),
      observaciones text,
      created_at timestamptz not null default now(),
      referencia_importacion text,
      origen text not null default 'ADMIN' check (origen in ('ADMIN','SHEETS')),
      sincronizado_sheets_at timestamptz
    );
    create unique index pagos_referencia_importacion_unique
      on public.pagos(referencia_importacion) where referencia_importacion is not null;
  `);
  await db.query(`insert into auth.users(id) values ($1)`, [actor]);
  await db.exec(read('migrations/202609180001_pagos_anulaciones_estructura.sql'));
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(`create or replace function public.hugella_fecha_comercial()
    returns date language sql stable set search_path=''
    as $$select date '2026-09-20'$$;`);
  await db.exec(read('migrations/202609200001_recalcular_pagos_credito.sql'));

  // Installed production-shaped fixture. The migration must preserve its
  // signature, return contract, security attributes and grants.
  await db.exec(`
    create function public.obtener_pagos_admin_pendientes_sheets()
    returns table(pago_id uuid, importe numeric)
    language sql volatile security definer set search_path=''
    as $$
      select pg.id, pg.importe
      from public.pagos as pg
      where pg.origen = 'ADMIN'
        and pg.sincronizado_sheets_at is null
      order by pg.created_at, pg.id
    $$;
    revoke all on function public.obtener_pagos_admin_pendientes_sheets() from public, anon;
    grant execute on function public.obtener_pagos_admin_pendientes_sheets() to authenticated;
  `);
  const pendingMetadata = async () => (await db.query(
    `select to_jsonb(p)-'prosrc' as value from pg_proc p
     where p.oid='public.obtener_pagos_admin_pendientes_sheets()'::regprocedure`
  )).rows[0].value;
  const beforePendingMetadata = await pendingMetadata();

  await db.exec(read('migrations/202609200004_anular_pago_admin.sql'));
  assert.deepEqual(await pendingMetadata(), beforePendingMetadata);
  assert.match((await db.query(`select prosrc from pg_proc
    where oid='public.obtener_pagos_admin_pendientes_sheets()'::regprocedure`)).rows[0].prosrc,
  /pg\.estado = 'VALIDO'/);

  await db.exec(`set test.uid='${actor}'; set test.admin='yes';`);

  // ADMIN: exact UUID selects one of two equal payments; historical values stay.
  await addCredit(uuid(1), 'CR-1');
  await addPayment(payment(1), uuid(1), 3000, { applied: 0, remainder: 3000 });
  await addPayment(payment(2), uuid(1), 3000, {
    created: '2026-09-10T10:00:00Z', applied: 1, remainder: 1000
  });
  let result = await annul(payment(1), operation(1), '  Carga duplicada  ');
  assert.deepEqual([result.pago_id, result.estado_pago, result.motivo_anulacion, result.ya_procesada],
    [payment(1), 'ANULADO', 'Carga duplicada', false]);
  assert.equal((await paymentRow(payment(1))).cuotas_aplicadas, 0);
  assert.equal((await paymentRow(payment(1))).remanente, '3000');
  assert.equal((await paymentRow(payment(2))).estado, 'VALIDO');
  assert.deepEqual([
    (await paymentRow(payment(2))).cuotas_aplicadas,
    (await paymentRow(payment(2))).remanente
  ], [0, '3000']);
  const adminEvent = (await db.query(`select * from public.eventos_pagos_sheets
    where operacion_id=$1`, [operation(1)])).rows[0];
  assert.equal(adminEvent.tipo, 'RETIRAR');
  assert.equal(adminEvent.id_pago_sheets, 'ADM-' + payment(1).replaceAll('-', '').slice(0, 12).toUpperCase());
  assert.equal((await db.query(`select count(*)::integer count from public.operaciones_pagos
    where id=$1`, [operation(1)])).rows[0].count, 1);

  // Exact retry is idempotent; changed request or new operation is rejected.
  result = await annul(payment(1), operation(1), 'Carga duplicada');
  assert.equal(result.ya_procesada, true);
  assert.equal((await db.query(`select count(*)::integer count from public.eventos_pagos_sheets
    where operacion_id=$1`, [operation(1)])).rows[0].count, 1);
  await assert.rejects(annul(payment(1), operation(1), 'Otro motivo'), /otra solicitud/);
  await assert.rejects(annul(payment(1), operation(2)), /ya está anulado/);

  // SHEETS uses the exact visible ID obtained from its stored reference.
  await addCredit(uuid(2), 'CR-2');
  await addPayment(payment(3), uuid(2), 5000, {
    origin: 'SHEETS', reference: 'SHEETS-PG-000123', synced: null, applied: 1
  });
  await annul(payment(3), operation(3), 'Importación incorrecta');
  assert.equal((await db.query(`select id_pago_sheets from public.eventos_pagos_sheets
    where operacion_id=$1`, [operation(3)])).rows[0].id_pago_sheets, 'PG-000123');

  // Invalid or ambiguous identities fail without mutating payment or audit.
  await addCredit(uuid(3), 'CR-3');
  await addPayment(payment(4), uuid(3), 1000, { origin: 'SHEETS', reference: null, synced: null });
  await assert.rejects(annul(payment(4), operation(4)), /determinar inequívocamente/);
  assert.equal((await paymentRow(payment(4))).estado, 'VALIDO');
  await addPayment('10000000-0000-9999-aaaa-aaaaaaaaaaaa', uuid(3), 1000);
  await addPayment('10000000-0000-9999-bbbb-bbbbbbbbbbbb', uuid(3), 1000);
  await assert.rejects(annul('10000000-0000-9999-aaaa-aaaaaaaaaaaa', operation(5)), /no es inequívoco/);

  // First/middle/last allocation and reopening a CANCELADO credit.
  await addCredit(uuid(4), 'CR-4', 'CANCELADO', 5000, 2);
  await addPayment(payment(10), uuid(4), 3000, { created: '2026-09-10T10:00:00Z', remainder: 3000 });
  await addPayment(payment(11), uuid(4), 4000, { created: '2026-09-10T11:00:00Z', applied: 1, remainder: 2000 });
  await addPayment(payment(12), uuid(4), 3000, { created: '2026-09-10T12:00:00Z', applied: 1 });
  await annul(payment(11), operation(10), 'Pago intermedio incorrecto');
  assert.deepEqual((await db.query(`select id,estado,cuotas_aplicadas,remanente from public.pagos
    where credito_id=$1 order by created_at,id`, [uuid(4)])).rows.map(p =>
    [p.id, p.estado, p.cuotas_aplicadas, p.remanente]), [
    [payment(10), 'VALIDO', 0, '3000'],
    [payment(11), 'ANULADO', 1, '2000'],
    [payment(12), 'VALIDO', 1, '1000']
  ]);
  assert.notEqual((await db.query(`select estado from public.creditos where id=$1`, [uuid(4)])).rows[0].estado,
    'CANCELADO');

  // Annulling the last payment that completed several installments also
  // reopens the credit and leaves the annulled allocation unchanged.
  await addCredit(uuid(7), 'CR-7', 'CANCELADO', 5000, 3);
  await addPayment(payment(40), uuid(7), 3000, { applied: 0, remainder: 3000 });
  await addPayment(payment(41), uuid(7), 12000, {
    created: '2026-09-10T11:00:00Z', applied: 3, remainder: 0
  });
  await annul(payment(41), operation(40), 'Último pago incorrecto');
  assert.deepEqual([
    (await paymentRow(payment(41))).estado,
    (await paymentRow(payment(41))).cuotas_aplicadas,
    (await paymentRow(payment(41))).remanente
  ], ['ANULADO', 3, '0']);
  assert.notEqual((await db.query(`select estado from public.creditos where id=$1`, [uuid(7)])).rows[0].estado,
    'CANCELADO');

  // A failure in the central engine rolls back payment, audit and event.
  await addCredit(uuid(5), 'CR-5');
  await addPayment(payment(20), uuid(5), 1000);
  await db.query(`update public.creditos set importe_cuota=0 where id=$1`, [uuid(5)]);
  await assert.rejects(annul(payment(20), operation(20)), /installment amount must be positive/);
  assert.equal((await paymentRow(payment(20))).estado, 'VALIDO');
  assert.equal((await db.query(`select count(*)::integer count from public.operaciones_pagos
    where id=$1`, [operation(20)])).rows[0].count, 0);

  // The legacy publisher can no longer return an annulled unsynced ADMIN row.
  await addCredit(uuid(6), 'CR-6');
  await addPayment(payment(30), uuid(6), 1000, { synced: null });
  assert.ok((await pending()).some(p => p.pago_id === payment(30)));
  await annul(payment(30), operation(30));
  assert.ok(!(await pending()).some(p => p.pago_id === payment(30)));

  // Validation, authorization and permissions.
  await assert.rejects(annul(payment(2), operation(31), '   '), /motivo de anulación es obligatorio/);
  await assert.rejects(annul(uuid(888), operation(32)), /Pago no encontrado/);
  assert.equal((await db.query(`select has_function_privilege(
    'anon','public.anular_pago_admin(uuid,uuid,text)','EXECUTE') allowed`)).rows[0].allowed, false);
  assert.equal((await db.query(`select has_function_privilege(
    'authenticated','public.anular_pago_admin(uuid,uuid,text)','EXECUTE') allowed`)).rows[0].allowed, true);
  const metadata = (await db.query(`select prosecdef,provolatile,proconfig from pg_proc
    where oid='public.anular_pago_admin(uuid,uuid,text)'::regprocedure`)).rows[0];
  assert.deepEqual(metadata, { prosecdef: true, provolatile: 'v', proconfig: ['search_path=""'] });
  await db.exec(`set test.admin='no';`);
  await assert.rejects(annul(payment(2), operation(33)), /Acceso no autorizado/);

  console.log('PASS: secure atomic annulment, exact UUID targeting, ADMIN/SHEETS identity, audit, recalculation, idempotence, rollback, legacy publisher filter and ACL.');
} finally {
  await db.close();
}
