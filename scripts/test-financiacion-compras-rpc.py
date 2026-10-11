"""11D.5.3: PostgreSQL 17 privado, sin TCP ni credenciales remotas."""
import os
from pathlib import Path
import subprocess
import tempfile
import json
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG','PSQL'))}
BASE = Path(tempfile.mkdtemp(prefix='hg-finanzas-rpc-',dir='/private/tmp'))
DATA, SOCKET = BASE/'data', BASE/'socket'
SOCKET.mkdir(mode=0o700)
passed = 0
uid = lambda n: f'00000000-0000-4000-8000-{n:012d}'
actor, other, nonadmin, supplier = map(uid,[1,2,3,4])

def run(args, **kwargs):
    return subprocess.run(args,env=ENV,text=True,capture_output=True,**kwargs)

def sql(q,ok=True):
    r=run([str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55493','-U','postgres','-d','postgres'],input=q,timeout=45)
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

migration=(ROOT/'supabase/migrations/202610110002_financiacion_compras_rpc_admin.sql').read_text()
try:
    r=run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']); assert r.returncode==0,r.stderr
    r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p 55493 -c listen_addresses=''",'-w','start']); assert r.returncode==0,r.stderr
    sql(f"""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('{actor}'),('{other}'),('{nonadmin}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('{actor}'::uuid,'{other}'::uuid) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;
    """)
    for name in ['202610090003_compras_gastos_base.sql','202610090004_compras_gastos_rpc_admin.sql','202610110001_financiacion_compras_base.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES ('{supplier}','fixture','{actor}')")
    purchase(10)
    snap="""SELECT jsonb_build_object('helpers',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace), 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE NOT tgisinternal),'items',(SELECT jsonb_agg(to_jsonb(i)) FROM items_compras_gastos i),'purchase',(SELECT jsonb_agg(to_jsonb(c)) FROM compras_gastos c))"""
    before=sql(snap).stdout
    r=sql(migration.replace('commit;','SELECT 1/0; commit;'),False)
    assert r.returncode!=0 and 'division by zero' in r.stderr,r.stderr
    check('deliberate installation rollback',"SELECT to_regclass('operaciones_financieras_compras') IS NULL AND to_regprocedure('crear_tarjeta_credito_admin(uuid,text,text)') IS NULL")
    assert before==sql(snap).stdout
    mark('installation rollback preserves previous catalog/data')
    sql('ALTER TABLE compras_gastos DISABLE TRIGGER compra_financiada_inmutable')
    r=sql(migration,False)
    assert r.returncode!=0 and 'Trigger financiero incompatible' in r.stderr,r.stderr
    sql('ALTER TABLE compras_gastos ENABLE TRIGGER compra_financiada_inmutable')
    mark('disabled baseline trigger aborts installation')
    sql(migration)
    check('no seeded financial facts',"SELECT (SELECT count(*) FROM tarjetas_credito)=0 AND (SELECT count(*) FROM financiaciones_compras)=0 AND (SELECT count(*) FROM operaciones_financieras_compras)=0")
    # Migration must not replace any previous helper/RPC or economic expression.
    old=json.loads(before)
    current=json.loads(sql(snap).stdout)
    byid={p['oid']:p for p in current['helpers']}
    assert all(byid[p['oid']]==p for p in old['helpers'])
    assert current['triggers']==old['triggers'] and current['items']==old['items'] and current['purchase']==old['purchase']
    mark('old helpers/RPC/triggers/data unchanged')
    check('economic generated expression unchanged',"SELECT attgenerated='s' AND pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)' FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='items_compras_gastos'::regclass AND a.attname='total'")
    newnames=['iniciar_operacion_financiera_compras','finalizar_operacion_financiera_compras','asignar_obligaciones_tarjeta_interno','crear_tarjeta_credito_admin','registrar_periodo_tarjeta_admin','confirmar_financiacion_compra_admin','seleccionar_primer_periodo_tramo_admin','registrar_pago_resumen_tarjeta_admin','obtener_financiacion_compra_admin','obtener_saldo_periodo_tarjeta_admin','listar_tarjetas_financieras_admin','listar_periodos_tarjeta_admin']
    quoted=','.join(lit(x) for x in newnames)
    check('12 functions metadata owner/security/search_path',f"SELECT count(*)=12 AND bool_and(proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=\"\"']) FROM pg_proc WHERE proname IN ({quoted})")
    for role in ['anon','authenticated','service_role']:
        check(role+' no new direct table access',f"SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv WHERE c.relname IN ('operaciones_financieras_compras','inicios_tramos_tarjeta') AND has_table_privilege('{role}',c.oid,priv))")
        check(role+' no private helpers execute',f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ({','.join(lit(x) for x in newnames[:3])}) AND has_function_privilege('{role}',oid,'EXECUTE'))")
        if role!='authenticated':
            check(role+' no user RPC execute',f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ({quoted}) AND has_function_privilege('{role}',oid,'EXECUTE'))")
    check('PUBLIC no execute',f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.proname IN ({quoted}) AND a.grantee=0)")
    check('new tables owner RLS no policies',"SELECT count(*)=2 AND bool_and(relowner='postgres'::regrole AND relrowsecurity) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ('operaciones_financieras_compras'::regclass,'inicios_tramos_tarjeta'::regclass)) FROM pg_class WHERE relname IN ('operaciones_financieras_compras','inicios_tramos_tarjeta')")
    q=rpc('crear_tarjeta_credito_admin',uid(100),' Visa Santander ',' Santander ')
    card=result(q)['tarjeta_id']; mark('create card trimmed explicit only')
    for isolation in ['REPEATABLE READ','SERIALIZABLE']:
        reject('fixed snapshot isolation rejected '+isolation,
            f"SET TRANSACTION ISOLATION LEVEL {isolation}; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; SELECT {rpc('crear_tarjeta_credito_admin',uid(191),'Isolated','Bank')}",
            'READ COMMITTED',raw=True)
    assert result(q)['tarjeta_id']==card
    mark('card retry exact same result')
    reject('logical duplicate card',rpc('crear_tarjeta_credito_admin',uid(101),'visa santander','santander'),'unique constraint')
    reject('changed operation payload',rpc('crear_tarjeta_credito_admin',uid(100),'Other','Santander'),'Operación utilizada')
    reject('changed operation actor',q,'Operación utilizada',who=other)
    reject('nonadmin card',rpc('crear_tarjeta_credito_admin',uid(102),'x','y'),'No autorizado',who=nonadmin)
    reject('null operation',rpc('crear_tarjeta_credito_admin',None,'x','y'),'Operación obligatoria')
    assert result(rpc('obtener_financiacion_compra_admin',uid(10)))['estado']=='FINANCIACION_NO_REGISTRADA'
    mark('historical financing unknown not falsely settled')
    for n,medio in [(11,'EFECTIVO'),(12,'TRANSFERENCIA'),(13,'TARJETA_DEBITO')]:
        purchase(n)
        q=financing(100+n,n,[dict(posicion=1,medio=medio,importe=100,fecha_pago='2026-10-10')])
        first=result(q); assert result(q)==first
        balance=result(rpc('obtener_financiacion_compra_admin',uid(n)))
        assert balance['estado']=='CANCELADA' and balance['total_pagado']==100 and balance['saldo_pendiente']==0
        mark(medio+' financing real immediate and idempotent')
    purchase(14)
    q=financing(114,14,[credit()]); r=result(q); tramo=r['tramos'][0]['id']
    check('100/3 exact cents',f"SELECT array_agg(importe ORDER BY numero_cuota)=ARRAY[33.34,33.33,33.33] AND sum(importe)=100 AND bool_and(periodo_id IS NULL) FROM obligaciones_tarjetas WHERE tramo_id='{tramo}'")
    assert result(q)==r; mark('financing retry exact original result')
    reject('same financing UUID changed request',financing(114,14,[credit(cuotas=2)]),'Operación utilizada')
    reject('different operation cannot refinalize purchase',financing(115,14,[credit()]),'Financiación ya registrada')
    purchase(15)
    reject('wrong sum rollback',financing(116,15,[credit(amount=99)]),'Suma de tramos')
    check('wrong sum no financing/tranches/operation',f"SELECT NOT EXISTS(SELECT 1 FROM financiaciones_compras WHERE compra_id='{uid(15)}') AND NOT EXISTS(SELECT 1 FROM operaciones_financieras_compras WHERE operacion_id='{uid(116)}')")
    reject('COMBINADO rejected',financing(117,15,[dict(posicion=1,medio='COMBINADO',importe=100,fecha_pago='2026-10-10')]),'Medio o importe')
    reject('missing immediate date',financing(118,15,[dict(posicion=1,medio='EFECTIVO',importe=100)]),'Tramo inmediato')
    reject('fractional installment count',financing(119,15,[credit(cuotas=2.5)]),'Cuotas de tarjeta')
    reject('numeric strings rejected',financing(120,15,[credit(amount='100')]),'Campos de tramo')
    reject('unknown/trusted total rejected',financing(121,15,[credit()|{'total':100}]),'Campos de tramo')
    # First period cannot be inferred from purchase date.
    p1=result(rpc('registrar_periodo_tarjeta_admin',uid(130),card,'2026-10-22','2026-11-02'))['periodo_id']
    empty=result(rpc('obtener_saldo_periodo_tarjeta_admin',p1))
    assert empty['total_obligaciones_hugella']==0 and empty['total_pagado']==0 and empty['saldo']==0 and empty['estado']=='SIN_OBLIGACIONES'
    mark('empty period SIN_OBLIGACIONES')
    check('real period alone does not infer bank inclusion',f"SELECT bool_and(periodo_id IS NULL) FROM obligaciones_tarjetas WHERE tramo_id='{tramo}'")
    anchor=rpc('seleccionar_primer_periodo_tramo_admin',uid(131),tramo,p1)
    r=result(anchor); assert result(anchor)==r
    mark('explicit first period selection retry')
    check('insufficient real periods leave future NULL',f"SELECT count(*) FILTER(WHERE periodo_id IS NULL)=2 AND count(*) FILTER(WHERE periodo_id='{p1}')=1 FROM obligaciones_tarjetas WHERE tramo_id='{tramo}'")
    p2q=rpc('registrar_periodo_tarjeta_admin',uid(132),card,'2026-11-20','2026-12-02')
    p2=result(p2q)['periodo_id']; assert result(p2q)['periodo_id']==p2
    check('new period automatically next quota',f"SELECT periodo_id='{p2}' FROM obligaciones_tarjetas WHERE tramo_id='{tramo}' AND numero_cuota=2")
    check('one installment per tranche period',"SELECT NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas WHERE periodo_id IS NOT NULL GROUP BY tramo_id,periodo_id HAVING count(*)>1)")
    reject('cannot reselect or move used first period',rpc('seleccionar_primer_periodo_tramo_admin',uid(133),tramo,p2),'ya seleccionado')
    reject('period backfill rejected',rpc('registrar_periodo_tarjeta_admin',uid(134),card,'2026-11-01','2026-11-15'),'posterior')
    # Mixed plan and known explicit first period at confirmation.
    purchase(16)
    tramos=[dict(posicion=2,medio='EFECTIVO',importe=40,fecha_pago='2026-10-10'),credit(amount=60,first=p1)]
    mixed=financing(135,16,tramos); result(mixed)
    assert result(financing(135,16,list(reversed(tramos))))==result(mixed)
    mark('combined plan canonical ordering and retry')
    balance=result(rpc('obtener_financiacion_compra_admin',uid(16)))
    assert balance['total_pagado']==40 and balance['saldo_pendiente']==60 and balance['estado']=='ACTIVA'
    mark('mixed real payment40 pending60')
    period=result(rpc('obtener_saldo_periodo_tarjeta_admin',p1))
    assert period['total_obligaciones_hugella']==53.34 and period['estado']=='PENDIENTE'
    mark('period totals HUGELLA only')
    firstpay=result(pay(140,p1,10)); assert result(pay(140,p1,10))==firstpay
    mark('partial payment retry same payment/applications')
    period=result(rpc('obtener_saldo_periodo_tarjeta_admin',p1)); assert period['saldo']==43.34 and period['estado']=='PAGO_PARCIAL'
    mark('partial balance derived')
    result(pay(141,p1,43.34))
    period=result(rpc('obtener_saldo_periodo_tarjeta_admin',p1)); assert period['saldo']==0 and period['estado']=='PAGADO'
    mark('second payment settles exactly')
    reject('overpayment rejects',pay(142,p1,0.01),'excede saldo')
    check('failed overpayment no orphan payment/operation',f"SELECT (SELECT count(*) FROM pagos_resumenes_tarjetas WHERE periodo_id='{p1}')=2 AND NOT EXISTS(SELECT 1 FROM operaciones_financieras_compras WHERE operacion_id='{uid(142)}')")
    reject('payment changed amount same UUID',pay(140,p1,11),'Operación utilizada')
    check('deterministic application order quota/compra/tramo',f"SELECT a.importe=10 AND o.compra_id='{uid(14)}' FROM aplicaciones_pagos_obligaciones a JOIN obligaciones_tarjetas o ON o.id=a.obligacion_id WHERE a.pago_id='{firstpay['pago_id']}'")
    # Real concurrent payment attempts each fit, together exceed the period balance.
    def concurrent(q): return sql(auth('SELECT '+q+'; SELECT pg_sleep(0.2)'),False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(concurrent,[pay(150,p2,40),pay(151,p2,40)]))
    assert sum(r.returncode==0 for r in results)==1 and any('excede saldo' in r.stderr for r in results),[(r.returncode,r.stderr) for r in results]
    mark('concurrent payments serialized no overpay')
    check('concurrent failure no orphan operation',f"SELECT count(*)=1 FROM operaciones_financieras_compras WHERE operacion_id IN ('{uid(150)}','{uid(151)}')")
    check('all payments exactly allocated',"SELECT NOT EXISTS(SELECT 1 FROM pagos_resumenes_tarjetas p WHERE p.importe IS DISTINCT FROM (SELECT sum(a.importe) FROM aplicaciones_pagos_obligaciones a WHERE a.pago_id=p.id))")
    # Concurrent identical UUID must return the original result, not duplicate.
    cq=pay(152,p2,1)
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(concurrent,[cq,cq]))
    assert all(r.returncode==0 for r in results) and results[0].stdout==results[1].stdout
    mark('simultaneous payment retry one identical result')
    # Concurrent period creation with the same UUID returns the same ordinal.
    pq=rpc('registrar_periodo_tarjeta_admin',uid(160),card,'2026-12-20','2027-01-02')
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(concurrent,[pq,pq]))
    assert all(r.returncode==0 for r in results) and results[0].stdout==results[1].stdout
    mark('concurrent same period operation one result')
    check('period orders unique/consistent',f"SELECT array_agg(orden ORDER BY orden)=ARRAY[1,2,3] FROM periodos_tarjetas WHERE tarjeta_id='{card}'")
    check('new period assigned third quota',f"SELECT bool_and(periodo_id IS NOT NULL) FROM obligaciones_tarjetas WHERE tramo_id='{tramo}'")
    p3=json.loads(results[0].stdout)['periodo_id']
    result(pay(153,p3,53.33))
    assert result(rpc('obtener_saldo_periodo_tarjeta_admin',p3))['estado']=='PAGADO'
    mark('single full summary payment exactly allocated')
    assert result(rpc('obtener_financiacion_compra_admin',uid(14)))['estado']=='CANCELADA'
    mark('credit purchase economically settled from real applications')
    check('paid quotas never moved by new period assignment',f"SELECT periodo_id='{p1}' FROM obligaciones_tarjetas WHERE tramo_id='{tramo}' AND numero_cuota=1")
    # Two distinct operations for the same real closing must not duplicate it.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(concurrent,[rpc('registrar_periodo_tarjeta_admin',uid(n),card,'2027-01-20','2027-02-02') for n in [161,162]]))
    assert sum(r.returncode==0 for r in results)==1
    mark('concurrent distinct period operations no duplicate closing/order')
    sql(f"UPDATE compras_gastos SET comprobante='receipt',observaciones='note' WHERE id='{uid(14)}'")
    check('confirmed documentary corrections allowed',f"SELECT comprobante='receipt' AND observaciones='note' FROM compras_gastos WHERE id='{uid(14)}'")
    reject('confirmed economic edit blocked',f"UPDATE compras_gastos SET fecha=fecha+1 WHERE id='{uid(14)}'",'inmutable',raw=True)
    reject('confirmed item edit blocked',f"UPDATE items_compras_gastos SET costo_unitario=101 WHERE compra_gasto_id='{uid(14)}'",'inmutable',raw=True)
    reject('confirmed purchase delete blocked',f"DELETE FROM compras_gastos WHERE id='{uid(14)}'",'inmutable',raw=True)
    purchase(18)
    cq=financing(171,18,[dict(posicion=1,medio='EFECTIVO',importe=100,fecha_pago='2026-10-10')])
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(concurrent,[cq,cq]))
    assert all(r.returncode==0 for r in results) and results[0].stdout==results[1].stdout
    mark('concurrent financing same UUID one identical result')
    check('concurrent financing one tranche',f"SELECT count(*)=1 FROM tramos_pago_compras WHERE compra_id='{uid(18)}'")
    purchase(19)
    other_card=result(rpc('crear_tarjeta_credito_admin',uid(172),'Other card','Bank'))['tarjeta_id']
    other_period=result(rpc('registrar_periodo_tarjeta_admin',uid(173),other_card,'2026-10-22','2026-11-02'))['periodo_id']
    reject('first period from another card rollback',financing(174,19,[credit(first=other_period)]),'Primer período incompatible')
    check('incompatible first period no partial financial fact',f"SELECT NOT EXISTS(SELECT 1 FROM financiaciones_compras WHERE compra_id='{uid(19)}')")
    # Audit insertion failure rolls back card and operation in the same transaction.
    sql("CREATE FUNCTION fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER fail_fixture BEFORE INSERT ON operaciones_financieras_compras FOR EACH ROW EXECUTE FUNCTION fail_fixture();")
    reject('audit failure atomic rollback',rpc('crear_tarjeta_credito_admin',uid(170),'Other','Bank'),'fixture audit failure')
    sql('DROP TRIGGER fail_fixture ON operaciones_financieras_compras; DROP FUNCTION fail_fixture();')
    check('no card/audit residue after failure',f"SELECT NOT EXISTS(SELECT 1 FROM tarjetas_credito WHERE nombre='Other') AND NOT EXISTS(SELECT 1 FROM operaciones_financieras_compras WHERE operacion_id='{uid(170)}')")
    # Every public RPC enforces Admin; helpers cannot be invoked directly by users.
    sample=[rpc('crear_tarjeta_credito_admin',uid(180),'x','y'),rpc('registrar_periodo_tarjeta_admin',uid(180),card,'2027-02-20','2027-03-02'),financing(180,15,[credit()]),rpc('seleccionar_primer_periodo_tramo_admin',uid(180),tramo,p1),pay(180,p1,1),rpc('obtener_financiacion_compra_admin',uid(14)),rpc('obtener_saldo_periodo_tarjeta_admin',p1),'listar_tarjetas_financieras_admin()',rpc('listar_periodos_tarjeta_admin',card)]
    for q in sample: reject('nonadmin '+q.split('(')[0],q,'No autorizado',who=nonadmin)
    reject('no session uid',rpc('obtener_financiacion_compra_admin',uid(14)),'No autorizado',who='')
    check('authenticated exactly nine RPC execute',f"SELECT count(*)=9 FROM pg_proc WHERE proname IN ({quoted}) AND has_function_privilege('authenticated',oid,'EXECUTE')")
    purchase(17,0)
    result(financing(190,17,[]))
    assert result(rpc('obtener_financiacion_compra_admin',uid(17)))['estado']=='CANCELADA'
    mark('zero cost no manufactured tranche or payment')
    print(f'PASS: {passed} checks; PostgreSQL local only',flush=True)
finally:
    if run([str(BIN/'pg_ctl'),'-D',str(DATA),'status']).returncode==0:
        r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop']); assert r.returncode==0,r.stderr
