// Local PostgreSQL WASM only. Never connects to Supabase or Google Sheets.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const uuid = (prefix, n) => `${prefix}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = uuid('9', 1);
const credit = uuid('8', 1);
const payment = n => uuid('1', n);
const event = n => uuid('2', n);

async function addPayment(id, state = 'ANULADO') {
  await db.query(`insert into public.pagos
    (id,credito_id,fecha_pago,importe,medio_pago,estado,anulado_at,anulado_por,motivo_anulacion)
    values ($1,$2,date '2026-09-20',1000,'Efectivo',$3,
      case when $3='ANULADO' then now() else null end,
      case when $3='ANULADO' then $4::uuid else null end,
      case when $3='ANULADO' then 'Prueba' else null end)`, [id, credit, state, actor]);
}

async function addEvent(id, paymentId, {
  type = 'RETIRAR', state = 'PENDIENTE', dependency = null,
  attempts = 0, error = null, token = null, until = null,
  confirmedAt = null, created = '2026-09-20T10:00:00Z'
} = {}) {
  await db.query(`insert into public.eventos_pagos_sheets
    (id,tipo,pago_id,id_pago_sheets,estado,depende_de_evento_id,created_at,
     confirmado_at,intentos,ultimo_error,reserva_token,reserva_hasta)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [id, type, paymentId, `ID-${id}`, state, dependency, created,
    confirmedAt, attempts, error, token, until]);
}

const reserve = async (limit = 20) => (await db.query(
  `select * from public.reservar_eventos_pagos_sheets($1)`, [limit]
)).rows;
const prepare = async (id, token) => (await db.query(
  `select public.preparar_retiro_pago_sheets($1,$2) value`, [id, token]
)).rows[0].value;
const finish = async (id, token, result, detail = null) => db.query(
  `select public.finalizar_evento_pago_sheets($1,$2,$3,$4)`, [id, token, result, detail]
);
const eventRow = async id => (await db.query(
  `select * from public.eventos_pagos_sheets where id=$1`, [id]
)).rows[0];

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
    create table public.creditos(id uuid primary key);
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
  `);
  await db.query(`insert into auth.users(id) values ($1)`, [actor]);
  await db.query(`insert into public.creditos(id) values ($1)`, [credit]);
  await db.exec(read('migrations/202609180001_pagos_anulaciones_estructura.sql'));

  for (let n = 1; n <= 20; n += 1) await addPayment(payment(n));

  // Historical rows survive installation. The new checkpoint starts NULL.
  await addEvent(event(90), payment(20), { state: 'BLOQUEADO', attempts: 3, error: 'Error histórico' });
  const historicalBefore = await eventRow(event(90));
  await db.exec(read('migrations/202609200005_procesar_eventos_retirar_sheets.sql'));
  const historicalAfter = await eventRow(event(90));
  const { retiro_preparado_at: historicalCheckpoint, ...historicalComparable } = historicalAfter;
  assert.deepEqual(historicalComparable, historicalBefore);
  assert.equal(historicalCheckpoint, null);

  await db.exec(`set test.uid='${actor}'; set test.admin='yes';`);

  // Two normal reservations are returned once, with independent tokens.
  await addEvent(event(1), payment(1), { error: 'Error anterior', created: '2026-09-20T10:01:00Z' });
  await addEvent(event(2), payment(2), { created: '2026-09-20T10:02:00Z' });
  let reservations = await reserve(2);
  assert.deepEqual(reservations.map(r => r.evento_id), [event(1), event(2)]);
  assert.ok(reservations.every(r => r.estado === undefined && r.tipo === 'RETIRAR'));
  assert.ok(reservations.every(r => r.intentos === 1 && r.reserva_token && r.reserva_hasta));
  assert.notEqual(reservations[0].reserva_token, reservations[1].reserva_token);
  assert.equal(reservations[0].retiro_preparado_at, null);
  assert.equal((await eventRow(event(1))).ultimo_error, 'Error anterior');
  assert.deepEqual(await reserve(20), []);

  const token1 = reservations[0].reserva_token;
  const token2 = reservations[1].reserva_token;

  // Wrong token and confirmation without checkpoint are rejected.
  await assert.rejects(prepare(event(1), uuid('7', 1)), /token de reserva no es válido/);
  await assert.rejects(finish(event(1), uuid('7', 1), 'BLOQUEAR', 'Error'),
    /token de reserva no es válido/);
  await assert.rejects(finish(event(1), token1, 'CONFIRMAR'), /retiro no fue preparado/);

  // The checkpoint is idempotent and never uses ultimo_error.
  const preparedAt = await prepare(event(1), token1);
  assert.ok(preparedAt);
  assert.equal((await prepare(event(1), token1)).toISOString(), preparedAt.toISOString());
  assert.equal((await eventRow(event(1))).ultimo_error, 'Error anterior');

  // Confirmation preserves the checkpoint and clears only the prior error.
  await finish(event(1), token1, 'CONFIRMAR');
  let row = await eventRow(event(1));
  assert.equal(row.estado, 'CONFIRMADO');
  assert.ok(row.confirmado_at);
  assert.equal(row.retiro_preparado_at.toISOString(), preparedAt.toISOString());
  assert.equal(row.ultimo_error, null);
  assert.equal(row.reserva_token, null);
  assert.equal(row.reserva_hasta, null);

  // Blocking requires and records a real error, without creating a checkpoint.
  await assert.rejects(finish(event(2), token2, 'BLOQUEAR', '   '), /detalle del error es obligatorio/);
  await finish(event(2), token2, 'BLOQUEAR', 'ID duplicado en Sheets');
  row = await eventRow(event(2));
  assert.deepEqual([row.estado, row.ultimo_error, row.retiro_preparado_at, row.confirmado_at],
    ['BLOQUEADO', 'ID duplicado en Sheets', null, null]);

  // An unconfirmed dependency blocks reservation; a confirmed one enables it.
  await addEvent(event(3), payment(3), { type: 'PUBLICAR', created: '2026-09-20T10:03:00Z' });
  await addEvent(event(4), payment(4), { dependency: event(3), created: '2026-09-20T10:04:00Z' });
  assert.deepEqual(await reserve(20), []);
  await db.query(`update public.eventos_pagos_sheets
    set estado='CONFIRMADO',confirmado_at=now() where id=$1`, [event(3)]);
  reservations = await reserve(20);
  assert.deepEqual(reservations.map(r => r.evento_id), [event(4)]);

  // RETRY records an error, keeps the checkpoint and permits a new reservation.
  const token4 = reservations[0].reserva_token;
  const prepared4 = await prepare(event(4), token4);
  await finish(event(4), token4, 'REINTENTAR', 'Timeout después de limpiar Sheets');
  row = await eventRow(event(4));
  assert.deepEqual([row.estado, row.intentos, row.ultimo_error],
    ['PENDIENTE', 1, 'Timeout después de limpiar Sheets']);
  assert.equal(row.retiro_preparado_at.toISOString(), prepared4.toISOString());
  reservations = await reserve(1);
  assert.equal(reservations[0].evento_id, event(4));
  assert.equal(reservations[0].intentos, 2);
  assert.equal(reservations[0].retiro_preparado_at.toISOString(), prepared4.toISOString());
  assert.notEqual(reservations[0].reserva_token, token4);
  await finish(event(4), reservations[0].reserva_token, 'BLOQUEAR', 'Revisión manual');

  // An expired lease is reserved again, increments attempts and retains data.
  const oldToken = uuid('6', 5);
  const checkpoint = new Date('2026-09-20T09:00:00Z');
  await addEvent(event(5), payment(5), {
    state: 'EN_PROCESO', attempts: 4, error: 'Timeout de red', token: oldToken,
    until: '2020-01-01T00:00:00Z', created: '2026-09-20T10:05:00Z'
  });
  await db.query(`update public.eventos_pagos_sheets set retiro_preparado_at=$2 where id=$1`,
    [event(5), checkpoint]);
  reservations = await reserve(1);
  assert.equal(reservations[0].evento_id, event(5));
  assert.equal(reservations[0].intentos, 5);
  assert.notEqual(reservations[0].reserva_token, oldToken);
  assert.equal(reservations[0].retiro_preparado_at.toISOString(), checkpoint.toISOString());
  assert.equal((await eventRow(event(5))).ultimo_error, 'Timeout de red');

  // Expired active reservations cannot prepare or finish until re-reserved.
  await db.query(`update public.eventos_pagos_sheets set reserva_hasta=now()-interval '1 second' where id=$1`,
    [event(5)]);
  await assert.rejects(prepare(event(5), reservations[0].reserva_token), /reserva del evento venció/);
  await assert.rejects(finish(event(5), reservations[0].reserva_token, 'BLOQUEAR', 'Error'),
    /reserva del evento venció/);
  reservations = await reserve(1);
  assert.equal(reservations[0].evento_id, event(5));
  await finish(event(5), reservations[0].reserva_token, 'BLOQUEAR', 'Reserva anterior vencida');

  // A payment that is no longer annulled prevents prepare and confirmation.
  await addEvent(event(6), payment(6), { created: '2026-09-20T10:06:00Z' });
  reservations = await reserve(1);
  const token6 = reservations[0].reserva_token;
  await db.query(`update public.pagos set estado='VALIDO',anulado_at=null,anulado_por=null,
    motivo_anulacion=null where id=$1`, [payment(6)]);
  await assert.rejects(prepare(event(6), token6), /ya no está anulado/);
  await db.query(`update public.pagos set estado='ANULADO',anulado_at=now(),anulado_por=$2,
    motivo_anulacion='Restaurado' where id=$1`, [payment(6), actor]);
  await prepare(event(6), token6);
  await db.query(`update public.pagos set estado='VALIDO',anulado_at=null,anulado_por=null,
    motivo_anulacion=null where id=$1`, [payment(6)]);
  await assert.rejects(finish(event(6), token6, 'CONFIRMAR'), /ya no está anulado/);

  // PUBLICAR and active, non-expired RETIRAR events are never reserved.
  await addEvent(event(7), payment(7), { type: 'PUBLICAR', created: '2026-09-20T10:07:00Z' });
  await addEvent(event(8), payment(8), {
    state: 'EN_PROCESO', attempts: 1, token: uuid('6', 8),
    until: '2099-01-01T00:00:00Z', created: '2026-09-20T10:08:00Z'
  });
  assert.deepEqual(await reserve(20), []);
  assert.equal((await eventRow(event(7))).estado, 'PENDIENTE');
  assert.equal((await eventRow(event(8))).intentos, 1);

  // Safe bounds, authorization, ACL and function metadata.
  await assert.rejects(reserve(0), /límite debe estar entre 1 y 100/);
  await assert.rejects(reserve(101), /límite debe estar entre 1 y 100/);
  await assert.rejects(reserve(null), /límite debe estar entre 1 y 100/);
  const signatures = [
    'public.reservar_eventos_pagos_sheets(integer)',
    'public.preparar_retiro_pago_sheets(uuid,uuid)',
    'public.finalizar_evento_pago_sheets(uuid,uuid,text,text)'
  ];
  for (const [signature, defaults] of signatures.map((signature, index) =>
    [signature, index === 1 ? 0 : 1])) {
    assert.equal((await db.query(`select has_function_privilege('anon',$1,'EXECUTE') allowed`,
      [signature])).rows[0].allowed, false);
    assert.equal((await db.query(`select has_function_privilege('authenticated',$1,'EXECUTE') allowed`,
      [signature])).rows[0].allowed, true);
    const metadata = (await db.query(`select prosecdef,provolatile,proconfig,pronargdefaults,
      pg_get_userbyid(proowner) owner from pg_proc
      where oid=$1::regprocedure`, [signature])).rows[0];
    assert.deepEqual(metadata, {
      prosecdef: true,
      provolatile: 'v',
      proconfig: ['search_path=""'],
      pronargdefaults: defaults,
      owner: 'postgres'
    });
  }
  await db.exec(`set test.admin='no';`);
  await assert.rejects(reserve(1), /Acceso no autorizado/);

  console.log('PASS: RETIRAR reservation, expiry, dependencies, durable checkpoint, confirm/block/retry transitions, payment validation, historical preservation and ACL.');
} finally {
  await db.close();
}
