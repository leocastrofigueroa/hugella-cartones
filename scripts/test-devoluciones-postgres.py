"""Verificaciones finales: PostgreSQL 17 privado por socket Unix, sin red/credenciales.
No lee .env, exportaciones ni fixtures de negocio. Todo se genera aquí.
Salida reproducible en docs/devoluciones-postgres-resultados.json.
"""
from pathlib import Path
import subprocess, tempfile, os, json, time, statistics, hashlib, datetime, uuid, threading
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[1]
BIN=Path('/opt/homebrew/opt/postgresql@17/bin')
BASE=Path(tempfile.mkdtemp(prefix='hg-final-pg-',dir='/private/tmp'))
DATA=BASE/'data'; SOCKET=BASE/'socket'; SOCKET.mkdir(mode=0o700)
ENV={k:os.environ[k] for k in ('PATH','TMPDIR','LANG') if k in os.environ}
ACTOR='20000000-0000-4000-8000-000000000001'; SUPPLIER='20000000-0000-4000-8000-000000000002'
REPORT={'engine':None,'isolation':'private Unix socket; TCP disabled; synthetic data only','checks':[], 'benchmarks':[], 'failures':[], 'temp_directory':str(BASE)}
OUT=ROOT/'docs/devoluciones-postgres-resultados.json'
PORT='55521'
def lit(v):
    if v is None:return 'NULL'
    if isinstance(v,(dict,list)):v=json.dumps(v,ensure_ascii=False)
    return "'"+str(v).replace("'","''")+"'"
def uid():return str(uuid.uuid4())
def rpc(name,*args):return 'public.'+name+'('+','.join(lit(x) for x in args)+')'
def run(args,**kw):return subprocess.run(args,env=ENV,text=True,capture_output=True,**kw)
def command():return [str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',str(SOCKET),'-p',PORT,'-U','postgres','-d','postgres']
def sql(q,ok=True,timeout=120):
    r=run(command(),input=q,timeout=timeout)
    if ok and r.returncode:raise RuntimeError(r.stderr[-6000:])
    return r

def scalar(q):return json.loads(sql(f"SET test.uid='{ACTOR}'; SELECT to_jsonb(x) FROM ("+q+') s(x)').stdout.strip())
def auth(q):return f"SET test.uid='{ACTOR}'; SET ROLE authenticated; SET statement_timeout='30s'; "+q

def call(expr):return json.loads(sql(auth('SELECT '+expr)).stdout.strip())
def check(label,condition,details=None):
    if not condition:raise AssertionError(label+': '+str(details))
    REPORT['checks'].append({'name':label,'passed':True,'details':details});print('PASS',label,flush=True)
def migrate(name):sql((ROOT/'supabase/migrations'/f'{name}.sql').read_text())
def snapshot():
    return scalar("""select jsonb_object_agg(name,payload) from (
    select c.relname name, public.hg_snapshot_table(c.relname) payload
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname not like 'hg_%') t""")

def fixture(amount=100,refund=0):
    card,period,purchase,op=uid(),uid(),uid(),uid()
    sql(f"""SET test.uid='{ACTOR}'; INSERT INTO tarjetas_credito(id,nombre,entidad,actor_id) VALUES('{card}','Carrera {card}','Sintético','{ACTOR}');
    INSERT INTO periodos_tarjetas(id,tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id) VALUES('{period}','{card}',1,'2030-01-10','2030-01-20','{ACTOR}');
    INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES('{purchase}','GASTO','{SUPPLIER}','2026-01-01','ARS','{ACTOR}');
    INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES('{purchase}',1,'Carrera sintética',1,{amount});""")
    call(rpc('confirmar_financiacion_compra_admin',op,purchase,[dict(posicion=1,medio='TARJETA_CREDITO',importe=amount,tarjeta_id=card,cantidad_cuotas=1,primer_periodo_id=period)]))
    tramo=scalar(f"select id from tramos_pago_compras where compra_id='{purchase}'")
    quota=scalar(f"select id from obligaciones_tarjetas where compra_id='{purchase}'")
    f=dict(card=card,period=period,purchase=purchase,tramo=tramo,quota=quota)
    if refund:f['refund']=call(operation(f,'DEVOLUCION',dict(fecha='2026-01-01',motivo='Sintético',tramo_id=tramo,importe=refund)))['id']
    return f

def operation(f,action,data,op=None):return rpc('operar_devolucion_compra_admin',op or uid(),f['purchase'],action,data)
def payment(f,amount,op=None):return rpc('registrar_pago_resumen_tarjeta_admin',op or uid(),f['period'],'2026-01-01',amount,None)
def credit(f,amount,op=None):return operation(f,'ACREDITAR',dict(fecha='2026-01-01',devolucion_id=f['refund'],periodo_id=f['period'],importe=amount,referencia='Sintético'),op)
def cancel(f):return operation(f,'CANCELAR',dict(fecha='2026-01-01',motivo='Sintético',obligaciones=[f['quota']]))
def expected(f,amount):return operation(f,'DEVOLUCION',dict(fecha='2026-01-01',motivo='Sintético',tramo_id=f['tramo'],importe=amount))
def totals(f):return scalar(f"""select jsonb_build_object(
 'saldo',(public.obtener_saldo_periodo_tarjeta_admin('{f['period']}')->>'saldo')::numeric,
 'favor',(public.obtener_saldo_periodo_tarjeta_admin('{f['period']}')->>'saldo_a_favor')::numeric,
 'paid',(select coalesce(sum(importe),0) from pagos_resumenes_tarjetas where periodo_id='{f['period']}'),
 'credited',(select coalesce(sum(importe),0) from acreditaciones_devoluciones_tarjetas where tarjeta_id='{f['card']}'),
 'cancelled',(select count(*) from cancelaciones_obligaciones_tarjeta where obligacion_id='{f['quota']}'))""")

def race(label,first,second,second_ok,expected_code=None,same_result=False):
    """A ejecuta la RPC y sostiene su transacción; B debe observarse esperando el lock real.
    A libera únicamente cuando una tercera sesión confirma wait_event_type=Lock en B.
    PIDs distintos y aplicaciones propias prueban que no es una ejecución serial simulada.
    """
    name='hg_'+uuid.uuid4().hex[:12]; ready=BASE/(name+'.ready'); release=BASE/(name+'.release')
    # psql copia una señal local DESPUÉS de completar la RPC. Una espera de archivo
    # mantiene abierta la misma transacción sin introducir locks externos financieros.
    script=auth(f"SET application_name='{name}_a'; BEGIN; SELECT pg_backend_pid(); SELECT {first};\n\\o {ready}\nSELECT 'ready';\n\\o\n")
    script+=f"\\! while [ ! -f '{release}' ]; do sleep 0.05; done\nCOMMIT;\n"
    a=subprocess.Popen(command(),env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    a.stdin.write(script);a.stdin.close();a.stdin=None
    b=None
    try:
        deadline=time.monotonic()+30
        while not ready.exists():
            if a.poll() is not None:raise RuntimeError(a.communicate()[1])
            if time.monotonic()>deadline:raise TimeoutError('No llega barrera '+label)
            time.sleep(.03)
        b=subprocess.Popen(command(),env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        b.stdin.write(auth(f"SET application_name='{name}_b'; SELECT pg_backend_pid(); SELECT {second};"));b.stdin.close();b.stdin=None
        locks=None
        while time.monotonic()<deadline:
            locks=scalar(f"""select jsonb_agg(jsonb_build_object('pid',pid,'application',application_name,'wait_type',wait_event_type,'wait',wait_event,'blockers',pg_blocking_pids(pid)))
            from pg_stat_activity where application_name in ('{name}_a','{name}_b')""")
            if locks and any(x['application']==name+'_b' and x['wait_type']=='Lock' and x['blockers'] for x in locks):break
            if b.poll() is not None:raise RuntimeError('B no bloqueó: '+str(b.communicate()))
            time.sleep(.03)
        else:raise TimeoutError('No se observó contención real '+label)
        release.touch();ao,ae=a.communicate(timeout=35);bo,be=b.communicate(timeout=35)
        check(label+' / sesiones y contención reales',len({x['pid'] for x in locks})==2,locks)
        check(label+' / resultados',a.returncode==0 and ((b.returncode==0)==second_ok) and (not expected_code or expected_code in be),{'a_status':a.returncode,'b_status':b.returncode,'b_error':be.strip()[-1500:]})
        if same_result:
            ar=[json.loads(x) for x in ao.splitlines() if x.startswith('{')]
            br=[json.loads(x) for x in bo.splitlines() if x.startswith('{')]
            check(label+' / misma respuesta',ar==br)
    finally:
        release.touch()
        for proc in (a,b):
            if proc and proc.poll() is None:
                try:proc.communicate(timeout=35)
                except subprocess.TimeoutExpired:proc.kill();proc.communicate()


def explain(label,query,limit_ms,samples=5):
    plans=[];errors=[]
    for i in range(samples):
        r=sql(auth('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query),False,timeout=40)
        if r.returncode:
            errors.append(r.stderr.strip()[-1500:]);break
        plans.append(json.loads(r.stdout.strip())[0])
    times=[x['Execution Time'] for x in plans]
    record={'name':label,'budget_ms':limit_ms,'samples':len(times),'execution_ms':times,'errors':errors}
    if times:
        record.update(median_ms=statistics.median(times),max_ms=max(times),planning_ms=[x['Planning Time'] for x in plans],buffers={k:v for k,v in plans[-1]['Plan'].items() if 'Blocks' in k})
        (BASE/(label.replace(' ','_')+'.plan.json')).write_text(json.dumps(plans[-1],indent=2))
    record['passed']=not errors and max(times,default=float('inf'))<=limit_ms
    REPORT['benchmarks'].append(record);print('BENCH',json.dumps(record),flush=True)

started=False
try:
    r=run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);assert r.returncode==0,r.stderr
    r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p {PORT} -c listen_addresses='' -c max_connections=20 -c shared_buffers=128MB",'-w','start']);assert r.returncode==0,r.stderr
    started=True
    REPORT['scope']='Rama financiera de tarjetas; cobranzas y créditos ajenos representados con tablas/vistas sintéticas vacías. Baseline relevante instalado sin omitir preflights. No verifica equivalencia del esquema productivo ni latencia HTTP. Volumen de stress supuesto: 5.000 compras en cinco años, sin usar volumen real.'
    REPORT['engine']=scalar('select version()');print(REPORT['engine'],flush=True)
    check('sin TCP y directorio privado',scalar("select current_setting('listen_addresses')")=='')
    sql(f"""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);INSERT INTO auth.users VALUES('{ACTOR}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    CREATE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()='{ACTOR}'::uuid$$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;
    CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    """)
    for n in ['202610090003_compras_gastos_base','202610090004_compras_gastos_rpc_admin','202610100001_comprobantes_compras_gastos','202610110001_financiacion_compras_base','202610110002_financiacion_compras_rpc_admin','202610110003_compra_financiada_admin','202610110004_editar_tarjeta_credito_admin','202610110005_observaciones_listado_compras','202610110006_anulacion_compras_gastos','202610140002_corte_historico_compras','202610140003_importacion_compras_historicas','202610140004_financiacion_historica_sheets','202610260001_devoluciones_tarjetas_base']:
        migrate(n)
    panel=(ROOT/'supabase/migrations/202610160001_panel_financiero.sql').read_text();a=panel.index('create or replace view public.vw_obligaciones_tarjetas_financieras');sql(panel[a:panel.index(';',a)+1])
    migrate('202610160008_calendario_financiero')
    # Dependencias de cobranzas sintéticas vacías: el benchmark mide la rama de tarjetas.
    sql('CREATE TABLE creditos(id uuid primary key,codigo text);CREATE TABLE pagos(credito_id uuid,fecha_pago date,importe numeric,estado text);CREATE VIEW vw_proyeccion_cobranza_mensual AS SELECT null::date mes,0::numeric recaudacion_programada,0::integer creditos_con_cobranza WHERE false; CREATE TABLE cierres_creditos(credito_id uuid,tipo text); CREATE VIEW vw_creditos_financieros AS SELECT null::text codigo,null::text cliente,0::numeric inversion,0::numeric total_credito,0::numeric total_pagado,0::numeric saldo_pendiente,0::numeric importe_atrasado,null::text estado_financiero,false devuelto,0::numeric ganancia_bruta_proyectada WHERE false;')
    migrate('202610160009_proyeccion_mensual_financiera')
    migrate('202610160007_historico_cobranzas_panel')
    sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES('{SUPPLIER}','Proveedor sintético','{ACTOR}');")
    # Carga válida mediante RPC real y triggers habilitados, antes de la migración pendiente.
    sql("""CREATE TABLE public.hg_fixture(compra_id uuid,tarjeta_id uuid,periodo_id uuid);
    CREATE FUNCTION public.hg_snapshot_table(p_name text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN
    EXECUTE format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,E''\\n'' order by to_jsonb(t)::text),''''))) from public.%I t',p_name) INTO r;RETURN r;END;$$;""")
    # 12 tarjetas x 60 períodos. Sin nombres/IDs ni importes tomados de producción.
    sql(f"""DO $$DECLARE c uuid;BEGIN FOR i IN 1..12 LOOP c:=gen_random_uuid();
    INSERT INTO tarjetas_credito(id,nombre,entidad,actor_id) VALUES(c,'Carga '||i,'Sintético','{ACTOR}');
    INSERT INTO periodos_tarjetas(tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id)
    SELECT c,k,('2024-01-10'::date+(k-1)*interval '1 month')::date,('2024-01-20'::date+(k-1)*interval '1 month')::date,'{ACTOR}' FROM generate_series(1,60) k;
    END LOOP;END;$$;""")
    cards=scalar("select jsonb_agg(id order by nombre) from tarjetas_credito")
    # 5.000 compras / 60.000 cuotas / 60 meses. Batch acotado conserva todos los triggers.
    for start in range(0,5000,100):
        sql(f"""SET test.uid='{ACTOR}'; DO $$DECLARE cg uuid;c uuid;p uuid;BEGIN FOR i IN {start}..{start+99} LOOP
        SELECT id INTO c FROM tarjetas_credito ORDER BY nombre OFFSET mod(i,12) LIMIT 1;
        SELECT id INTO p FROM periodos_tarjetas WHERE tarjeta_id=c AND orden=1+mod(i/12,49);
        cg:=gen_random_uuid();
        INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES(cg,'GASTO','{SUPPLIER}','2026-01-01','ARS','{ACTOR}');
        INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES(cg,1,'Volumen sintético',1,1200);
        PERFORM public.confirmar_financiacion_compra_admin(gen_random_uuid(),cg,jsonb_build_array(jsonb_build_object('posicion',1,'medio','TARJETA_CREDITO','importe',1200,'tarjeta_id',c,'cantidad_cuotas',12,'primer_periodo_id',p)));
        INSERT INTO hg_fixture VALUES(cg,c,p);
        END LOOP;END;$$;""",timeout=180)
        if start%1000==0:print('SEED',start+100,'/5000',flush=True)
    # 100 pagos reales y sus aplicaciones, usando la definición anterior.
    sql(f"SET test.uid='{ACTOR}'; DO $$DECLARE p record;BEGIN FOR p IN SELECT id FROM periodos_tarjetas ORDER BY tarjeta_id,orden LIMIT 100 LOOP PERFORM public.registrar_pago_resumen_tarjeta_admin(gen_random_uuid(),p.id,'2026-01-01',1,null);END LOOP;END;$$;",timeout=180)
    # Hechos de devolución base auditados, ya posibles antes de 002. 250 esperadas y 125 créditos parciales.
    sql(f"""DO $$DECLARE f record;op uuid;d uuid;pr uuid;BEGIN FOR f IN SELECT h.*,t.id tramo FROM hg_fixture h JOIN tramos_pago_compras t ON t.compra_id=h.compra_id ORDER BY h.compra_id LIMIT 250 LOOP
    op:=gen_random_uuid();d:=gen_random_uuid();
    INSERT INTO operaciones_financieras_compras(operacion_id,actor_id,accion,solicitud,resultado) VALUES(op,'{ACTOR}','DEVOLUCION_TARJETA',jsonb_build_object('fixture',true),jsonb_build_object('id',d));
    INSERT INTO devoluciones_tarjetas(id,compra_id,tramo_id,tarjeta_id,operacion_id,importe_esperado,fecha_solicitud,motivo,actor_id) VALUES(d,f.compra_id,f.tramo,f.tarjeta_id,op,50,'2026-01-01','Fixture previa','{ACTOR}');
    IF mod((SELECT count(*) FROM devoluciones_tarjetas),2)=0 THEN
    op:=gen_random_uuid();INSERT INTO operaciones_financieras_compras(operacion_id,actor_id,accion,solicitud,resultado) VALUES(op,'{ACTOR}','ACREDITACION_DEVOLUCION_TARJETA','{{"fixture":true}}','{{"fixture":true}}');
    INSERT INTO acreditaciones_devoluciones_tarjetas(devolucion_id,tarjeta_id,periodo_id,operacion_id,fecha_acreditacion,importe,actor_id) VALUES(d,f.tarjeta_id,f.periodo_id,op,'2026-01-01',20,'{ACTOR}');
    END IF;END LOOP;END;$$;""")
    # Cortes y compras documentales previas: generar vía las RPC históricas reales.
    hc,hp=uid(),uid()
    sql(f"INSERT INTO tarjetas_credito(id,nombre,entidad,actor_id) VALUES('{hc}','Visa Leo','Santander','{ACTOR}'); INSERT INTO periodos_tarjetas(id,tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id) VALUES('{hp}','{hc}',1,'2030-01-10','2030-01-20','{ACTOR}');")
    evidence=dict(tarjeta_original='Visa L',tarjeta_canonica='Visa Leo Santander',tarjeta_id=hc,periodo_inicial_id=hp,cuotas_fuente=2,valor_cuota_historico=20,pagadas_historicas=1,pendientes_historicas=1,saldo_historico=20,estado_original='Fixture sintética',cierre_original='2030-01-10',vencimiento_original='2030-01-20',tratamiento='FINANCIACION_HISTORICA_OPERATIVA')
    hist=call(rpc('importar_compra_historica_admin',uid(),'HG-9001','GASTO',SUPPLIER,'2026-01-01','ARS',None,None,'Histórica sintética',40,[dict(posicion=1,medio='TARJETA_CREDITO',importe=40,tarjeta_id=hc,cantidad_cuotas=2,primer_periodo_id=hp)],evidence))
    hq=scalar(f"select id from obligaciones_tarjetas where compra_id='{hist['compra_id']}' and numero_cuota=1")
    call(rpc('registrar_corte_historico_obligacion_admin',uid(),hq,'Corte sintético','2026-01-01',20))
    documentary=dict(evidence,cuotas_fuente=1,valor_cuota_historico=0,pagadas_historicas=0,pendientes_historicas=1,saldo_historico=0,tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO')
    doc=call(rpc('importar_compra_historica_admin',uid(),'HG-0043','GASTO',SUPPLIER,'2026-01-01','ARS',None,None,'Documental sintética',0,[],documentary))
    # HG-0043 y nombres canónicos son discriminadores exigidos por CHECK; no se copia ningún registro real.
    old_doc=call(rpc('obtener_compra_gasto_admin',doc['compra_id']))
    # Cancelación ya existente en la base aplicada, auditada y sin devolución en ese tramo.
    cf=scalar("select to_jsonb(h) from hg_fixture h order by compra_id offset 300 limit 1")
    cq=scalar(f"select id from obligaciones_tarjetas where compra_id='{cf['compra_id']}' and numero_cuota=12")
    cop=uid()
    sql(f"""BEGIN; INSERT INTO operaciones_financieras_compras(operacion_id,actor_id,accion,solicitud,resultado) VALUES('{cop}','{ACTOR}','CANCELACION_FINANCIERA_COMPRA','{{"fixture":true}}','{{"fixture":true}}');
    INSERT INTO cancelaciones_financieras_compras(compra_id,operacion_id,fecha_cancelacion,motivo,actor_id) VALUES('{cf['compra_id']}','{cop}','2020-01-01','Fixture previa','{ACTOR}');
    INSERT INTO cancelaciones_obligaciones_tarjeta(obligacion_id,compra_id,actor_id) VALUES('{cq}','{cf['compra_id']}','{ACTOR}'); COMMIT;""")
    sql('ANALYZE;')
    explain('baseline listado 60 resumenes',f"select * from public.listar_resumenes_tarjeta_admin('{cards[0]}',100,0)",2000,3)
    before=snapshot();migration=(ROOT/'supabase/migrations/202610260002_integrar_devoluciones_finanzas.sql').read_text()
    REPORT['migration_sha256']=hashlib.sha256(migration.encode()).hexdigest()
    failed=sql(migration.rsplit('commit;',1)[0]+'SELECT 1/0; commit;',False)
    check('migración fallida revierte datos y DDL',failed.returncode!=0 and snapshot()==before and scalar("select to_regprocedure('public.operar_devolucion_compra_admin(uuid,uuid,text,jsonb)') is null"))
    t=time.monotonic();sql(migration);REPORT['migration_seconds']=time.monotonic()-t
    check('migración completa sin omitir preflight ni reescribir datos',snapshot()==before,{'tables':len(before),'snapshot':before})
    new_doc=call(rpc('obtener_compra_gasto_admin',doc['compra_id']));new_doc.pop('financiacion',None)
    check('detalle documental previo conservado',new_doc==old_doc)
    check('corte y cancelación previos contabilizados',call(rpc('obtener_financiacion_compra_admin',hist['compra_id']))['total_corte_historico']==20 and scalar(f"select saldo_pendiente=0 from vw_obligaciones_tarjetas_financieras where id='{cq}'"))
    # Contención real sobre distintas conexiones; no se deshabilitan triggers.
    f=fixture();op=uid();expr=payment(f,80,op);race('mismo UUID',expr,expr,True,same_result=True);check('pago único idempotente',totals(f)['paid']==80)
    f=fixture();op=uid();race('mismo UUID distinto payload',payment(f,80,op),payment(f,70,op),False,'22023');check('UUID no reescribe pago',totals(f)['paid']==80)
    f=fixture();race('dos sobrepagos',payment(f,80),payment(f,80),False,'23514');check('sin sobrepago',totals(f)['paid']==80 and totals(f)['saldo']==20)
    f=fixture(refund=100);race('dos sobreacreditaciones',credit(f,80),credit(f,80),False,'23514');check('sin sobreacreditación',totals(f)['credited']==80 and totals(f)['saldo']==20)
    f=fixture();race('cancelar antes de pagar',cancel(f),payment(f,80),False,'23514');check('cancelada no pagada',totals(f)['cancelled']==1 and totals(f)['paid']==0)
    f=fixture();race('pagar antes de cancelar',payment(f,80),cancel(f),False,'23514');check('pagada no cancelada',totals(f)['cancelled']==0 and totals(f)['paid']==80)
    f=fixture();race('esperada antes de cancelar',expected(f,70),cancel(f),False,'23514');check('esperada no reduce saldo',totals(f)['saldo']==100)
    f=fixture();race('cancelar antes de esperada',cancel(f),expected(f,70),False,'23514');check('sin doble descuento',totals(f)['saldo']==0)
    f=fixture(refund=100);race('pagar antes de acreditar',payment(f,80),credit(f,80),True);check('pagos y crédito conservados',totals(f)==dict(saldo=0,favor=60,paid=80,credited=80,cancelled=0))
    f=fixture(refund=100);race('acreditar antes de pagar',credit(f,80),payment(f,80),False,'23514');check('pago toma saldo neto fresco',totals(f)['saldo']==20 and totals(f)['paid']==0)
    denied=sql(auth('select * from public.vw_obligaciones_tarjetas_financieras limit 1'),False)
    check('vista interna no expuesta a authenticated',denied.returncode!=0 and '42501' in denied.stderr)
    # Saldo global debe reconciliarse con cuotas distribuidas por período.
    sql("SET test.uid='"+ACTOR+"'; ANALYZE;")
    check('conciliación períodos/cuotas',scalar("select not exists(select 1 from vw_periodos_tarjetas_financieros p left join (select periodo_id,sum(saldo_pendiente) saldo from vw_obligaciones_tarjetas_financieras group by periodo_id) o on o.periodo_id=p.periodo_id where p.saldo_a_pagar<>coalesce(o.saldo,0))"))
    REPORT['volume']=scalar("select jsonb_build_object('compras',(select count(*) from compras_gastos),'cuotas',(select count(*) from obligaciones_tarjetas),'tarjetas',(select count(*) from tarjetas_credito),'periodos',(select count(*) from periodos_tarjetas),'pagos',(select count(*) from pagos_resumenes_tarjetas),'aplicaciones',(select count(*) from aplicaciones_pagos_obligaciones),'esperadas',(select count(*) from devoluciones_tarjetas),'acreditaciones',(select count(*) from acreditaciones_devoluciones_tarjetas),'cortes',(select count(*) from cortes_historicos_obligaciones_tarjeta),'documentales',(select count(*) from evidencias_financiacion_historica_compras where tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'))")
    card=cards[0];period=scalar(f"select id from periodos_tarjetas where tarjeta_id='{card}' and orden=30")
    purchase=scalar(f"select compra_id from hg_fixture where tarjeta_id='{card}' limit 1")
    # Presupuestos explícitos de latencia DB en laptop local, no un SLA productivo.
    for label,query,budget in [
      ('saldo resumen',f"select public.obtener_saldo_periodo_tarjeta_admin('{period}')",500),
      ('listado 60 resumenes',f"select * from public.listar_resumenes_tarjeta_financieros_admin('{card}',100,0)",2000),
      ('detalle compra',f"select public.obtener_compra_gasto_admin('{purchase}')",1000),
      ('calendario completo',"select * from public.listar_calendario_financiero_admin()",3000),
      ('proyeccion mensual',"select * from public.obtener_proyeccion_mensual_financiera_admin()",2000),
      ('panel financiero',"select public.obtener_panel_financiero_admin()",2000)]:
        explain(label,query,budget)
    REPORT['recommendation']='PUBLICABLE' if all(x['passed'] for x in REPORT['benchmarks']) else 'NO PUBLICABLE'
except Exception as e:
    REPORT['failures'].append(str(e));REPORT['recommendation']='NO PUBLICABLE';print('FAIL',str(e),flush=True)
finally:
    if started:
        stop=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop']);REPORT['server_stopped']=stop.returncode==0
    OUT.parent.mkdir(exist_ok=True);OUT.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+'\n')
    print('REPORT',OUT,REPORT.get('recommendation'),flush=True)
if REPORT['recommendation']!='PUBLICABLE':raise SystemExit(1)
