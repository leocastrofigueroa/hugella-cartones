// Local PostgreSQL WASM only. Never connects to Supabase or remote services.
// HUGELLA_TEST_DEPS=/absolute/path/to/node_modules node scripts/test-payment-recalculation.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const credit = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const payment = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function addCredit(id, { installment = 5000, count = 3, start = '2026-09-07', state = 'AL DIA' } = {}) {
  await db.query(`insert into public.creditos(id, importe_cuota, cantidad_cuotas, fecha_inicio, estado)
    values ($1, $2, $3, $4, $5)`, [id, installment, count, start, state]);
}

async function addPayment(id, creditId, amount, createdAt, state = 'VALIDO', applied = 99, remainder = 999) {
  await db.query(`insert into public.pagos
    (id, credito_id, importe, created_at, estado, cuotas_aplicadas, remanente)
    values ($1, $2, $3, $4, $5, $6, $7)`,
  [id, creditId, amount, createdAt, state, applied, remainder]);
}

const recalculate = async id => (await db.query(
  `select * from public.recalcular_pagos_credito($1)`, [id]
)).rows[0];
const payments = async id => (await db.query(
  `select id, estado, importe, cuotas_aplicadas, remanente
   from public.pagos where credito_id=$1 order by created_at,id`, [id]
)).rows;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.creditos(
      id uuid primary key,
      importe_cuota numeric,
      cantidad_cuotas integer,
      fecha_inicio date,
      estado text check (estado in ('AL DIA','ADELANTADO','ATRASADO','CANCELADO'))
    );
    create table public.pagos(
      id uuid primary key,
      credito_id uuid not null references public.creditos(id),
      importe numeric not null check (importe > 0),
      created_at timestamptz not null,
      estado text not null check (estado in ('VALIDO','ANULADO')),
      cuotas_aplicadas integer not null check (cuotas_aplicadas >= 0),
      remanente numeric not null check (remanente >= 0)
    );
  `);
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  await db.exec(`create or replace function public.hugella_fecha_comercial()
    returns date language sql stable set search_path=''
    as $$select date '2026-09-09'$$;`);
  await db.exec(read('migrations/202609200001_recalcular_pagos_credito.sql'));

  // Normal and partial payments: 3000 + 4000 + 3000 completes two installments.
  await addCredit(credit(1));
  await addPayment(payment(1), credit(1), 3000, '2026-09-07T10:00:00Z');
  await addPayment(payment(2), credit(1), 4000, '2026-09-07T11:00:00Z');
  await addPayment(payment(3), credit(1), 3000, '2026-09-07T12:00:00Z');
  let result = await recalculate(credit(1));
  assert.deepEqual((await payments(credit(1))).map(p => [p.cuotas_aplicadas, p.remanente]),
    [[0, '3000'], [1, '2000'], [1, '0']]);
  assert.deepEqual([result.total_pagado, result.cuotas_pagadas, result.cuotas_pendientes, result.remanente],
    ['10000', 2, 1, '0']);

  // Equal payments at the same instant remain independent; UUID is the tie-breaker.
  await addCredit(credit(2), { installment: 7600, count: 3 });
  await addPayment(payment(11), credit(2), 7600, '2026-09-07T10:00:00Z');
  await addPayment(payment(10), credit(2), 7600, '2026-09-07T10:00:00Z');
  await recalculate(credit(2));
  assert.deepEqual((await payments(credit(2))).map(p => [p.id, p.cuotas_aplicadas, p.remanente]), [
    [payment(10), 1, '0'], [payment(11), 1, '0']
  ]);

  // Anulling the first payment recalculates every remaining valid payment.
  await db.query(`update public.pagos set estado='ANULADO' where id=$1`, [payment(1)]);
  await recalculate(credit(1));
  assert.deepEqual((await payments(credit(1))).map(p => [p.estado, p.cuotas_aplicadas, p.remanente]),
    [['ANULADO', 0, '3000'], ['VALIDO', 0, '4000'], ['VALIDO', 1, '2000']]);

  // Restore first and annul the middle payment.
  await db.query(`update public.pagos set estado='VALIDO' where id=$1`, [payment(1)]);
  await db.query(`update public.pagos set estado='ANULADO' where id=$1`, [payment(2)]);
  await recalculate(credit(1));
  assert.deepEqual((await payments(credit(1))).map(p => [p.estado, p.cuotas_aplicadas, p.remanente]),
    [['VALIDO', 0, '3000'], ['ANULADO', 0, '4000'], ['VALIDO', 1, '1000']]);

  // Restore middle and annul last; its historical allocation remains untouched.
  await db.query(`update public.pagos set estado='VALIDO' where id=$1`, [payment(2)]);
  await db.query(`update public.pagos set estado='ANULADO' where id=$1`, [payment(3)]);
  await recalculate(credit(1));
  assert.deepEqual((await payments(credit(1))).map(p => [p.estado, p.cuotas_aplicadas, p.remanente]),
    [['VALIDO', 0, '3000'], ['VALIDO', 1, '2000'], ['ANULADO', 1, '1000']]);

  // A stored CANCELADO must return to the effective non-cancelled state.
  await addCredit(credit(3), { installment: 5000, count: 2, state: 'CANCELADO' });
  await addPayment(payment(20), credit(3), 5000, '2026-09-07T10:00:00Z');
  await addPayment(payment(21), credit(3), 5000, '2026-09-07T11:00:00Z', 'ANULADO', 1, 0);
  result = await recalculate(credit(3));
  assert.equal(result.estado, 'ATRASADO');
  assert.equal((await db.query(`select estado from public.creditos where id=$1`, [credit(3)])).rows[0].estado, 'ATRASADO');

  // It remains CANCELADO when other valid money still covers the credit.
  await addCredit(credit(4), { installment: 5000, count: 2, state: 'CANCELADO' });
  await addPayment(payment(30), credit(4), 10000, '2026-09-07T10:00:00Z');
  await addPayment(payment(31), credit(4), 1000, '2026-09-07T11:00:00Z', 'ANULADO', 7, 777);
  result = await recalculate(credit(4));
  assert.equal(result.estado, 'CANCELADO');
  assert.deepEqual((await payments(credit(4))).find(p => p.id === payment(31)), {
    id: payment(31), estado: 'ANULADO', importe: '1000', cuotas_aplicadas: 7, remanente: '777'
  });

  // Overpayment aborts before updates and the caller transaction rolls back fully.
  await addCredit(credit(5), { installment: 5000, count: 2, state: 'AL DIA' });
  await addPayment(payment(40), credit(5), 6000, '2026-09-07T10:00:00Z', 'VALIDO', 8, 888);
  await db.exec('begin');
  await addPayment(payment(41), credit(5), 5000, '2026-09-07T11:00:00Z', 'VALIDO', 9, 999);
  await assert.rejects(recalculate(credit(5)), /Valid payments exceed credit total/);
  await db.exec('rollback');
  assert.deepEqual((await payments(credit(5))).map(p => [p.cuotas_aplicadas, p.remanente]),
    [[8, '888']]);

  // A credit without valid payments has zero allocation and an effective state.
  await addCredit(credit(6), { state: 'CANCELADO' });
  result = await recalculate(credit(6));
  assert.deepEqual([result.total_pagado, result.cuotas_pagadas, result.cuotas_pendientes, result.remanente, result.estado],
    ['0', 0, 3, '0', 'ATRASADO']);

  // Invalid structural data is rejected explicitly.
  await addCredit(credit(7), { installment: 0 });
  await assert.rejects(recalculate(credit(7)), /installment amount must be positive/);
  await addCredit(credit(8), { count: 0 });
  await assert.rejects(recalculate(credit(8)), /installment count must be positive/);
  await addCredit(credit(9), { start: null });
  await assert.rejects(recalculate(credit(9)), /start date is required/);

  // Repeated execution is stable and introduces no drift.
  const before = await payments(credit(2));
  const first = await recalculate(credit(2));
  const second = await recalculate(credit(2));
  assert.deepEqual(second, first);
  assert.deepEqual(await payments(credit(2)), before);

  // Validation and direct-execution permissions.
  await assert.rejects(recalculate(credit(999)), /Credit not found/);
  const acl = (await db.query(`select has_function_privilege('anon', 'public.recalcular_pagos_credito(uuid)', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.recalcular_pagos_credito(uuid)', 'EXECUTE') as authenticated`)).rows[0];
  assert.deepEqual(acl, { anon: false, authenticated: false });
  const metadata = (await db.query(`select prosecdef, provolatile, proconfig
    from pg_proc where oid='public.recalcular_pagos_credito(uuid)'::regprocedure`)).rows[0];
  assert.equal(metadata.prosecdef, true);
  assert.equal(metadata.provolatile, 'v');
  assert.deepEqual(metadata.proconfig, ['search_path=""']);
  await db.exec('set role authenticated');
  await assert.rejects(recalculate(credit(1)), /permission denied/);
  await db.exec('reset role');

  console.log('PASS: deterministic recalculation, partial/equal payments, first/middle/last annulment, state transitions, overpayment rollback, preserved annulled audit, idempotence and permissions.');
} finally {
  await db.close();
}
