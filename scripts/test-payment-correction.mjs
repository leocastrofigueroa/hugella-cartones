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

const correct = async (paymentId, operationId, changes = {}) => (await db.query(
  'select * from public.corregir_pago_admin($1,$2,$3,$4,$5,$6,$7)',
  [paymentId, operationId, changes.date ?? '2026-09-11', changes.amount ?? 7500,
    changes.method ?? 'Transferencia', changes.notes ?? 'Corregido', changes.reason ?? 'Error de carga']
)).rows[0];
const rows = async (sql, values = []) => (await db.query(sql, values)).rows;
const paymentRow = async id => (await rows('select * from public.pagos where id=$1', [id]))[0];
const snapshot = async () => Promise.all(['pagos','operaciones_pagos','eventos_pagos_sheets','creditos']
  .map(table => rows(`select * from public.${table} order by id`)));

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

  await db.exec(read('migrations/202609200004_anular_pago_admin.sql'));
  await db.exec(read('migrations/202609200005_procesar_eventos_retirar_sheets.sql'));
  await db.exec(read('migrations/202609090005_obtener_historial_pagos_admin.sql'));
  await db.exec(read('migrations/202609200006_historial_pagos_anulados_admin.sql'));
  await db.exec(read('migrations/202609220001_corregir_pago_admin.sql'));
  await db.exec(`set test.uid='${actor}'; set test.admin='yes';`);

  await addCredit(uuid(1), 'CR-1');
  await addPayment(payment(1), uuid(1), 5000, { applied: 1 });
  const original = await paymentRow(payment(1));
  const result = await correct(payment(1), operation(1));
  assert.equal(result.ya_procesada, false);
  assert.equal(result.credito_id, uuid(1));
  const old = await paymentRow(payment(1)), fresh = await paymentRow(result.pago_nuevo_id);
  assert.equal(old.estado, 'ANULADO');
  assert.equal(old.motivo_anulacion, 'Error de carga');
  assert.equal(old.anulado_por, actor);
  assert.ok(old.anulado_at);
  for (const key of Object.keys(original).filter(key => !['estado','motivo_anulacion','anulado_por','anulado_at'].includes(key))) {
    assert.deepEqual(old[key], original[key], `Historical ${key} preserved`);
  }
  assert.deepEqual([fresh.credito_id, fresh.importe, fresh.fecha_pago.toISOString().slice(0, 10), fresh.medio_pago, fresh.observaciones,
    fresh.estado, fresh.origen, fresh.referencia_importacion, fresh.sincronizado_sheets_at, fresh.reemplaza_pago_id,
    fresh.cuotas_aplicadas, fresh.remanente],
  [uuid(1), '7500', '2026-09-11', 'Transferencia', 'Corregido', 'VALIDO', 'ADMIN', null, null, payment(1), 1, '2500']);
  const audit = (await rows('select * from operaciones_pagos where id=$1', [operation(1)]))[0];
  assert.deepEqual([audit.tipo, audit.pago_original_id, audit.pago_nuevo_id, audit.actor_id, audit.motivo],
    ['CORRECCION', payment(1), fresh.id, actor, 'Error de carga']);
  const event = (await rows('select * from eventos_pagos_sheets where operacion_id=$1', [operation(1)]))[0];
  assert.deepEqual([event.tipo, event.pago_id, event.estado, event.id_pago_sheets],
    ['RETIRAR', payment(1), 'PENDIENTE', 'ADM-' + payment(1).replaceAll('-', '').slice(0,12).toUpperCase()]);
  const pending = await rows('select * from obtener_pagos_admin_pendientes_sheets()');
  assert.ok(pending.some(row => row.pago_id === fresh.id));
  assert.ok(!pending.some(row => row.pago_id === old.id));
  const history = await rows('select * from obtener_historial_pagos_admin($1)', [uuid(1)]);
  assert.equal(history.length, 2);
  assert.equal(history.find(row => row.pago_id === fresh.id).reemplaza_pago_id, old.id);
  assert.equal(history.find(row => row.pago_id === old.id).estado, 'ANULADO');

  const beforeRetry = await snapshot();
  assert.deepEqual(await correct(payment(1), operation(1)), { ...result, ya_procesada: true });
  assert.deepEqual(await snapshot(), beforeRetry);
  await assert.rejects(correct(payment(1), operation(1), { amount: 8000 }), /otra solicitud/);
  await assert.rejects(correct(payment(1), operation(2)), /ya está anulado/);

  // Re-correct a replacement and retry the earlier operation afterwards.
  const second = await correct(fresh.id, operation(2), { amount: 10000, date: '2026-09-12', method: 'Efectivo', notes: 'Nueva fecha' });
  assert.equal((await paymentRow(second.pago_nuevo_id)).cuotas_aplicadas, 2);
  assert.equal((await paymentRow(second.pago_nuevo_id)).reemplaza_pago_id, fresh.id);
  assert.equal((await correct(payment(1), operation(1))).pago_nuevo_id, fresh.id);

  // Reopen a fully paid credit; the old amount is excluded from the new total.
  await addCredit(uuid(2), 'CR-2', 'CANCELADO');
  await addPayment(payment(2), uuid(2), 15000, { applied: 3 });
  await correct(payment(2), operation(3), { amount: 5000 });
  assert.equal((await rows('select estado from creditos where id=$1', [uuid(2)]))[0].estado, 'ATRASADO');

  // A SHEETS original produces a RETIRAR with its old identity; new is ADMIN.
  await addCredit(uuid(3), 'CR-3');
  await addPayment(payment(3), uuid(3), 5000, { origin: 'SHEETS', reference: 'SHEETS-PG-000123', synced: null });
  const imported = await correct(payment(3), operation(4));
  assert.equal((await paymentRow(imported.pago_nuevo_id)).origen, 'ADMIN');
  assert.equal((await rows('select id_pago_sheets from eventos_pagos_sheets where operacion_id=$1', [operation(4)]))[0].id_pago_sheets, 'PG-000123');

  // Correct only date/method/notes, leaving the amount unchanged.
  await addCredit(uuid(6), 'CR-6');
  await addPayment(payment(6), uuid(6), 5000, { applied: 1 });
  const details = await correct(payment(6), operation(6), { amount: 5000, date: '2026-09-08', method: 'Mercado Pago', notes: 'Detalle corregido' });
  const detailsRow = await paymentRow(details.pago_nuevo_id);
  assert.deepEqual([detailsRow.importe, detailsRow.fecha_pago.toISOString().slice(0,10), detailsRow.medio_pago, detailsRow.observaciones, detailsRow.cuotas_aplicadas],
    ['5000', '2026-09-08', 'Mercado Pago', 'Detalle corregido', 1]);

  // Unsynced original: never invent evidence that its Sheets retirement happened.
  await addCredit(uuid(7), 'CR-7');
  await addPayment(payment(7), uuid(7), 5000, { synced: null });
  const unsynced = await correct(payment(7), operation(7));
  assert.equal((await paymentRow(unsynced.pago_nuevo_id)).sincronizado_sheets_at, null);
  const unsyncedEvent = (await rows('select * from eventos_pagos_sheets where operacion_id=$1', [operation(7)]))[0];
  assert.equal(unsyncedEvent.estado, 'PENDIENTE');
  assert.equal(unsyncedEvent.retiro_preparado_at, null);

  // Failure after original annulment + replacement + audit rolls back everything.
  await addCredit(uuid(4), 'CR-4');
  await addPayment(payment(4), uuid(4), 5000);
  let beforeFailure = await snapshot();
  await assert.rejects(correct(payment(4), operation(5), { amount: 16000 }), /exceed credit total/);
  assert.deepEqual(await snapshot(), beforeFailure);
  // Failure in the final event insert also rolls back credit recalculation.
  await db.exec(`create function fail_correction_event() returns trigger language plpgsql as $$
    begin raise exception 'Injected event failure'; end; $$;
    create trigger fail_event before insert on eventos_pagos_sheets
      for each row execute function fail_correction_event();`);
  await assert.rejects(correct(payment(4), operation(5)), /Injected event failure/);
  assert.deepEqual(await snapshot(), beforeFailure);
  await db.exec('drop trigger fail_event on eventos_pagos_sheets; drop function fail_correction_event()');

  for (const changes of [{ amount: 0 }, { amount: -1 }, { amount: 'NaN' }, { amount: 'Infinity' }, { reason: ' ' }, { method: ' ' }]) {
    await assert.rejects(correct(payment(4), operation(5), changes), /obligatorios/);
  }
  assert.deepEqual(await snapshot(), beforeFailure);
  await db.exec("set role authenticated; set test.admin='no'");
  await assert.rejects(correct(payment(4), operation(5)), /Acceso no autorizado/);
  await db.exec("set test.admin='yes'; set test.uid=''");
  await assert.rejects(correct(payment(4), operation(5)), /Acceso no autorizado/);
  await db.exec(`set test.uid='${actor}'`);
  await correct(payment(4), operation(5));
  await assert.rejects(rows('select * from operaciones_pagos'), /permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(correct(payment(4), operation(5)), /permission denied/);
  await assert.rejects(rows('select * from obtener_historial_pagos_admin($1)', [uuid(1)]), /permission denied/);
  await db.exec('reset role');
  const meta = (await rows(`select prosecdef,provolatile,proconfig from pg_proc
    where oid='public.corregir_pago_admin(uuid,uuid,date,numeric,text,text,text)'::regprocedure`))[0];
  assert.deepEqual(meta, { prosecdef: true, provolatile: 'v', proconfig: ['search_path=""'] });
  assert.equal((await rows("select count(*)::int n from eventos_pagos_sheets where tipo='PUBLICAR'"))[0].n, 0);
  console.log('PASS: correction fields, preserved original, same credit, replacement/audit/history, recalculation, retry/chain, full rollback, ADMIN publication eligibility, RETIRAR identity and ACL.');
} finally { await db.close(); }
