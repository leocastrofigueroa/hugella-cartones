"""11D.5.4: PostgreSQL 17 privado, sin TCP ni credenciales remotas."""
import os
from pathlib import Path
import subprocess
import tempfile
import json

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG','PSQL'))}
BASE = Path(tempfile.mkdtemp(prefix='hg-compra-financiada-',dir='/private/tmp'))
DATA, SOCKET = BASE/'data', BASE/'socket'
SOCKET.mkdir(mode=0o700)
passed = 0
uid = lambda n: f'00000000-0000-4000-8000-{n:012d}'
actor, other, nonadmin, supplier = map(uid,[1,2,3,4])

def run(args, **kwargs):
    return subprocess.run(args,env=ENV,text=True,capture_output=True,**kwargs)

def sql(q,ok=True):
    r=run([str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55494','-U','postgres','-d','postgres'],input=q,timeout=45)
    if ok: assert r.returncode==0,r.stderr
    return r

def mark(label):
    global passed
    passed+=1
    print('PASS:',label,flush=True)

def check(label,q):
    assert sql(q).stdout.strip()=='t',label
    mark(label)

def auth(q,who=actor):
    return f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{who}'; {q}; COMMIT;"

def result(q,who=actor):
    return json.loads(sql(auth('SELECT '+q,who)).stdout.strip())

def reject(label,q,message,who=actor,raw=False):
    r=sql('BEGIN; '+q+'; COMMIT;' if raw else auth('SELECT '+q,who),False)
    assert r.returncode!=0 and message in r.stderr,(label,r.stderr)
    mark(label)

def lit(value):
    if value is None: return 'NULL'
    return "'"+str(value).replace("'","''")+"'"

def rpc(name,*args):
    return name+'('+','.join(lit(x) for x in args)+')'

def purchase(n,total=100):
    sql(f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES ('{uid(n)}','GASTO','{supplier}','2026-10-10','ARS','{actor}'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('{uid(n)}',1,'fixture',1,{total});")
    return uid(n)

def financing(op,n,tramos):
    return rpc('confirmar_financiacion_compra_admin',uid(op),uid(n),json.dumps(tramos))

def credit(amount=100,cuotas=3,first=None,position=1):
    return dict(posicion=position,medio='TARJETA_CREDITO',importe=amount,tarjeta_id=card,cantidad_cuotas=cuotas,primer_periodo_id=first)

def pay(op,period,amount):
    return rpc('registrar_pago_resumen_tarjeta_admin',uid(op),period,'2026-11-02',amount,'  referencia  ')

migration=(ROOT/'supabase/migrations/202610110003_compra_financiada_admin.sql').read_text()
TABLES=['proveedores','compras_gastos','items_compras_gastos','operaciones_compras_gastos',
        'operaciones_altas_proveedores','tarjetas_credito','financiaciones_compras','periodos_tarjetas',
        'tramos_pago_compras','obligaciones_tarjetas','pagos_resumenes_tarjetas',
        'aplicaciones_pagos_obligaciones','operaciones_financieras_compras','inicios_tramos_tarjeta',
        'comprobantes_compras_gastos','storage.buckets','storage.objects']
def snapshot():
    return sql("SELECT jsonb_build_object("+','.join(lit(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM "+t+" x)" for t in TABLES)+")").stdout

def create(op,total=100,tramos=None,items=None,comprobante=' ',observaciones=None):
    items=items if items is not None else [dict(posicion=1,descripcion=' fixture ',cantidad=1,costo_unitario=total)]
    tramos=tramos if tramos is not None else [immediate(total)]
    return rpc('crear_compra_financiada_admin',uid(op),'GASTO',supplier,'2026-10-10','ARS',comprobante,observaciones,json.dumps(items),json.dumps(tramos))
def immediate(amount=100,medio='EFECTIVO',position=1):
    return dict(posicion=position,medio=medio,importe=amount,fecha_pago='2026-10-10')
def detail(id): return result(rpc('obtener_detalle_financiacion_compra_admin',id))
def summaries(card,limit=50,offset=0):
    return result("(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM listar_resumenes_tarjeta_admin("+','.join(lit(v) for v in [card,limit,offset])+") x)")
def unchanged_reject(label,q,msg,who=actor,raw=False):
    before=snapshot(); reject(label,q,msg,who,raw); assert snapshot()==before
    mark(label+' complete rollback, all facts/operations/receipts unchanged')

def contend(aq,bq):
    # Hold the first completed RPC transaction, observe the second actually blocked.
    import time
    args=[str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55494','-U','postgres','-d','postgres']
    a=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    b=None
    try:
        a.stdin.write(f"SET application_name='atomic_first'; BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; SELECT {aq};\n"); a.stdin.flush()
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='atomic_first' AND state='idle in transaction')").stdout.strip()=='t':break
            time.sleep(.02)
        else: raise AssertionError('first RPC did not complete and hold transaction')
        b=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        b.stdin.write("SET application_name='atomic_second'; "+auth('SELECT '+bq)+"\n\\q\n"); b.stdin.flush()
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='atomic_second' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip()=='t':break
            time.sleep(.02)
        else: raise AssertionError('second RPC did not contend on lock')
        a.stdin.write('COMMIT;\n\\q\n'); a.stdin.flush()
        ao,ae=a.communicate(timeout=20); bo,be=b.communicate(timeout=20)
        assert a.returncode==b.returncode==0,(ae,be)
        return json.loads(ao),json.loads(bo)
    finally:
        for proc in [a,b]:
            if proc is not None and proc.poll() is None:
                proc.kill(); proc.communicate()

try:
    r=run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']); assert r.returncode==0,r.stderr
    r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p 55494 -c listen_addresses=''",'-w','start']); assert r.returncode==0,r.stderr
    sql(f"""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('{actor}'),('{other}'),('{nonadmin}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('{actor}'::uuid,'{other}'::uuid) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    """)
    for name in ['202610090003_compras_gastos_base.sql','202610090004_compras_gastos_rpc_admin.sql',
                 '202610100001_comprobantes_compras_gastos.sql','202610110001_financiacion_compras_base.sql',
                 '202610110002_financiacion_compras_rpc_admin.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES ('{supplier}','fixture','{actor}')")
    purchase(10)
    receipt=uid(20)
    sql("SET ROLE service_role; SELECT "+rpc('reservar_comprobante_compra_gasto_servidor',receipt,uid(10),actor,'foto.png','image/png',70,'a'*64)+"; RESET ROLE;")
    path=sql(f"SELECT ruta FROM comprobantes_compras_gastos WHERE id='{receipt}'").stdout.strip()
    sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES ('compras-gastos-privados','{path}');")
    sql("SET ROLE service_role; SELECT "+rpc('confirmar_comprobante_compra_gasto_servidor',receipt,actor,'a'*64,70)+"; RESET ROLE;")
    catalog="SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace),'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE NOT tgisinternal),'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE relnamespace='public'::regnamespace),'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE connamespace='public'::regnamespace))"
    before_data=snapshot(); before_catalog=sql(catalog).stdout
    reject('deliberate installation rollback',migration.replace('commit;','SELECT 1/0; commit;'),'division by zero',raw=True)
    assert snapshot()==before_data and sql(catalog).stdout==before_catalog
    mark('installation failure preserves full previous catalog/data')
    sql('ALTER TABLE compras_gastos DISABLE TRIGGER compra_financiada_inmutable')
    reject('disabled baseline trigger aborts',migration,'Trigger financiero incompatible',raw=True)
    sql('ALTER TABLE compras_gastos ENABLE TRIGGER compra_financiada_inmutable')
    sql(migration)
    assert snapshot()==before_data
    mark('installation seeds no financial or purchase facts; receipts untouched')
    old=json.loads(before_catalog); current=json.loads(sql(catalog).stdout)
    byid={p['oid']:p for p in current['functions']}
    assert all(byid[p['oid']]==p for p in old['functions'])
    assert current['triggers']==old['triggers'] and current['tables']==old['tables']
    mark('all installed RPCs/triggers/table ACL/RLS/catalog unchanged')
    for fn in ['crear_compra_financiada_admin','obtener_detalle_financiacion_compra_admin','listar_resumenes_tarjeta_admin']:
        check(fn+' one postgres definer empty path authenticated only',f"SELECT count(*)=1 AND bool_and(proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=\"\"'] AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE')) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl WHERE p.proname='{fn}' AND acl.grantee=0) FROM pg_proc WHERE proname='{fn}'")
    for role in ['anon','authenticated','service_role']:
        check(role+' no direct financial table grants',f"SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv WHERE c.relname IN ('compras_gastos','items_compras_gastos','financiaciones_compras','operaciones_compras_gastos','operaciones_financieras_compras','tramos_pago_compras','obligaciones_tarjetas','periodos_tarjetas','pagos_resumenes_tarjetas','aplicaciones_pagos_obligaciones','inicios_tramos_tarjeta') AND has_table_privilege('{role}',c.oid,priv))")
    card=result(rpc('crear_tarjeta_credito_admin',uid(100),'Test card','Test bank'))['tarjeta_id']
    p1=result(rpc('registrar_periodo_tarjeta_admin',uid(101),card,'2026-10-20','2026-11-01'))['periodo_id']
    p2=result(rpc('registrar_periodo_tarjeta_admin',uid(102),card,'2026-11-20','2026-12-01'))['periodo_id']
    othercard=result(rpc('crear_tarjeta_credito_admin',uid(103),'Other','Test bank'))['tarjeta_id']
    otherperiod=result(rpc('registrar_periodo_tarjeta_admin',uid(104),othercard,'2026-10-20','2026-11-01'))['periodo_id']
    assert summaries(card)[0]['estado']=='SIN_OBLIGACIONES'
    mark('summary SIN_OBLIGACIONES with real zero facts')
    for n,medio in [(200,'EFECTIVO'),(201,'TRANSFERENCIA'),(202,'TARJETA_DEBITO')]:
        q=create(n,tramos=[immediate(medio=medio)])
        first=result(q); assert result(q)==first
        d=detail(first['compra_id'])
        assert d['total_compra']==100 and d['total_pagado']==100 and d['saldo_pendiente']==0 and d['estado']=='CANCELADA'
        assert len(d['formas_pago'])==1 and d['formas_pago'][0]['medio']==medio and d['cuotas']==[]
        mark(medio+' atomic purchase/detail/retry one real immediate fact')
        check(medio+' exactly three operation records',f"SELECT (SELECT count(*)=1 FROM operaciones_compras_gastos WHERE operacion_id='{first['operacion_compra_id']}') AND (SELECT count(*)=2 FROM operaciones_financieras_compras WHERE operacion_id IN ('{uid(n)}','{first['operacion_financiacion_id']}'))")
    zero=result(create(203,total=0,tramos=[]))
    assert zero['tramos']==[] and detail(zero['compra_id'])['estado']=='CANCELADA'
    check('zero total no invented tranche/payment/obligation',f"SELECT NOT EXISTS(SELECT 1 FROM tramos_pago_compras WHERE compra_id='{zero['compra_id']}') AND NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas WHERE compra_id='{zero['compra_id']}')")
    unassigned=result(create(204,tramos=[credit()]))
    ud=detail(unassigned['compra_id'])
    assert [x['importe'] for x in ud['cuotas']]==[33.34,33.33,33.33] and all(x['periodo_id'] is None and x['fecha_cierre'] is None and x['fecha_vencimiento'] is None and x['estado']=='PENDIENTE' for x in ud['cuotas'])
    assert ud['total_pagado']==0 and ud['saldo_pendiente']==100 and ud['formas_pago'][0]['primer_periodo_id'] is None
    mark('credit 100/3 exact cents, no invented first period, NULL quotas pending')
    assigned=result(create(205,tramos=[credit(first=p1)]))
    ad=detail(assigned['compra_id'])
    assert [x['periodo_id'] for x in ad['cuotas']]==[p1,p2,None]
    assert ad['formas_pago'][0]['tarjeta_nombre']=='Test card' and ad['formas_pago'][0]['entidad']=='Test bank' and ad['formas_pago'][0]['primer_periodo_id']==p1
    mark('explicit first period, correct card detail, insufficient periods leave rest NULL')
    combined=result(create(206,total=20,tramos=[immediate(10,position=2),credit(10,1,otherperiod,1)|{'tarjeta_id':othercard}]))
    cd=detail(combined['compra_id']); assert cd['total_pagado']==10 and cd['saldo_pendiente']==10 and cd['estado']=='ACTIVA'
    assert [f['posicion'] for f in cd['formas_pago']]==[1,2]
    mark('combined sorted forms, immediate paid once, only credit debt outstanding')
    assert summaries(card)[0]['estado']=='PENDIENTE'
    mark('summary PENDIENTE from obligations not dates')
    result(pay(207,p1,10))
    d=detail(assigned['compra_id']); assert d['cuotas'][0]['estado']=='PAGO_PARCIAL' and d['cuotas'][0]['total_aplicado']==10 and d['cuotas'][0]['saldo']==23.34
    assert summaries(card)[0]['estado']=='PAGO_PARCIAL'
    mark('quota/summary partial from real payment applications')
    result(pay(208,p1,23.34))
    d=detail(assigned['compra_id']); assert d['cuotas'][0]['estado']=='PAGADA' and d['cuotas'][0]['saldo']==0
    assert summaries(card)[0]['estado']=='PAGADO'
    mark('quota PAGADA and summary PAGADO only fully paid positive obligations')
    assert summaries(card)[0]['total_pagado']==summaries(card)[0]['total_obligaciones_hugella']==33.34
    mark('summary totals do not multiply two payments')
    assert summaries(card,1,1)[0]['periodo_id']==p2 and len(summaries(card,1,0))==1 and summaries(card,1,2)==[]
    mark('summary pagination and stable period order')
    historical=detail(uid(10)); assert historical['estado']=='FINANCIACION_NO_REGISTRADA' and historical['total_pagado'] is None and historical['saldo_pendiente'] is None and historical['formas_pago']==historical['cuotas']==[]
    mark('historical purchase without finance no fabricated facts')
    before=snapshot(); detail(assigned['compra_id']); summaries(card); detail(uid(10)); assert snapshot()==before
    mark('both financial readers strictly read-only')
    stable=result(create(209)); assert result(create(209))==stable
    unchanged_reject('same external UUID changed payload',create(209,total=101),'Operación utilizada')
    unchanged_reject('same external UUID changed actor',create(209),'Operación utilizada',who=other)
    # Trimming, decimal number representation, optional nulls, and ordering agree with installed canonicalizers.
    items=[dict(posicion=2,descripcion=' second ',cantidad=1,costo_unitario=50),dict(posicion=1,descripcion=' first ',cantidad=1,costo_unitario=50)]
    tramos=[immediate(50,position=2),immediate(50,position=1)]
    canonical=result(create(210,items=items,tramos=tramos,observaciones=' note '))
    equivalentitems=[dict(posicion=1,descripcion='first',cantidad=1.0,costo_unitario=50.0),dict(posicion=2,descripcion='second',cantidad=1,costo_unitario=50)]
    equivalenttramos=[immediate(50.0,position=1)|{'tarjeta_id':None,'cantidad_cuotas':None,'primer_periodo_id':None},immediate(50,position=2)]
    assert result(create(210,items=equivalentitems,tramos=equivalenttramos,comprobante=None,observaciones='note'))==canonical
    mark('complete canonical payload matches trimmed/reordered/null/numeric retry')
    check('canonical outer request equals installed child requests',f"SELECT (outerop.solicitud->'compra')=co.solicitud AND outerop.solicitud->'tramos'=fin.solicitud->'tramos' AND outerop.resultado->>'compra_id'=co.compra_gasto_id::text FROM operaciones_financieras_compras outerop JOIN operaciones_compras_gastos co ON co.operacion_id='{canonical['operacion_compra_id']}' JOIN operaciones_financieras_compras fin ON fin.operacion_id='{canonical['operacion_financiacion_id']}' WHERE outerop.operacion_id='{uid(210)}'")
    for label,q,msg in [
        ('incorrect tranche sum',create(220,tramos=[immediate(99)]),'Suma de tramos'),
        ('missing card',create(221,tramos=[credit()|{'tarjeta_id':uid(999)}]),'Tarjeta inexistente'),
        ('wrong first period',create(222,tramos=[credit(first=otherperiod)]),'Primer período incompatible'),
        ('COMBINADO invalid atomic medium',create(223,tramos=[immediate(medio='COMBINADO')]),'Medio o importe'),
        ('unknown item trusted total',create(224,items=[dict(posicion=1,descripcion='x',cantidad=1,costo_unitario=100,total=100)]),'Campos de ítem'),
        ('numeric string amount',create(225,tramos=[credit()|{'importe':'100'}]),'Campos de tramo'),
        ('fractional installments',create(226,tramos=[credit(cuotas=2.5)]),'Cuotas de tarjeta'),
        ('immediate missing payment date',create(227,tramos=[immediate()|{'fecha_pago':None}]),'Tramo inmediato'),
        ('zero total positive fake tranche',create(228,total=0,tramos=[immediate(100)]),'Suma de tramos')]:
        unchanged_reject(label,q,msg)
    for q in [create(230),rpc('obtener_detalle_financiacion_compra_admin',assigned['compra_id']),rpc('listar_resumenes_tarjeta_admin',card)]:
        unchanged_reject('nonadmin '+q.split('(')[0],q,'No autorizado',who=nonadmin)
        unchanged_reject('missing uid '+q.split('(')[0],q,'No autorizado',who='')
    for isolation in ['REPEATABLE READ','SERIALIZABLE']:
        unchanged_reject('fixed snapshot rejected '+isolation,f"SET TRANSACTION ISOLATION LEVEL {isolation}; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; SELECT {create(231)}",'READ COMMITTED',raw=True)
    for limit,offset in [(0,0),(101,0),(None,0),(50,-1),(50,None)]:
        unchanged_reject('invalid pagination '+str((limit,offset)),rpc('listar_resumenes_tarjeta_admin',card,limit,offset),'Paginación inválida')
    unchanged_reject('missing purchase',rpc('obtener_detalle_financiacion_compra_admin',uid(999)),'Compra inexistente')
    unchanged_reject('unknown card reader',rpc('listar_resumenes_tarjeta_admin',uid(999)),'Tarjeta inexistente')
    fractional=result(create(250,total=0.02,items=[dict(posicion=1,descripcion='fractional',cantidad=0.333333,costo_unitario=0.05)],tramos=[immediate(0.02)]))
    assert detail(fractional['compra_id'])['total_compra']==0.02
    mark('original per-item round(quantity * unit cost,2) retained exactly')
    check('PUBLIC no direct table grants',"SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.relname IN ('operaciones_financieras_compras','operaciones_compras_gastos','compras_gastos','items_compras_gastos') AND acl.grantee=0)")
    # The child UUID cannot adopt a previously independent purchase even with identical content.
    occupied=uid(232)
    internal=sql(f"SELECT md5('hugella:compra-financiada:compra:v1:'||'{occupied}')::uuid").stdout.strip()
    result(rpc('crear_compra_gasto_admin',internal,'GASTO',supplier,'2026-10-10','ARS',None,None,json.dumps([dict(posicion=1,descripcion='fixture',cantidad=1,costo_unitario=100)])))
    unchanged_reject('occupied deterministic child identity',create(232),'Identidad interna ya utilizada')
    internal_fin=sql(f"SELECT md5('hugella:compra-financiada:financiacion:v1:'||'{uid(237)}')::uuid").stdout.strip()
    result(rpc('crear_tarjeta_credito_admin',internal_fin,'Occupied financial child','Test bank'))
    unchanged_reject('occupied deterministic financial child',create(237),'Identidad interna ya utilizada')
    result(rpc('crear_tarjeta_credito_admin',uid(233),'Collision','Test bank'))
    unchanged_reject('outer UUID used by another action',create(233),'Operación utilizada')
    sql("CREATE FUNCTION fail_atomic_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.accion='COMPRA_FINANCIADA' THEN RAISE EXCEPTION 'fixture final audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_atomic_fixture BEFORE INSERT ON operaciones_financieras_compras FOR EACH ROW EXECUTE FUNCTION fail_atomic_fixture();")
    unchanged_reject('failure at final outer audit',create(234,tramos=[credit(first=p1)]),'fixture final audit failure')
    sql('DROP TRIGGER fail_atomic_fixture ON operaciones_financieras_compras; DROP FUNCTION fail_atomic_fixture();')
    # Actual installed deferred invariant, corrupted only by a local fixture AFTER insert.
    sql("CREATE FUNCTION corrupt_atomic_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.obligaciones_tarjetas SET importe=importe+0.01 WHERE id=NEW.id; RETURN NULL; END $$; CREATE TRIGGER corrupt_atomic_fixture AFTER INSERT ON obligaciones_tarjetas FOR EACH ROW EXECUTE FUNCTION corrupt_atomic_fixture();")
    unchanged_reject('deferred cents constraint complete rollback',create(235,tramos=[credit()]),'Distribución de centavos incompatible')
    sql('DROP TRIGGER corrupt_atomic_fixture ON obligaciones_tarjetas; DROP FUNCTION corrupt_atomic_fixture();')
    # First RPC returns inside a transaction, but a later transaction error revokes all facts.
    unchanged_reject('caller rollback after successful RPC',f"SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; SELECT {create(236)}; SELECT 1/0",'division by zero',raw=True)
    concurrentq=create(240,tramos=[credit(first=p1)])
    ar,br=contend(concurrentq,concurrentq); assert ar==br
    concurrent_result=ar
    mark('simultaneous same UUID observed blocked then exact persisted result')
    check('concurrent request exactly one purchase/finance/three ops/three quotas',f"SELECT (SELECT count(*)=1 FROM compras_gastos WHERE id='{ar['compra_id']}') AND (SELECT count(*)=1 FROM financiaciones_compras WHERE compra_id='{ar['compra_id']}') AND (SELECT count(*)=1 FROM operaciones_compras_gastos WHERE operacion_id='{ar['operacion_compra_id']}') AND (SELECT count(*)=2 FROM operaciones_financieras_compras WHERE operacion_id IN ('{uid(240)}','{ar['operacion_financiacion_id']}')) AND (SELECT count(*)=3 FROM obligaciones_tarjetas WHERE compra_id='{ar['compra_id']}')")
    ar,br=contend(create(241,tramos=[credit()]),rpc('registrar_periodo_tarjeta_admin',uid(242),card,'2026-12-20','2027-01-01'))
    mark('atomic creation vs installed period RPC global lock compatible no deadlock')
    ar,br=contend(create(243,tramos=[credit()]),pay(244,otherperiod,1))
    mark('atomic creation vs installed payment RPC locks compatible no deadlock')
    assert detail(combined['compra_id'])['total_pagado']==11 and detail(combined['compra_id'])['saldo_pendiente']==9
    mark('immediate tranche counted once after real credit payment')
    pastcard=result(rpc('crear_tarjeta_credito_admin',uid(245),'Past period','Test bank'))['tarjeta_id']
    pastperiod=result(rpc('registrar_periodo_tarjeta_admin',uid(246),pastcard,'2020-01-20','2020-02-01'))['periodo_id']
    pastpurchase=result(create(247,tramos=[credit(100,1,pastperiod)|{'tarjeta_id':pastcard}]))
    assert detail(pastpurchase['compra_id'])['cuotas'][0]['estado']=='PENDIENTE' and summaries(pastcard)[0]['estado']=='PENDIENTE'
    mark('past due date never infers payment for quota/summary')
    sql(f"UPDATE proveedores SET activo=false WHERE id='{supplier}'; UPDATE tarjetas_credito SET activo=false WHERE id='{card}';")
    assert result(concurrentq)==concurrent_result
    assert result(create(209))==stable
    mark('confirmed retry independent of later supplier/card activity')
    check('no duplicate quotas anywhere',"SELECT NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas GROUP BY tramo_id,numero_cuota HAVING count(*)>1)")
    check('all outer operations complete with both deterministic child operations',"SELECT NOT EXISTS(SELECT 1 FROM operaciones_financieras_compras outerop LEFT JOIN operaciones_compras_gastos co ON co.operacion_id=(outerop.resultado->>'operacion_compra_id')::uuid LEFT JOIN operaciones_financieras_compras fin ON fin.operacion_id=(outerop.resultado->>'operacion_financiacion_id')::uuid WHERE outerop.accion='COMPRA_FINANCIADA' AND (co.compra_gasto_id IS DISTINCT FROM (outerop.resultado->>'compra_id')::uuid OR fin.accion IS DISTINCT FROM 'FINANCIACION' OR fin.solicitud->>'compra_id' IS DISTINCT FROM co.compra_gasto_id::text))")
    receipt_before=sql(f"SELECT to_jsonb(c) FROM comprobantes_compras_gastos c WHERE id='{receipt}'").stdout
    assert result(rpc('obtener_comprobante_compra_gasto_admin',receipt))['estado']=='DISPONIBLE'
    assert sql(f"SELECT to_jsonb(c) FROM comprobantes_compras_gastos c WHERE id='{receipt}'").stdout==receipt_before
    mark('real installed receipts metadata/Storage/authorization unchanged')
    check('economic expression still exact',"SELECT attgenerated='s' AND pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)' FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='items_compras_gastos'::regclass AND a.attname='total'")
    print(f'PASS: {passed} checks; PostgreSQL local only',flush=True)
finally:
    if run([str(BIN/'pg_ctl'),'-D',str(DATA),'status']).returncode==0:
        r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop']); assert r.returncode==0,r.stderr
