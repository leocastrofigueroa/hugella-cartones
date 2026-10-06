// Local PostgreSQL WASM only. Never reads credentials or connects to Supabase.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.HUGELLA_TEST_DEPS || process.cwd(), 'runner.cjs'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const close = (n, type = 'DEVUELTO', extra = {}) => rows(
  'select * from public.cerrar_credito_admin($1,$2,$3,$4,$5,$6)',
  [id(n), extra.operation || id(n + 100), type, extra.date || '2026-09-30', extra.reason || 'Motivo de prueba', extra.notes || 'Observación de prueba']);
const admin = () => rows("select * from public.buscar_creditos_admin('CR-')");
const access = () => rows("select * from public.acceder_creditos_cliente('12345678','4321')");
const card = async n => (await rows('select public.get_carton_publico($1) value', [id(n + 1000)]))[0].value;
const snapshot = () => rows('select * from public.pagos order by id');
const metadata = () => rows(`select to_jsonb(p)-'prosrc' value from pg_proc p where p.oid = any(array[
  'public.buscar_creditos_admin(text)'::regprocedure, 'public.get_carton_publico(uuid)'::regprocedure,
  'public.acceder_creditos_cliente(text,text)'::regprocedure, 'public.recalcular_pagos_credito(uuid)'::regprocedure,
  'public.anular_pago_admin(uuid,uuid,text)'::regprocedure, 'public.es_admin_hugella()'::regprocedure,
  'public.hugella_fecha_comercial()'::regprocedure]) order by p.oid`);
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create table public.admin_users(user_id uuid primary key);
    create table public.clientes(id uuid primary key, nombre text, dni text, telefono text);
    create table public.creditos(id uuid primary key, cliente_id uuid, codigo text,
      producto text, importe_cuota numeric, cantidad_cuotas integer, estado text,
      fecha_inicio date, access_token uuid, created_at timestamptz default clock_timestamp(),
      constraint credit_state check(estado in ('AL DIA','ADELANTADO','ATRASADO','CANCELADO')));
    create table public.pagos(id uuid primary key default gen_random_uuid(), credito_id uuid references public.creditos(id),
      cuotas_aplicadas integer, fecha_pago date, medio_pago text, importe numeric,
      created_at timestamptz not null default clock_timestamp(), remanente numeric,
      observaciones text, referencia_importacion text unique, origen text default 'ADMIN',
      sincronizado_sheets_at timestamptz);
    insert into auth.users values ('${id(999)}');
    insert into public.admin_users values ('${id(999)}');
    set test.uid='${id(999)}';
    insert into public.clientes values ('${id(900)}','Cliente local','12345678','2615554321');`);
  await db.exec(read('migrations/202609180001_pagos_anulaciones_estructura.sql'));
  await db.exec(read('migrations/202609090001_estado_efectivo_helpers.sql'));
  // Verbatim six definitions and metadata exported by the user, not reconstructed RPCs.
  const exported = JSON.parse(read('tests/rpc_real_20261001.json'));
  assert.equal(exported.length, 6);
  for (const rpc of exported) {
    await db.exec(rpc.definicion_actual);
    await db.exec(`alter function ${rpc.funcion_requerida} owner to postgres;
      revoke all on function ${rpc.funcion_requerida} from public, anon, authenticated;`);
    for (const role of ['anon', 'authenticated']) {
      if (rpc[role + '_puede_ejecutar'] === 'true') await db.exec(`grant execute on function ${rpc.funcion_requerida} to ${role}`);
    }
    const actual = (await rows(`select pg_get_functiondef(p.oid) ddl, pg_get_function_result(p.oid) result,
      pg_get_function_arguments(p.oid) args, pg_get_userbyid(p.proowner) owner, p.proacl::text acl,
      p.prosecdef, p.provolatile, p.proconfig, l.lanname from pg_proc p
      join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure($1)`, [rpc.funcion_requerida]))[0];
    assert.equal(actual.ddl, rpc.definicion_actual, 'Exact exported DDL: ' + rpc.funcion_requerida);
    assert.equal(actual.result, rpc.retorno);
    assert.equal(actual.args, rpc.argumentos_completos);
    assert.equal(actual.owner, rpc.propietario);
    assert.equal(actual.acl, rpc.acl_explicita);
    assert.equal(actual.prosecdef, rpc.security_definer === 'true');
    assert.equal(actual.provolatile, { STABLE: 's', VOLATILE: 'v' }[rpc.volatilidad]);
    assert.deepEqual(actual.proconfig, JSON.parse(rpc.configuracion));
    assert.equal(actual.lanname, rpc.lenguaje);
  }
  const tomorrow = (await rows("select (public.hugella_fecha_comercial()+1)::text value"))[0].value;
  for (const file of ['202609200002_adaptar_escrituras_pagos_validos.sql', '202609200003_clasificar_origen_importacion_sheets.sql']) {
    await db.exec(read('migrations/' + file));
  }
  // Exact full production export, including the indentation used by the guard.
  // Other payment writers above and below still use versioned definitions.
  const annulmentExport = JSON.parse(read('tests/anular_pago_admin_real_20261001.json'));
  await db.exec(annulmentExport.definicion_actual);
  await db.exec(`alter function public.anular_pago_admin(uuid,uuid,text) owner to postgres;
    revoke all on function public.anular_pago_admin(uuid,uuid,text) from public, anon, authenticated;
    grant execute on function public.anular_pago_admin(uuid,uuid,text) to authenticated;`);
  assert.equal((await rows("select pg_get_functiondef('public.anular_pago_admin(uuid,uuid,text)'::regprocedure) ddl"))[0].ddl,
    annulmentExport.definicion_actual, 'Exact exported annulment DDL');
  // The migration must preserve all of pg_proc, including the exported ACL.
  const annulmentContract = async () => (await rows(`select
    pg_get_function_arguments(p.oid) args, pg_get_function_result(p.oid) result,
    pg_get_userbyid(p.proowner) owner, p.proacl::text acl,
    p.prosecdef, p.provolatile, p.proconfig, l.lanname
    from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='public.anular_pago_admin(uuid,uuid,text)'::regprocedure`))[0];
  const confirmedAnnulmentContract = {
    args: 'p_pago_id uuid, p_operacion_id uuid, p_motivo text',
    result: annulmentExport.retorno,
    owner: annulmentExport.propietario, acl: annulmentExport.acl_explicita,
    prosecdef: annulmentExport.security_definer === 'true', provolatile: 'v',
    proconfig: JSON.parse(annulmentExport.configuracion), lanname: annulmentExport.lenguaje,
  };
  assert.deepEqual(await annulmentContract(), confirmedAnnulmentContract);
  const correctionMigration = read('migrations/202609220001_corregir_pago_admin.sql');
  await db.exec(correctionMigration.slice(correctionMigration.indexOf('create function'), correctionMigration.indexOf('drop function')));
  for (let n = 1; n <= 3; n++) {
    await rows(`insert into public.creditos(id,cliente_id,codigo,producto,importe_cuota,cantidad_cuotas,estado,fecha_inicio,access_token) values ($1,$2,$3,'Producto',100,30,'ATRASADO',date '2026-09-01',$4)`,
      [id(n), id(900), 'CR-' + n, id(n + 1000)]);
    await rows(`select * from public.registrar_pago_admin($1,date '2026-09-10',250,'Efectivo','Histórico')`, [id(n)]);
  }
  // Execute the actual latest history RPC body, without the unrelated correction migration.
  const historyMigration = read('migrations/202609220001_corregir_pago_admin.sql');
  await db.exec(historyMigration.slice(historyMigration.indexOf('create function public.obtener_historial_pagos_admin'), historyMigration.lastIndexOf('commit;')));
  const before = await snapshot(), beforeMetadata = await metadata();
  const plan = await rows('select id, cantidad_cuotas, importe_cuota, fecha_inicio from public.creditos order by id');
  const events = await rows('select * from public.eventos_pagos_sheets');
  // Unknown public source OR unknown annulment source must roll back even the
  // wrappers and public patches already created earlier in the transaction.
  const definitions = await rows(`select p.oid::regprocedure::text signature, pg_get_functiondef(p.oid) ddl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`);
  for (const signature of ['acceder_creditos_cliente(text,text)', 'get_carton_publico(uuid)', 'anular_pago_admin(uuid,uuid,text)']) {
    const original = definitions.find(item => item.signature === signature).ddl;
    const altered = signature.startsWith('anular')
      ? original.replace('begin\n', 'begin\n  -- Unknown production change\n')
      : original.replace(/\bcr\b/g, 'other');
    await db.exec(altered);
    await assert.rejects(db.exec(read('migrations/202610010001_cierres_creditos.sql')),
      signature.startsWith('anular') ? /exportar definición real de anular_pago_admin/ : /fuente inesperada/);
    await db.exec('rollback');
    assert.equal((await rows("select to_regclass('public.cierres_creditos') value"))[0].value, null);
    assert.equal((await rows("select to_regprocedure('public.hugella_base_buscar_creditos_admin(text)') value"))[0].value, null);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await metadata(), beforeMetadata);
    await db.exec(original);
    for (const item of definitions) {
      assert.equal((await rows('select pg_get_functiondef(to_regprocedure($1)) ddl', [item.signature]))[0].ddl, item.ddl,
        'Rollback must restore every original function body');
    }
  }
  await db.exec(read('migrations/202610010001_cierres_creditos.sql'));
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await metadata(), beforeMetadata, 'Existing RPC contracts/ACL preserved');
  assert.deepEqual(await annulmentContract(), confirmedAnnulmentContract, 'Confirmed annulment metadata/ACL preserved exactly');
  // Extend the real closure wrapper locally; all remaining payment/closure tests
  // below now exercise the new RPC contract too.
  const differenceMigration = read('migrations/202610050001_buscar_creditos_admin_diferencia_cuotas.sql');
  const oldSearch = await admin();
  const baseDefinition = (await rows("select pg_get_functiondef('public.hugella_base_buscar_creditos_admin(text)'::regprocedure) ddl"))[0].ddl;
  const wrapperDefinition = (await rows("select pg_get_functiondef('public.buscar_creditos_admin(text)'::regprocedure) ddl"))[0].ddl;
  await db.exec(wrapperDefinition.replace('coalesce(c.tipo, r.estado)', "coalesce(c.tipo, 'UNKNOWN')"));
  await assert.rejects(db.exec(differenceMigration), /contrato o wrapper/);
  await db.exec('rollback');
  await db.exec(wrapperDefinition);
  // A dependent view must prevent recreation without losing the old RPC.
  await db.exec("create view public.test_search_dependency as select * from public.buscar_creditos_admin('CR-')");
  await assert.rejects(db.exec(differenceMigration), /depend/);
  await db.exec('rollback');
  assert.deepEqual(await admin(), oldSearch);
  await db.exec('drop view public.test_search_dependency');
  await db.exec(differenceMigration);
  assert.deepEqual((await admin()).map(({ diferencia_cuotas, ...credit }) => {
    assert.equal(typeof diferencia_cuotas, 'number'); return credit;
  }), oldSearch, 'All existing RPC values and ordering unchanged');
  assert.equal((await rows("select pg_get_functiondef('public.hugella_base_buscar_creditos_admin(text)'::regprocedure) ddl"))[0].ddl, baseDefinition);
  await db.exec('begin');
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-08'$$;
    update public.creditos set fecha_inicio = date '2026-09-07';`);
  for (const [paid, state, difference] of [[0, 'ATRASADO', -2], [2, 'AL DIA', 0], [4, 'ADELANTADO', 2], [30, 'CANCELADO', 28]]) {
    await rows('update public.pagos set cuotas_aplicadas=$1 where credito_id=$2', [paid, id(1)]);
    const result = (await rows("select * from public.buscar_creditos_admin('CR-1')"))[0];
    assert.equal(result.estado, state); assert.equal(result.diferencia_cuotas, difference);
  }
  await rows("update public.pagos set estado='ANULADO', anulado_at=now(), anulado_por=$2, motivo_anulacion='Prueba' where credito_id=$1", [id(1), id(999)]);
  assert.equal((await rows("select * from public.buscar_creditos_admin('CR-1')"))[0].diferencia_cuotas, -2, 'Annulled installments excluded');
  // Sunday uses the same existing calendar helper as the state.
  await db.exec(`create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-09-13'$$;`);
  assert.equal((await rows("select * from public.buscar_creditos_admin('CR-1')"))[0].diferencia_cuotas, -6);
  await db.exec('rollback');
  await assert.rejects(db.exec(differenceMigration), /contrato o wrapper/);
  await db.exec('rollback');
  console.log('PASS: diferencia_cuotas negative/zero/positive, paid cancellation, Sunday calendar, annulled payments, unchanged base RPC/results and safe migration replay.');
  // Authentication and normalization from the REAL PL/pgSQL access body survive.
  const unclosedPublic = await access();
  assert.deepEqual(await rows("select * from public.acceder_creditos_cliente('12.345.678','43-21')"), unclosedPublic);
  for (const args of [[null, '4321'], ['12345678', null], ['12345678', '321'], ['12345678', '9999'], ['87654321', '4321']]) {
    assert.deepEqual(await rows('select * from public.acceder_creditos_cliente($1,$2)', args), []);
  }
  assert.deepEqual(await rows("select * from public.buscar_creditos_admin('  ')"), []);
  for (const [n, type] of [[1, 'DEVUELTO'], [2, 'RETIRADO']]) {
    const result = await close(n, type);
    assert.equal(result[0].tipo, type);
    assert.equal(result[0].actor_id, id(999));
    assert.equal(result[0].motivo, 'Motivo de prueba');
    assert.equal(result[0].observaciones, 'Observación de prueba');
    assert.ok(result[0].created_at);
    assert.deepEqual(await close(n, type), result, 'Identical retry is idempotent');
    await assert.rejects(close(n, type, { reason: 'Otra solicitud' }), /cierre distinto/);
    const recalculated = await rows('select * from public.recalcular_pagos_credito($1)', [id(n)]);
    assert.equal(recalculated[0].estado, type);
    assert.equal(recalculated[0].cuotas_pagadas, 2);
    assert.equal(recalculated[0].cuotas_pendientes, 0);
    assert.equal(recalculated[0].total_pagado, '250');
    assert.equal(await card(n), null, 'Direct token cannot expose a closed credit');
    const history = await rows('select * from public.obtener_historial_pagos_admin($1)', [id(n)]);
    assert.equal(history.length, 1);
    assert.equal(history[0].estado, 'VALIDO');
    assert.equal(history[0].importe, '250');
  }
  assert.deepEqual(await snapshot(), before, 'Historic valid money/allocations unchanged');
  assert.deepEqual(await rows('select id, cantidad_cuotas, importe_cuota, fecha_inicio from public.creditos order by id'), plan);
  assert.deepEqual(await rows('select * from public.eventos_pagos_sheets'), events, 'No payment RETIRAR event created');
  assert.deepEqual((await admin()).map(c => [c.estado, c.cuotas_pendientes]), [['DEVUELTO', 0], ['RETIRADO', 0], ['ATRASADO', 28]]);
  assert.deepEqual((await access()).map(c => c.codigo), ['CR-3']);
  assert.equal((await card(3)).pagos.length, 1);
  assert.equal((await rows('select * from public.obtener_cierre_credito_admin($1)', [id(1)]))[0].tipo, 'DEVUELTO');
  assert.equal((await rows('select * from public.obtener_cierres_creditos_sheets(null)')).length, 2);
  assert.equal((await rows('select * from public.obtener_cierres_creditos_sheets($1)', [id(1)])).length, 1);

  await assert.rejects(rows(`select * from public.registrar_pago_admin($1,date '2026-10-01',100,'Efectivo',null)`, [id(1)]), /pagos posteriores/);
  await assert.rejects(rows(`select public.importar_pago_hugella('CR-1',date '2026-10-01',100,'Efectivo',null,'SHEETS-PG-FUTURE')`), /pagos posteriores/);
  await assert.rejects(rows(`update public.pagos set fecha_pago='2026-10-01' where credito_id=$1`, [id(1)]), /pagos posteriores/);
  assert.deepEqual(await snapshot(), before, 'Rejected future writes roll back');
  await rows(`select public.importar_pago_hugella('CR-1',date '2026-09-30',50,'Efectivo',null,'SHEETS-PG-LATE')`);
  assert.equal((await rows('select * from public.recalcular_pagos_credito($1)', [id(1)]))[0].estado, 'DEVUELTO');
  await assert.rejects(rows("update public.cierres_creditos set motivo='Cambiar'"), /inmutable/);
  await assert.rejects(rows('delete from public.cierres_creditos'), /inmutable/);
  await assert.rejects(close(3, 'OTRO'), /inválidos/);
  await assert.rejects(close(3, 'DEVUELTO', { date: tomorrow }), /inválidos/);
  await assert.rejects(close(3, 'DEVUELTO', { date: '2026-08-31' }), /anterior a la entrega/);
  await assert.rejects(close(3, 'DEVUELTO', { date: '2026-09-09' }), /pagos posteriores/);
  await assert.rejects(close(3, 'DEVUELTO', { operation: id(101) }), /unique constraint/);

  await db.exec('set role anon');
  assert.equal(await card(1), null);
  assert.equal((await access()).length, 1);
  await assert.rejects(close(3), /permission denied/);
  await assert.rejects(rows('select * from public.cierres_creditos'), /permission denied/);
  await assert.rejects(rows('select * from public.obtener_cierre_credito_admin($1)', [id(1)]), /permission denied/);
  await assert.rejects(rows("select * from public.hugella_base_buscar_creditos_admin('CR-')"), /permission denied/);
  await db.exec("reset role; set role authenticated; set test.uid='00000000-0000-0000-0000-000000000998'");
  await assert.rejects(close(3), /No autorizado/);
  await assert.rejects(admin(), /Acceso no autorizado/);
  await db.exec("set test.uid=''");
  await assert.rejects(close(3), /No autorizado/);
  await db.exec(`set test.uid='${id(999)}'`);
  await assert.rejects(rows('select * from public.hugella_base_recalcular_pagos_credito($1)', [id(1)]), /permission denied/);
  await close(3);
  await db.exec('reset role; set role anon');
  assert.deepEqual(await access(), [], 'All closed: no active public credits');
  await db.exec('reset role');

  // The real public RPC has no LIMIT: many closures must not hide an active sibling.
  for (let n = 10; n <= 30; n++) {
    await rows(`insert into public.creditos(id,cliente_id,codigo,producto,importe_cuota,cantidad_cuotas,estado,fecha_inicio,access_token) values ($1,$2,$3,'Producto',100,30,'ATRASADO',date '2026-09-01',$4)`,
      [id(n), id(900), 'CR-A' + n, id(n + 1000)]);
    await close(n);
  }
  await rows(`insert into public.creditos(id,cliente_id,codigo,producto,importe_cuota,cantidad_cuotas,estado,fecha_inicio,access_token) values ($1,$2,'CR-Z','Producto',100,30,'AL DIA',date '2026-09-01',$3)`, [id(50), id(900), id(1050)]);
  assert.deepEqual((await access()).map(c => c.codigo), ['CR-Z']);
  await rows(`select * from public.registrar_pago_admin($1,date '2026-09-20',3000,'Efectivo',null)`, [id(50)]);
  assert.equal((await card(50)).estado, 'CANCELADO', 'Paid cancellation keeps existing public behavior until an explicit merchandise closure');
  const paidBeforeClosure = await snapshot();
  await close(50, 'RETIRADO');
  assert.deepEqual(await snapshot(), paidBeforeClosure);
  const paidClosed = (await rows('select * from public.recalcular_pagos_credito($1)', [id(50)]))[0];
  assert.equal(paidClosed.cuotas_pagadas, 30);
  assert.equal(paidClosed.estado, 'RETIRADO', 'A merchandise closure never falsifies even a fully paid plan');
  assert.deepEqual(await rows('select * from public.eventos_pagos_sheets'), events);
  // More than 20 matches, exact match first even when its client sorts last,
  // case-insensitive trimmed search, then name/code; closures keep their places.
  for (let n = 200; n < 225; n++) {
    await rows('insert into public.clientes values ($1,$2,$3,$4)',
      [id(n + 2000), n === 224 ? 'ZZZ' : n % 2 ? 'BBB' : 'AAA', '55555555', '2615559876']);
    await rows(`insert into public.creditos(id,cliente_id,codigo,producto,importe_cuota,cantidad_cuotas,estado,fecha_inicio,access_token,created_at)
      values ($1,$2,$3,'Producto',100,30,'ATRASADO',date '2026-09-01',$4,date '2026-09-01'+$5::integer)`,
      [id(n), id(n + 2000), n === 224 ? 'ORD' : 'ORD-' + n, id(n + 1000), n - 200]);
  }
  const searchOrder = () => rows("select * from public.buscar_creditos_admin(' oRd ')");
  const expectedOrder = ['ORD', ...Array.from({ length: 24 }, (_, i) => i + 200)
    .sort((a, b) => a % 2 - b % 2 || a - b).slice(0, 19).map(n => 'ORD-' + n)];
  assert.deepEqual((await searchOrder()).map(c => c.codigo_credito), expectedOrder);
  assert.deepEqual((await rows("select * from public.hugella_base_buscar_creditos_admin(' oRd ')")).map(c => c.codigo_credito), expectedOrder);
  await close(224, 'DEVUELTO'); await close(200, 'RETIRADO');
  await db.exec('set enable_nestloop=off; set enable_mergejoin=off');
  assert.deepEqual((await searchOrder()).map(c => c.codigo_credito), expectedOrder);
  await db.exec('reset enable_nestloop; reset enable_mergejoin');
  const wrapperSource = (await rows("select prosrc from pg_proc where oid='public.buscar_creditos_admin(text)'::regprocedure"))[0].prosrc;
  assert.match(wrapperSource, /order by/i, 'An outer ORDER BY is required; incidental join order is not a contract');
  const manyPublic = await rows("select * from public.acceder_creditos_cliente('55.555.555','98-76')");
  assert.equal(manyPublic.length, 23, 'The exported public RPC has no LIMIT 20');
  assert.deepEqual(manyPublic.map(c => c.codigo), Array.from({ length: 23 }, (_, i) => 'ORD-' + (223 - i)), 'Real created_at DESC preserved');

  // Exported annulment and versioned correction: only explicit test operations
  // generate RETIRAR. Closing or retrying a closure never does.
  for (const [n, type] of [[70, 'DEVUELTO'], [71, 'RETIRADO'], [72, null]]) {
    await rows(`insert into public.creditos(id,cliente_id,codigo,producto,importe_cuota,cantidad_cuotas,estado,fecha_inicio)
      values ($1,$2,$3,'Producto',100,30,'ATRASADO',date '2026-09-01')`, [id(n), id(900), 'PAY-' + n]);
    const payment = (await rows(`select * from public.registrar_pago_admin($1,date '2026-09-10',250,'Efectivo',null)`, [id(n)]))[0];
    if (type) await close(n, type);
    const annul = () => rows('select * from public.anular_pago_admin($1,$2,$3)', [payment.pago_id, id(n + 5000), 'Prueba local']);
    const first = (await annul())[0];
    const afterAnnul = await snapshot();
    const eventsAfterAnnul = await rows('select * from public.eventos_pagos_sheets order by id');
    const retry = (await annul())[0];
    assert.equal(first.estado_credito, type || 'ATRASADO');
    assert.deepEqual(retry, { ...first, ya_procesada: true }, 'Retry preserves operational state for both closure types and active credits');
    assert.deepEqual(await snapshot(), afterAnnul, 'Retry does not recalculate/write any payment');
    assert.deepEqual(await rows('select * from public.eventos_pagos_sheets order by id'), eventsAfterAnnul);
    assert.equal((await rows('select estado from public.creditos where id=$1', [id(n)]))[0].estado, 'ATRASADO', 'Financial state remains separate');
    if (!type) {
      // Closure can occur between the first annulment and its retry.
      await close(n, 'RETIRADO');
      const afterLateClosure = await snapshot();
      assert.deepEqual(afterLateClosure, afterAnnul, 'Closing never changes historic payments');
      assert.deepEqual((await annul())[0], { ...first, estado_credito: 'RETIRADO', ya_procesada: true });
      assert.deepEqual(await snapshot(), afterLateClosure, 'Retry after a new closure is read-only for payments');
      assert.deepEqual(await rows('select * from public.eventos_pagos_sheets order by id'), eventsAfterAnnul);
      assert.equal((await rows('select estado from public.creditos where id=$1', [id(n)]))[0].estado, 'ATRASADO');
    }
  }
  const historical = (await rows(`select * from public.registrar_pago_admin($1,date '2026-09-20',200,'Efectivo',null)`, [id(70)]))[0];
  assert.equal(historical.cuotas_pendientes, 0);
  // Five positional arguments are ambiguous while the six-argument overload
  // has defaults, even with explicit casts. Exercise the legacy body in an
  // isolated transaction, then restore both the overload and payment snapshot.
  const beforeLegacyImport = await snapshot();
  await db.exec('begin');
  try {
    await db.exec('drop function public.importar_pago_hugella(text,date,numeric,text,text,text)');
    await rows("select public.importar_pago_hugella('PAY-70'::text,date '2026-09-20',10::numeric,'Efectivo'::text,null::text)");
    assert.equal((await snapshot()).length, beforeLegacyImport.length + 1);
    const legacyResult = (await rows('select * from public.recalcular_pagos_credito($1)', [id(70)]))[0];
    assert.equal(legacyResult.estado, 'DEVUELTO');
    assert.equal(legacyResult.cuotas_pendientes, 0);
    assert.equal(legacyResult.total_pagado, '210');
  } finally {
    await db.exec('rollback');
  }
  assert.deepEqual(await snapshot(), beforeLegacyImport);
  await rows("select public.importar_pago_hugella('PAY-70',date '2026-09-20',10,'Efectivo',null,'SHEETS-CLOSURE-TEST')");
  const correct = date => rows('select * from public.corregir_pago_admin($1,$2,$3,150,$4,null,$5)',
    [historical.pago_id, id(7000), date, 'Efectivo', 'Prueba local']);
  const beforeCorrection = await snapshot();
  const eventsBeforeCorrection = await rows('select * from public.eventos_pagos_sheets order by id');
  await assert.rejects(correct('2026-10-01'), /pagos posteriores/);
  assert.deepEqual(await snapshot(), beforeCorrection, 'Rejected replacement rolls back the original annulment');
  assert.deepEqual(await rows('select * from public.eventos_pagos_sheets order by id'), eventsBeforeCorrection);
  assert.deepEqual(await rows('select * from public.operaciones_pagos where id=$1', [id(7000)]), []);
  const corrected = (await correct('2026-09-20'))[0];
  assert.equal(corrected.ya_procesada, false);
  assert.equal((await correct('2026-09-20'))[0].ya_procesada, true);
  assert.equal((await rows('select * from public.recalcular_pagos_credito($1)', [id(70)]))[0].estado, 'DEVUELTO');
  assert.equal((await rows('select count(*)::int n from public.eventos_pagos_sheets'))[0].n, 4, 'Only three explicit annulments and one correction generate events');

  const installedMetadata = await metadata(), finalPayments = await snapshot();
  await assert.rejects(db.exec(read('migrations/202610010001_cierres_creditos.sql')), /already exists/);
  await db.exec('rollback');
  assert.deepEqual(await metadata(), installedMetadata);
  assert.deepEqual(await snapshot(), finalPayments, 'Reapplying fails safely without touching data');
  console.log('PASS: seven exact exported RPCs/ACL, real public JOIN and normalization/order/no LIMIT, explicit admin order and LIMIT 20, guarded exported annulment retries for both closures, all payment writers, immutable audit, historical money/plan, public visibility, unknown-source rollback, safe reapply and separate payment RETIRAR events.');
} finally { await db.close(); }
