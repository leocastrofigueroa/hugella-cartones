"""11D.1: PostgreSQL 17 aislado, socket privado, sin TCP ni credenciales externas."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'PSQL'))}
BASE = Path(tempfile.mkdtemp(prefix='hugella-compras-', dir='/private/tmp'))
DATA, SOCKET = BASE / 'data', BASE / 'socket'
SOCKET.mkdir(mode=0o700)
passed = 0

def run(args, **kwargs):
    return subprocess.run(args, env=ENV, text=True, capture_output=True, **kwargs)

def sql(query, ok=True):
    r = run([str(BIN/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
             '-h', str(SOCKET), '-p', '55491', '-U', 'postgres', '-d', 'postgres'],
            input=query, timeout=30)
    if ok:
        assert r.returncode == 0, r.stderr
    return r

def check(label, query):
    global passed
    assert sql(query).stdout.strip() == 't', label
    passed += 1
    print('PASS:', label, flush=True)

def reject(label, query, code):
    global passed
    r = sql('BEGIN;\n'+query+';\nROLLBACK;', False)
    assert r.returncode != 0 and code in r.stderr, (label, r.stderr)
    passed += 1
    print('PASS:', label, flush=True)

migration = (ROOT/'supabase/migrations/202610090003_compras_gastos_base.sql').read_text()
try:
    r = run([str(BIN/'initdb'), '-D', str(DATA), '-U', 'postgres',
             '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    assert r.returncode == 0, r.stderr
    r = run([str(BIN/'pg_ctl'), '-D', str(DATA), '-l', str(BASE/'server.log'),
             '-o', f"-k {SOCKET} -p 55491 -c listen_addresses=''", '-w', 'start'])
    assert r.returncode == 0, r.stderr
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');
    CREATE TABLE public.creditos(id uuid PRIMARY KEY, codigo text UNIQUE);
    INSERT INTO public.creditos VALUES ('00000000-0000-4000-8000-000000000048','CR-0048');
    CREATE SEQUENCE public.creditos_codigo_seq START 48;
    CREATE FUNCTION public.test_existing() RETURNS integer LANGUAGE sql AS 'SELECT 42';
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC, anon, authenticated, service_role;
    """)
    snapshot_query = """SELECT row_to_json(x)::text FROM (
      SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN ('creditos'::regclass,'creditos_codigo_seq'::regclass)) AS relations,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid='creditos'::regclass) AS columns,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid='creditos'::regclass) AS constraints,
      (SELECT jsonb_agg(to_jsonb(p)) FROM pg_proc p WHERE p.oid='test_existing()'::regprocedure) AS function,
      (SELECT jsonb_agg(to_jsonb(c)) FROM creditos c) AS rows,
      (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM creditos_codigo_seq) AS sequence,
      (SELECT jsonb_agg(to_jsonb(d)) FROM pg_default_acl d) AS defaults
    ) x"""
    before = sql(snapshot_query).stdout
    # Deliberate failure after the DDL must roll back all three tables.
    r = sql(migration.replace('commit;', "SELECT 1/0;\ncommit;"), False)
    assert r.returncode != 0
    check('installation rollback', "SELECT to_regclass('public.proveedores') IS NULL AND to_regclass('public.compras_gastos') IS NULL AND to_regclass('public.items_compras_gastos') IS NULL")
    sql(migration)
    assert before == sql(snapshot_query).stdout
    passed += 1
    print('PASS: existing sentinel catalog/data/sequence/functions/default ACL unchanged')
    check('exactly three new tables, owner postgres, RLS, no policies', """SELECT count(*)=3 AND bool_and(relrowsecurity AND relowner='postgres'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass)) FROM pg_class WHERE oid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass)""")
    check('PK and FK with RESTRICT', """SELECT (SELECT count(*)=3 FROM pg_constraint WHERE contype='p' AND conrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass)) AND (SELECT count(*)=4 AND bool_and(confdeltype='r') FROM pg_constraint WHERE contype='f' AND conrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass))""")
    for role in ('anon','authenticated','service_role'):
        check(role+' no effective privileges', f"""SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE c.oid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass) AND has_table_privilege('{role}',c.oid,p))""")
        reject(role+' actual SELECT denied', f'SET LOCAL ROLE {role}; SELECT * FROM proveedores', 'permission denied')
    check('PUBLIC no grants', "SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass) AND a.grantee=0)")
    sql("""INSERT INTO proveedores(id,nombre,actor_id) VALUES ('00000000-0000-4000-8000-000000000002','Proveedor','00000000-0000-4000-8000-000000000001');
    INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) SELECT id,'MERCADERIA',id,current_date,'ARS',actor_id FROM proveedores;
    INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) SELECT '00000000-0000-4000-8000-000000000003','GASTO',id,current_date,'USD',actor_id FROM proveedores;
    """)
    reject('empty supplier', "INSERT INTO proveedores(nombre,actor_id) VALUES ('  ','00000000-0000-4000-8000-000000000001')", 'proveedores_nombre_check')
    reject('invalid type', "UPDATE compras_gastos SET tipo='OTRO'", 'compras_gastos_tipo_check')
    reject('supplier required', 'UPDATE compras_gastos SET proveedor_id=NULL', 'not-null')
    reject('currency explicit', "UPDATE compras_gastos SET moneda='ars'", 'compras_gastos_moneda_check')
    reject('finite date', "UPDATE compras_gastos SET fecha='infinity'", 'compras_gastos_fecha_check')
    for quantity in ('0','-1',"'NaN'", "'Infinity'", '0.0000001'):
        reject('quantity '+quantity, f"INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('00000000-0000-4000-8000-000000000002',1,'Item',{quantity},1)", 'items_compras_gastos_cantidad_check')
    for cost in ('-1', "'NaN'", "'Infinity'", '0.0000001'):
        reject('cost '+cost, f"INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('00000000-0000-4000-8000-000000000002',1,'Item',1,{cost})", 'items_compras_gastos_costo_check')
    reject('empty description', "INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('00000000-0000-4000-8000-000000000002',1,' ',1,1)", 'items_compras_gastos_descripcion_check')
    sql("INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) SELECT id,1,'Snapshot',3,0.335 FROM compras_gastos")
    check('same position in separate purchases and exact round', 'SELECT count(*)=2 AND bool_and(total=1.01) FROM items_compras_gastos')
    reject('duplicate position', "INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) SELECT compra_gasto_id,1,'Other',1,0 FROM items_compras_gastos LIMIT 1", 'items_compras_gastos_compra_posicion_unique')
    reject('supplier delete protected', 'DELETE FROM proveedores', 'foreign key constraint')
    reject('header delete protected', 'DELETE FROM compras_gastos', 'foreign key constraint')
    reject('total is not editable', 'UPDATE items_compras_gastos SET total=9', 'generated column')
    sql('UPDATE items_compras_gastos SET cantidad=2, costo_unitario=0')
    check('zero cost allowed and total recalculated', 'SELECT bool_and(total=0) FROM items_compras_gastos')
    check('only justified secondary indexes', "SELECT count(*)=1 FROM pg_indexes WHERE tablename IN ('proveedores','compras_gastos','items_compras_gastos') AND indexname NOT LIKE '%pkey' AND indexname NOT LIKE '%unique'")
    print(f'PASS: {passed} checks; local PostgreSQL only')
finally:
    status = run([str(BIN/'pg_ctl'), '-D', str(DATA), 'status'])
    if status.returncode == 0:
        stopped = run([str(BIN/'pg_ctl'), '-D', str(DATA), '-m', 'fast', '-w', 'stop'])
        assert stopped.returncode == 0, stopped.stderr
