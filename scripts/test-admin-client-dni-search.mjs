// PostgreSQL local en memoria: no carga .env ni conecta a Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const db = new PGlite();
const adminId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const search = dni => db.query('select * from public.buscar_cliente_por_dni_admin($1)', [dni]);
const rejected = async (dni, code) => assert.rejects(search(dni), error => error.code === code);

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid;
    $$;
    create table public.admin_users(user_id uuid primary key);
    create function public.es_admin_hugella() returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.admin_users au where au.user_id = auth.uid());
    $$;
    revoke all on function public.es_admin_hugella() from public, anon, authenticated, service_role;
    create table public.clientes(
      id uuid primary key, nombre text not null, dni text,
      telefono text, domicilio text, created_at timestamptz default now()
    );
    alter table public.clientes enable row level security;
    revoke all on public.clientes, public.admin_users from public, anon, authenticated, service_role;
    -- Comprueba que la migración retira incluso grants heredados del entorno.
    alter default privileges grant execute on functions to anon, service_role;
  `);
  await db.query('insert into admin_users values ($1)', [adminId]);
  await db.query('insert into clientes(id,nombre,dni,telefono,domicilio) values ($1,$2,$3,$4,$5)',
    [clientId, 'Cliente local', '12.345.678', '2615554321', 'Domicilio ficticio']);
  for (const [n, dni] of [[4, '001234567'], [5, '1234567'], [6, null], [7, 'abc']]) {
    await db.query('insert into clientes(id,nombre,dni) values ($1,$2,$3)',
      [`${n}${'0'.repeat(7)}-0000-4000-8000-000000000000`, 'Fixture local', dni]);
  }
  await db.exec(read('202610080002_clientes_dni_normalizado_unique.sql'));
  const snapshot = async () => (await db.query('select * from clientes order by id')).rows;
  const before = await snapshot();
  const adminSource = (await db.query("select pg_get_functiondef('public.es_admin_hugella()'::regprocedure) source")).rows[0].source;
  await db.exec(read('202610080003_buscar_cliente_por_dni_admin.sql'));

  const metadata = (await db.query(`select p.prosecdef, p.provolatile, p.proconfig,
    pg_get_function_result(p.oid) result from pg_proc p
    where p.oid='public.buscar_cliente_por_dni_admin(text)'::regprocedure`)).rows[0];
  assert.equal(metadata.prosecdef, true);
  assert.equal(metadata.provolatile, 's');
  assert.deepEqual(metadata.proconfig, ['search_path=""']);
  assert.equal(metadata.result, 'TABLE(id uuid, nombre text, dni text, telefono text, domicilio text)');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const allowed = (await db.query("select has_function_privilege($1, 'public.buscar_cliente_por_dni_admin(text)', 'EXECUTE') allowed", [role])).rows[0].allowed;
    assert.equal(allowed, role === 'authenticated');
  }

  await db.exec(`set role authenticated; set test.uid='${adminId}';`);
  const exact = (await search('12345678')).rows;
  assert.deepEqual(exact, [{id: clientId, nombre: 'Cliente local', dni: '12.345.678', telefono: '2615554321', domicilio: 'Domicilio ficticio'}]);
  for (const dni of ['12.345.678', '12 345 678', 'abc12-345-678']) {
    assert.deepEqual((await search(dni)).rows, exact);
  }
  assert.deepEqual((await search('99999999')).rows, []);
  for (const dni of [null, '', 'abc', '123456', '1234567890']) await rejected(dni, '22023');
  assert.equal((await search('1234567')).rows.length, 1);
  assert.equal((await search('001234567')).rows.length, 1);
  assert.notEqual((await search('1234567')).rows[0].id, (await search('001234567')).rows[0].id);
  await assert.rejects(db.query('select * from public.clientes'), error => error.code === '42501');
  await db.exec("set test.uid='';");
  await rejected('12345678', '42501');
  await rejected(null, '42501');
  await db.exec(`set test.uid='${otherId}';`);
  await rejected('12345678', '42501');
  await db.exec('reset role; set role anon;');
  await rejected('12345678', '42501');
  await db.exec('reset role; set role service_role;');
  await rejected('12345678', '42501');
  await db.exec('reset role;');
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query("select pg_get_functiondef('public.es_admin_hugella()'::regprocedure) source")).rows[0].source, adminSource);

  // Defensa ante autorización NULL y ante una futura pérdida del índice.
  await db.exec('create or replace function public.es_admin_hugella() returns boolean language sql stable security definer set search_path=\'\' as $$ select null::boolean; $$;');
  await db.exec(`set role authenticated; set test.uid='${adminId}';`);
  await rejected('12345678', '42501');
  await db.exec('reset role;');
  await db.exec(adminSource);
  await db.exec('drop index public.clientes_dni_normalizado_unique;');
  await db.query('insert into clientes(id,nombre,dni) values ($1,$2,$3)',
    ['88888888-8888-4888-8888-888888888888', 'Duplicado ficticio', '12 345 678']);
  await db.exec(`set role authenticated; set test.uid='${adminId}';`);
  await rejected('12345678', '23514');
  await db.exec('reset role;');
  console.log('PASS: búsqueda exacta/formateada, inexistente, límites 7–9, NULL/vacíos, ceros iniciales, sesión/admin, autorización NULL, RLS sin acceso directo, ACL, metadatos, datos/RPC existentes preservados y duplicados rechazados.');
} finally {
  await db.close();
}
