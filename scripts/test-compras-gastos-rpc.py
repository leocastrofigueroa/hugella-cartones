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


import json
import time
migration = (ROOT/'supabase/migrations/202610090004_compras_gastos_rpc_admin.sql').read_text()
actor='00000000-0000-4000-8000-000000000001'
other='00000000-0000-4000-8000-000000000009'

def auth(q, who=actor):
    return f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{who}'; {q}; COMMIT;"

def call(op, items=None, provider=None, tipo='MERCADERIA', who=actor):
    items=items if items is not None else [{'posicion':1,'descripcion':' Producto ','cantidad':3,'costo_unitario':0.335}]
    return f"SELECT public.crear_compra_gasto_admin('{op}','{tipo}','{provider or supplier}',DATE '2026-10-10','ARS',NULL,NULL,'{json.dumps(items)}'::jsonb)"

def success(label,q):
    global passed
    r=sql(auth(q)); passed+=1; print('PASS:',label,flush=True)
    return r.stdout.strip()

try:
    r=run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']); assert r.returncode==0,r.stderr
    r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p 55491 -c listen_addresses=''",'-w','start']); assert r.returncode==0,r.stderr
    sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000009'),('00000000-0000-4000-8000-000000000008');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000009'::uuid) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.creditos(id uuid PRIMARY KEY,codigo text); CREATE TABLE public.pagos(id uuid); CREATE TABLE public.contratos(id uuid);
    INSERT INTO creditos VALUES ('00000000-0000-4000-8000-000000000048','CR-0048');
    CREATE SEQUENCE public.creditos_codigo_seq START 48;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    """)
    sql((ROOT/'supabase/migrations/202610090003_compras_gastos_base.sql').read_text())
    snap="""SELECT jsonb_build_object('classes',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE c.oid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass,'creditos'::regclass,'pagos'::regclass,'contratos'::regclass,'creditos_codigo_seq'::regclass)), 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a WHERE a.attrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass,'creditos'::regclass,'pagos'::regclass,'contratos'::regclass)), 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE conrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass,'creditos'::regclass,'pagos'::regclass,'contratos'::regclass)), 'helpers',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE oid IN ('auth.uid()'::regprocedure,'es_admin_hugella()'::regprocedure)), 'seq',(SELECT jsonb_build_array(last_value,is_called) FROM creditos_codigo_seq), 'rows',(SELECT jsonb_agg(to_jsonb(c)) FROM creditos c), 'defaults',(SELECT jsonb_agg(to_jsonb(d)) FROM pg_default_acl d))"""
    before=sql(snap).stdout
    r=sql(migration.replace('commit;', 'SELECT 1/0; commit;'),False); assert r.returncode!=0
    check('installation rollback',"SELECT to_regclass('operaciones_compras_gastos') IS NULL AND to_regprocedure('crear_proveedor_admin(uuid,text,text,text,text)') IS NULL")
    sql(migration)
    assert before==sql(snap).stdout
    passed+=1; print('PASS: existing schema, helpers, CR-0048, sequence and defaults unchanged')
    supplier_result=json.loads(success('admin supplier creation',"SELECT crear_proveedor_admin('00000000-0000-4000-8000-000000000020',' Proveedor ',' ','','  ')") )
    supplier=supplier_result['id']
    assert supplier_result['actor_id']==actor and supplier_result['nombre']=='Proveedor' and all(supplier_result[x] is None for x in ('identificacion_fiscal','contacto','observaciones'))
    passed+=1; print('PASS: real actor and normalized optional fields')
    provider_call="SELECT crear_proveedor_admin('00000000-0000-4000-8000-000000000020','Proveedor',NULL,NULL,NULL)"
    retry=json.loads(success('provider canonical retry',provider_call))
    assert retry==supplier_result
    check('provider retry creates exactly one row', 'SELECT (SELECT count(*)=1 FROM proveedores) AND (SELECT count(*)=1 FROM operaciones_altas_proveedores)')
    reject('provider UUID null',auth("SELECT crear_proveedor_admin(NULL,'x')").removeprefix('BEGIN; '),'Operación obligatoria')
    reject('provider changed payload',auth(provider_call.replace("'Proveedor'","'Otro'")).removeprefix('BEGIN; '),'Operación utilizada')
    reject('provider changed actor',auth(provider_call,other).removeprefix('BEGIN; '),'Operación utilizada')
    identical=json.loads(success('provider equal names distinct UUID',provider_call.replace('000000000020','000000000022')))
    assert identical['id']!=supplier
    # Force failure in audit INSERT, after supplier INSERT: whole RPC must roll back.
    sql("""CREATE FUNCTION public.test_fail_provider_op() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate provider operation failure'; END $$;
    CREATE TRIGGER test_fail_provider BEFORE INSERT ON operaciones_altas_proveedores FOR EACH ROW EXECUTE FUNCTION test_fail_provider_op();""")
    before_counts=sql('SELECT count(*) FROM proveedores; SELECT count(*) FROM operaciones_altas_proveedores').stdout
    reject('provider audit failure atomic rollback',auth(provider_call.replace('000000000020','000000000023')).removeprefix('BEGIN; '),'deliberate provider operation failure')
    assert before_counts==sql('SELECT count(*) FROM proveedores; SELECT count(*) FROM operaciones_altas_proveedores').stdout
    sql('DROP TRIGGER test_fail_provider ON operaciones_altas_proveedores; DROP FUNCTION test_fail_provider_op()')
    reject('empty supplier',auth("SELECT crear_proveedor_admin('00000000-0000-4000-8000-000000000021',' ')").removeprefix('BEGIN; '),'Nombre obligatorio')
    signatures=['crear_proveedor_admin(uuid,text,text,text,text)','buscar_proveedores_admin(text,integer,integer)','crear_compra_gasto_admin(uuid,text,uuid,date,text,text,text,jsonb)','buscar_compras_gastos_admin(integer,integer)','obtener_compra_gasto_admin(uuid)']
    calls=["SELECT crear_proveedor_admin('00000000-0000-4000-8000-000000000021','x')","SELECT * FROM buscar_proveedores_admin()",call('00000000-0000-4000-8000-000000000010'),"SELECT * FROM buscar_compras_gastos_admin()", "SELECT obtener_compra_gasto_admin('00000000-0000-4000-8000-000000000010')"]
    for sig,q in zip(signatures,calls):
        check('metadata '+sig,f"SELECT prosecdef AND proconfig=ARRAY['search_path=\"\"'] AND proowner='postgres'::regrole AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0) FROM pg_proc WHERE oid='{sig}'::regprocedure")
        reject('non-admin '+sig,auth(q,'00000000-0000-4000-8000-000000000008').removeprefix('BEGIN; '),'No autorizado')
        reject('anon '+sig,'SET LOCAL ROLE anon; '+q,'permission denied')
    for role in ['anon','authenticated','service_role']:
        check('tables closed '+role,f"SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv WHERE c.relname IN ('proveedores','compras_gastos','items_compras_gastos','operaciones_compras_gastos','operaciones_altas_proveedores') AND has_table_privilege('{role}',c.oid,priv))")
    check('RLS/no policies',"SELECT count(*)=5 AND bool_and(relrowsecurity) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('proveedores'::regclass,'compras_gastos'::regclass,'items_compras_gastos'::regclass,'operaciones_compras_gastos'::regclass,'operaciones_altas_proveedores'::regclass)) FROM pg_class WHERE relname IN ('proveedores','compras_gastos','items_compras_gastos','operaciones_compras_gastos','operaciones_altas_proveedores')")
    success('supplier name lookup',"SELECT * FROM buscar_proveedores_admin('prove')")
    op='00000000-0000-4000-8000-000000000010'
    result=json.loads(success('MERCADERIA one item',call(op)))
    again=json.loads(success('same request retry',call(op))); assert again['compra_gasto_id']==result['compra_gasto_id'] and again['ya_procesada']
    check('no duplicate header/items',"SELECT (SELECT count(*)=1 FROM compras_gastos) AND (SELECT count(*)=1 FROM items_compras_gastos)")
    reject('different payload',auth(call(op,tipo='GASTO')).removeprefix('BEGIN; '),'Operación utilizada')
    reject('different actor',auth(call(op),other).removeprefix('BEGIN; '),'Operación utilizada')
    success('same purchase distinct operation',call('00000000-0000-4000-8000-000000000011'))
    multi=[{'posicion':2,'descripcion':'B','cantidad':1,'costo_unitario':2},{'posicion':1,'descripcion':'A','cantidad':2,'costo_unitario':3}]
    success('multiple items',call('00000000-0000-4000-8000-000000000012',multi))
    success('canonical item ordering retry',call('00000000-0000-4000-8000-000000000012',list(reversed(multi))))
    success('GASTO',call('00000000-0000-4000-8000-000000000013',tipo='GASTO'))
    for label,items in [('no items',[]),('bad late item',[multi[0],{'posicion':1,'descripcion':'','cantidad':0,'costo_unitario':1}]),('client total',[dict(multi[0],total=5)]),('duplicate position',[multi[0],multi[0]]),('null numeric',[dict(multi[0],cantidad=None)]),('string numeric',[dict(multi[0],cantidad='1')])]:
        counts=sql('SELECT count(*) FROM compras_gastos; SELECT count(*) FROM items_compras_gastos; SELECT count(*) FROM operaciones_compras_gastos').stdout
        reject(label,auth(call('00000000-0000-4000-8000-000000000014',items)).removeprefix('BEGIN; '),'ERROR:')
        assert counts==sql('SELECT count(*) FROM compras_gastos; SELECT count(*) FROM items_compras_gastos; SELECT count(*) FROM operaciones_compras_gastos').stdout
    reject('unknown supplier',auth(call('00000000-0000-4000-8000-000000000014',provider='00000000-0000-4000-8000-000000000099')).removeprefix('BEGIN; '),'Proveedor inexistente')
    sql(f"UPDATE proveedores SET activo=false WHERE id='{supplier}'")
    reject('inactive supplier',auth(call('00000000-0000-4000-8000-000000000014')).removeprefix('BEGIN; '),'Proveedor inexistente')
    check('inactive excluded',f"SELECT count(*)=0 FROM (SELECT * FROM buscar_proveedores_admin()) x WHERE id='{supplier}'".replace('SELECT count',f"SET test.uid='{actor}'; SELECT count"))
    success('retry after supplier inactive',call(op))
    sql(f"UPDATE proveedores SET activo=true WHERE id='{supplier}'")
    detail=json.loads(success('detail',f"SELECT obtener_compra_gasto_admin('{result['compra_gasto_id']}')")); assert detail['total']==1.01 and len(detail['items'])==1
    check('list derived total',f"SET test.uid='{actor}'; SELECT total=1.01 AND cantidad_items=1 FROM buscar_compras_gastos_admin() WHERE id='{result['compra_gasto_id']}'")
    # Two independent connections: second request demonstrably blocked on operation lock.
    args=[str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55491','-U','postgres','-d','postgres']
    raceop='00000000-0000-4000-8000-000000000015'
    a=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    a.stdin.write(f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; {call(raceop)}; SELECT 'READY';\n"); a.stdin.flush()
    while a.stdout.readline().strip()!='READY':
        assert a.poll() is None,'first connection failed'
    b=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    b.stdin.write("SET application_name='11d2_second'; "+auth(call(raceop))+"\n\\q\n"); b.stdin.flush()
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        if sql("SELECT exists(SELECT 1 FROM pg_stat_activity WHERE application_name='11d2_second' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip()=='t': break
        time.sleep(.05)
    else: raise AssertionError('second request did not block')
    a.stdin.write('COMMIT;\n\\q\n'); a.stdin.flush(); ao,ae=a.communicate(timeout=10); assert a.returncode==0,ae
    bo,be=b.communicate(timeout=10); assert b.returncode==0,be; assert json.loads(bo.strip())['ya_procesada']
    check('real concurrent retry one result',f"SELECT count(*)=1 FROM operaciones_compras_gastos WHERE operacion_id='{raceop}'")
    # Error real después de insertar cabecera y comenzar INSERT de ítems.
    sql("""CREATE FUNCTION public.test_fail_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.posicion=2 THEN RAISE EXCEPTION 'deliberate item failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_fail BEFORE INSERT ON items_compras_gastos FOR EACH ROW EXECUTE FUNCTION test_fail_item();""")
    counts=sql('SELECT count(*) FROM compras_gastos; SELECT count(*) FROM items_compras_gastos; SELECT count(*) FROM operaciones_compras_gastos').stdout
    reject('failure during item insertion rolls back header/items/operation',auth(call('00000000-0000-4000-8000-000000000016',multi)).removeprefix('BEGIN; '),'deliberate item failure')
    assert counts==sql('SELECT count(*) FROM compras_gastos; SELECT count(*) FROM items_compras_gastos; SELECT count(*) FROM operaciones_compras_gastos').stdout
    sql('DROP TRIGGER test_fail ON items_compras_gastos; DROP FUNCTION test_fail_item()')
    reject('authenticated without uid', "SET LOCAL ROLE authenticated; SELECT crear_proveedor_admin('00000000-0000-4000-8000-000000000021','x')", 'No autorizado')
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(sql,auth(call(f'00000000-0000-4000-8000-{n:012d}'))) for n in (17,18)]
        results=[json.loads(f.result().stdout.strip()) for f in futures]
    assert results[0]['compra_gasto_id']!=results[1]['compra_gasto_id']
    passed+=1; print('PASS: distinct simultaneous operations remain distinct')
    provider_race=provider_call.replace('000000000020','000000000024')
    a=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    a.stdin.write(f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; {provider_race}; SELECT 'READY';\n"); a.stdin.flush()
    first_provider=None
    while True:
        line=a.stdout.readline().strip()
        if line=='READY': break
        if line.startswith('{'): first_provider=json.loads(line)
        assert a.poll() is None,'provider first connection failed'
    b=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    b.stdin.write("SET application_name='11d2_provider_second'; "+auth(provider_race)+"\n\\q\n"); b.stdin.flush()
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        if sql("SELECT exists(SELECT 1 FROM pg_stat_activity WHERE application_name='11d2_provider_second' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip()=='t': break
        time.sleep(.05)
    else: raise AssertionError('provider second request did not block')
    a.stdin.write('COMMIT;\n\\q\n'); a.stdin.flush(); ao,ae=a.communicate(timeout=10); assert a.returncode==0,ae
    bo,be=b.communicate(timeout=10); assert b.returncode==0,be
    assert json.loads(bo.strip())==first_provider
    check('provider concurrent retry one supplier', "SELECT count(*)=1 FROM operaciones_altas_proveedores WHERE operacion_id='00000000-0000-4000-8000-000000000024'")
    print(f'PASS: {passed} checks; PostgreSQL local only')
finally:
    if run([str(BIN/'pg_ctl'),'-D',str(DATA),'status']).returncode==0:
        r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop']); assert r.returncode==0,r.stderr
