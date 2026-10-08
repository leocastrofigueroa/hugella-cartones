// PostgreSQL WASM local en memoria. No lee .env, tokens ni usa red/Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('202610080004_crear_credito_admin.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const signature = 'public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric)';
const db = new PGlite();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const base = {
  operation: id(100), dni: '12345678', isNew: false, expected: id(3),
  name: null, phone: null, address: null, code: 'CR-LOCAL-1', product: 'Producto local',
  date: '2026-10-08', count: 10, amount: '1000.00',
};
const call = overrides => {
  const p = { ...base, ...overrides };
  return rows('select * from public.crear_credito_admin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::integer,$12::numeric)',
    [p.operation,p.dni,p.isNew,p.expected,p.name,p.phone,p.address,p.code,p.product,p.date,p.count,p.amount]);
};
const asAdmin = async (user = id(1)) => db.exec(`set role authenticated; set test.uid='${user}';`);
const snapshot = async () => {
  await db.exec('reset role;');
  const value = await rows(`select
    (select jsonb_agg(to_jsonb(t) order by id) from clientes t) clients,
    (select jsonb_agg(to_jsonb(t) order by id) from creditos t) credits,
    (select jsonb_agg(to_jsonb(t) order by id) from pagos t) payments,
    (select jsonb_agg(to_jsonb(t) order by operacion_id) from operaciones_altas_creditos t) operations`);
  await db.exec('set role authenticated;');
  return value;
};
const rejected = async (parameters, code) => {
  const before = await snapshot();
  await assert.rejects(call(parameters), error => error.code === code);
  assert.deepEqual(await snapshot(), before, 'Un rechazo debe preservar todas las filas');
};

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid;
    $$;
    create table public.admin_users(user_id uuid primary key references auth.users);
    create function public.es_admin_hugella() returns boolean language sql stable
      security definer set search_path = '' as $$
      select exists(select 1 from public.admin_users au where au.user_id = auth.uid());
    $$;
    revoke all on function public.es_admin_hugella() from public, anon, authenticated, service_role;
    create table public.clientes(
      id uuid primary key default gen_random_uuid(), nombre text not null, domicilio text,
      telefono text, created_at timestamptz default now(), dni text
    );
    create table public.creditos(
      id uuid primary key default gen_random_uuid(), cliente_id uuid not null references clientes,
      codigo text not null unique, producto text not null, fecha_inicio date not null,
      cantidad_cuotas integer not null check(cantidad_cuotas>0),
      importe_cuota numeric(12,2) not null check(importe_cuota>0),
      estado text not null default 'AL DIA'
        check(estado in ('AL DIA','ATRASADO','ADELANTADO','CANCELADO')),
      created_at timestamptz default now(), access_token uuid not null default gen_random_uuid() unique
    );
    create table public.pagos(id uuid primary key, credito_id uuid references creditos,
      importe numeric, fecha_pago date);
    alter table clientes enable row level security;
    alter table creditos enable row level security;
    alter table pagos enable row level security;
    revoke all on clientes, creditos, pagos, admin_users from public, anon, authenticated, service_role;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, service_role;
    alter default privileges grant all on tables to authenticated, service_role;
  `);
  for (const user of [1,2,9]) await db.query('insert into auth.users values ($1)', [id(user)]);
  for (const user of [1,9]) await db.query('insert into admin_users values ($1)', [id(user)]);
  await db.query('insert into clientes(id,nombre,dni,telefono,domicilio) values ($1,$2,$3,$4,$5)',
    [id(3),'Cliente histórico ficticio','12.345.678','Teléfono ficticio','Domicilio ficticio']);
  await db.query('insert into creditos(id,cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota) values ($1,$2,$3,$4,$5,10,100)',
    [id(4),id(3),'CR-HISTORICO','Histórico','2026-10-01']);
  await db.query('insert into pagos values ($1,$2,100,$3)', [id(5),id(4),'2026-10-02']);
  await db.exec(read('202609090001_estado_efectivo_helpers.sql'));
  await db.exec("create or replace function public.hugella_fecha_comercial() returns date language sql stable set search_path='' as $$select date '2026-10-08'$$;");
  await db.exec(read('202610080002_clientes_dni_normalizado_unique.sql'));
  await db.exec(read('202610080003_buscar_cliente_por_dni_admin.sql'));
  const oldFunctions = await rows(`select oid::text, to_jsonb(p) metadata from pg_proc p
    where pronamespace in ('public'::regnamespace,'auth'::regnamespace) order by oid`);
  const adminDefinition = (await rows("select pg_get_functiondef('public.es_admin_hugella()'::regprocedure) value"))[0].value;
  const tokenDefault = (await rows(`select pg_get_expr(d.adbin,d.adrelid) value from pg_attrdef d
    join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where a.attrelid='creditos'::regclass and a.attname='access_token'`))[0].value;
  await db.exec(migration);
  await asAdmin();
  const historic = (await snapshot())[0];

  const first = (await call({}))[0];
  assert.equal(first.cliente_id,id(3)); assert.equal(first.cliente_creado,false);
  assert.equal(first.ya_procesada,false); assert.equal(first.codigo,base.code);
  assert.match(first.access_token,/^[0-9a-f-]{36}$/);
  const afterFirst = await snapshot();
  const retry = (await call({dni:'12 345 678',code:' CR-LOCAL-1 ',amount:'1000.000'}))[0];
  assert.deepEqual(retry,{...first,ya_procesada:true});
  assert.deepEqual(await snapshot(),afterFirst);
  for (const different of [{product:'Otro'}, {amount:'1001'}, {dni:'87654321'}, {isNew:true,expected:null,name:'Nuevo'}]) {
    await rejected(different,'22023');
  }
  await asAdmin(id(9)); await rejected({},'22023'); await asAdmin();
  const second = (await call({operation:id(101),code:'CR-LOCAL-2',dni:'12.345.678'}))[0];
  assert.equal(second.cliente_id,id(3));
  const fresh = {operation:id(102),dni:'87654321',isNew:true,expected:null,
    name:' Cliente nuevo ficticio ',phone:' Teléfono nuevo ',address:' Domicilio nuevo ',code:'CR-NUEVO'};
  const created = (await call(fresh))[0];
  assert.equal(created.cliente_creado,true);
  assert.notEqual(created.cliente_id,id(3));
  const beforeFreshRetry = await snapshot();
  assert.deepEqual((await call({...fresh,dni:'87.654.321'}))[0],{...created,ya_procesada:true});
  assert.deepEqual(await snapshot(),beforeFreshRetry);
  await db.exec('reset role;');
  const stored = (await rows('select nombre,dni,telefono,domicilio from clientes where id=$1',[created.cliente_id]))[0];
  assert.deepEqual(stored,{nombre:'Cliente nuevo ficticio',dni:'87654321',telefono:'Teléfono nuevo',domicilio:'Domicilio nuevo'});
  await asAdmin();

  for (const dni of [null,'','abc','123456','1234567890']) await rejected({operation:id(200),dni},'22023');
  await rejected({operation:null},'22023');
  await rejected({operation:id(200),isNew:null},'22023');
  await rejected({operation:id(200),expected:id(999)},'22023');
  await rejected({operation:id(200),expected:created.cliente_id},'22023');
  await rejected({operation:id(200),name:'Cambiar histórico'},'22023');
  await rejected({operation:id(200),phone:'Cambiar histórico'},'22023');
  await rejected({operation:id(200),address:'Cambiar histórico'},'22023');
  await rejected({...fresh,operation:id(200),dni:'12345678',code:'NO-CREAR'},'23505');
  await rejected({...fresh,operation:id(200),dni:'11223344',name:'   '},'22023');
  await rejected({...fresh,operation:id(200),dni:'11223344',expected:id(3)},'22023');
  for (const bad of [
    {code:null},{code:'   '},{product:null},{product:' '},{date:null},{date:'infinity'},
    {date:'2026-10-11'},{count:null},{count:0},{count:-1},{amount:null},{amount:'0'},
    {amount:'-1'},{amount:'0.001'},{amount:'10000000000'},{amount:'NaN'},
    {amount:'Infinity'},{amount:'-Infinity'},
  ]) await rejected({operation:id(200),...bad},'22023');
  await rejected({operation:id(200),date:'2026-02-30'},'22008');
  await rejected({operation:id(200),count:'2147483648'},'22003');
  // Se prepara un cliente nuevo antes del INSERT de crédito que falla por UNIQUE.
  await rejected({...fresh,operation:id(201),dni:'11223344',code:'CR-HISTORICO'},'23505');
  await rejected({...fresh,operation:id(202),dni:'11223344',code:'CR-HISTORICO'},'23505');
  // Fallo real posterior al INSERT del cliente, independiente del código UNIQUE.
  await db.exec('reset role;');
  await db.exec("alter table creditos add constraint fixture_credit_failure check(producto <> 'RECHAZAR-FIXTURE');");
  await asAdmin();
  await rejected({...fresh,operation:id(204),dni:'11223344',code:'CR-FALLA',product:'RECHAZAR-FIXTURE'},'23514');
  await db.exec('reset role;');
  await db.exec('alter table creditos drop constraint fixture_credit_failure;');
  // Fallo al auditar: también revierte tanto cliente como crédito recién creados.
  await db.exec(`alter table operaciones_altas_creditos add constraint fixture_audit_failure check(operacion_id <> '${id(205)}');`);
  await asAdmin();
  await rejected({...fresh,operation:id(205),dni:'11223344',code:'CR-FALLA-AUDITORIA'},'23514');
  await db.exec('reset role;');
  await db.exec('alter table operaciones_altas_creditos drop constraint fixture_audit_failure;');

  await db.exec("set test.uid='';"); await rejected({operation:id(203)},'42501');
  await asAdmin(id(2)); await rejected({operation:id(203)},'42501'); await asAdmin();
  await db.exec('reset role;');
  await db.exec('create or replace function public.es_admin_hugella() returns boolean language sql stable security definer set search_path=\'\' as $$select null::boolean$$;');
  await asAdmin(); await rejected({operation:id(203)},'42501');
  await db.exec('reset role;');
  await db.exec(adminDefinition);
  await asAdmin();
  // Límites aceptados, fecha futura y sábado: usan el mismo helper, sin cobros.
  for (const [n,amount,date,state] of [[210,'0.01','2026-10-08','ATRASADO'],
    [211,'9999999999.99','2026-10-10','AL DIA'],[212,'1','2026-10-01','ATRASADO']]) {
    const result = (await call({operation:id(n),code:`CR-LIMITE-${n}`,amount,date}))[0];
    await db.exec('reset role;');
    assert.equal((await rows('select estado from creditos where id=$1',[result.credito_id]))[0].estado,state);
    await asAdmin();
  }
  // Demuestra que la RPC usa el default de la tabla, no un generador propio.
  await db.exec('reset role;');
  await db.exec(`alter table creditos alter column access_token set default '${id(777)}'::uuid;`);
  await asAdmin();
  assert.equal((await call({operation:id(213),code:'CR-DEFAULT-TOKEN'}))[0].access_token,id(777));
  await db.exec('reset role;');
  await db.exec(`alter table creditos alter column access_token set default ${tokenDefault};`);
  await asAdmin();
  // PGlite serializa consultas: prueba doble envío, NO dos sesiones simultáneas.
  const doubleParams = {operation:id(220),code:'CR-DOBLE'};
  const double = await Promise.all([call(doubleParams),call(doubleParams)]);
  assert.equal(double[0][0].credito_id,double[1][0].credito_id);
  assert.equal(double.filter(r=>r[0].ya_procesada).length,1);
  const competingDni = {...fresh,operation:id(221),dni:'22334455',code:'CR-COMPITE-A'};
  const competingDniResult = await Promise.allSettled([call(competingDni),call({...competingDni,operation:id(222),code:'CR-COMPITE-B'})]);
  assert.equal(competingDniResult.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competingDniResult.find(r=>r.status==='rejected').reason.code,'23505');
  const competingCodeResult = await Promise.allSettled([
    call({...fresh,operation:id(223),dni:'33445566',code:'CR-COMPITE-C'}),
    call({...fresh,operation:id(224),dni:'44556677',code:'CR-COMPITE-C'}),
  ]);
  assert.equal(competingCodeResult.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competingCodeResult.find(r=>r.status==='rejected').reason.code,'23505');

  const final = (await snapshot())[0];
  assert.deepEqual(final.clients.find(c=>c.id===id(3)),historic.clients[0]);
  assert.deepEqual(final.credits.find(c=>c.id===id(4)),historic.credits[0]);
  assert.deepEqual(final.payments,historic.payments);
  await db.exec('reset role;');
  const op = (await rows('select * from operaciones_altas_creditos where operacion_id=$1',[fresh.operation]))[0];
  assert.equal(op.actor_id,id(1)); assert.equal(op.cliente_id,created.cliente_id);
  assert.equal(op.credito_id,created.credito_id); assert.equal(op.cliente_creado,true);
  assert.ok(op.created_at); assert.equal(Object.hasOwn(op.solicitud,'access_token'),false);
  assert.equal((await rows("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='operaciones_altas_creditos' and column_name='access_token') value"))[0].value,false);
  assert.equal((await rows(`select pg_get_expr(d.adbin,d.adrelid) value from pg_attrdef d
    join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where a.attrelid='creditos'::regclass and a.attname='access_token'`))[0].value,tokenDefault);
  const meta = (await rows(`select prosecdef,provolatile,proconfig from pg_proc where oid=to_regprocedure($1)`,[signature]))[0];
  assert.deepEqual(meta,{prosecdef:true,provolatile:'v',proconfig:['search_path=""']});
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await rows('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature]))[0].allowed,role==='authenticated');
    assert.equal((await rows("select has_table_privilege($1,'public.operaciones_altas_creditos','SELECT') allowed",[role]))[0].allowed,false);
  }
  await db.exec('set role anon;'); await assert.rejects(call({}),e=>e.code==='42501');
  await db.exec('reset role; set role service_role;'); await assert.rejects(call({}),e=>e.code==='42501');
  await db.exec('reset role;'); await asAdmin();
  await assert.rejects(rows('select * from operaciones_altas_creditos'),e=>e.code==='42501');
  await assert.rejects(rows('insert into clientes(nombre) values (\'No permitido\')'),e=>e.code==='42501');
  await db.exec('reset role;');
  // El helper sustituido para probar NULL se restauró literalmente.
  const currentFunctions = await rows('select oid::text,to_jsonb(p) metadata from pg_proc p where oid=any($1::oid[]) order by oid',[oldFunctions.map(r=>r.oid)]);
  for (const old of oldFunctions) {
    assert.deepEqual(currentFunctions.find(r=>r.oid===old.oid),old);
  }
  console.log('PASS: alta existente/nueva, normalización, validaciones, numeric(12,2), estado inicial, permisos, idempotencia, conflictos, rollback y preservación histórica.');
  console.log('PASS: dobles envíos y colisiones locales serializadas. Concurrencia entre conexiones requiere PostgreSQL staging; no se afirma probada por PGlite.');
} finally { await db.close(); }

// Preflight: sin default de token, toda la migración aborta sin instalar tabla/RPC.
const missingDefault = new PGlite();
try {
  await missingDefault.exec('create table creditos(access_token uuid not null);');
  await assert.rejects(missingDefault.exec(migration),/default UUID actual/);
  await missingDefault.exec('rollback;');
  assert.equal((await missingDefault.query("select to_regclass('public.operaciones_altas_creditos') value")).rows[0].value,null);
  console.log('PASS: falta de default del token aborta instalación sin cambios.');
} finally { await missingDefault.close(); }
