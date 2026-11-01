"""Comparación antes/después sobre EXACTAMENTE la misma base sintética del ensayo nativo.
Si el directorio temporal ya no existe, recrearlo con test-devoluciones-postgres.py.
No conecta a ningún destino remoto: valida ruta privada y usa exclusivamente socket Unix.
"""
from pathlib import Path
import ast, json, time, hashlib, sys
source=Path(__file__).with_name('test-devoluciones-postgres.py')
tree=ast.parse(source.read_text());prefix=[]
for node in tree.body:
    if isinstance(node,ast.Try):break
    prefix.append(node)
exec(compile(ast.Module(body=prefix,type_ignores=[]),str(source),'exec'))
previous=json.loads((ROOT/'docs/devoluciones-postgres-resultados.json').read_text())
BASE=Path(previous['temp_directory']).resolve()
assert BASE.parent==Path('/private/tmp') and BASE.name.startswith('hg-final-pg-')
DATA=BASE/'data';SOCKET=BASE/'socket'
assert (DATA/'PG_VERSION').read_text().strip()=='17','Recrear fixture nativa; no cambiar el destino a otro servidor'
ENV['PGPASSFILE']=str(BASE/'no-password-file')
OUT=ROOT/'docs/resumenes-rendimiento-resultados.json'
resume_after='--resume-after' in sys.argv
prior=json.loads(OUT.read_text()) if '--resume-before' in sys.argv or resume_after else None
REPORT={'checks':[],'benchmarks':[],'failures':[], 'temp_directory':str(BASE),'scope':'Mismo dataset sintético e instancia PostgreSQL antes/después. Sin cambios de hechos durante la comparación; sesiones autenticadas. Sin HTTP ni datos de crédito/cobranza ajenos a tarjetas.'}
optimized=(ROOT/'supabase/migrations/202610260002_integrar_devoluciones_finanzas.sql').read_text()
a=optimized.index('create function public.listar_resumenes_tarjeta_conjunto_interno(')
b=optimized.index('-- La anulación técnica',a)
patch=optimized[a:b].replace('create function','create or replace function')
old=(ROOT/'scripts/fixtures/resumenes-listado-anterior.sql').read_text()
# El benchmark de referencia debe reflejar la versión lenta, no el baseline sin devoluciones.
def measure(label,q,budget=2000,samples=5):
    sql('select pg_stat_reset();')
    saved=globals()['auth']
    globals()['auth']=lambda q:"SET track_functions='all'; "+saved(q)
    try:explain(label,q,budget,samples)
    finally:globals()['auth']=saved
    REPORT['benchmarks'][-1]['function_calls']=scalar("select coalesce(jsonb_object_agg(funcname,calls),'{}') from pg_stat_user_functions where calls>0 and funcname like '%resumen%' or calls>0 and funcname='listar_resumenes_tarjeta_conjunto_interno'")

def export_list(card,limit=100,offset=0,legacy=False):
    name='listar_resumenes_tarjeta_admin' if legacy else 'listar_resumenes_tarjeta_financieros_admin'
    return call(f"(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.{name}('{card}',{limit},{offset}) x)")

def extra_purchase(card,period,amount):
    p=uid()
    sql(f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES('{p}','GASTO','{SUPPLIER}','2026-01-01','ARS','{ACTOR}');INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES('{p}',1,'Carry sintético',1,{amount});")
    call(rpc('confirmar_financiacion_compra_admin',uid(),p,[dict(posicion=1,medio='TARJETA_CREDITO',importe=amount,tarjeta_id=card,cantidad_cuotas=1,primer_periodo_id=period)]))

started=False
try:
    r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p {PORT} -c listen_addresses='' -c max_connections=20 -c shared_buffers=128MB",'-w','start']);assert r.returncode==0,r.stderr
    started=True
    check('socket privado sin TCP',scalar("select current_setting('listen_addresses')")=='')
    REPORT['engine']=scalar('select version()')
    if resume_after:
        REPORT=prior
        REPORT['failures']=[]
        check('dataset medido no cambió al reanudar',snapshot()==prior['snapshot'])
        import re
        for name,body in re.findall(r'create or replace function public\.(\w+)\([\s\S]*?as \$rpc\$(.*?)\$rpc\$;',patch,re.S):
            digest=hashlib.md5(body.encode()).hexdigest()
            check('definición medida idéntica '+name,scalar(f"select md5(prosrc) from pg_proc where oid='public.{name}(uuid,integer,integer)'::regprocedure")==digest)
        REPORT['harness_note']='Oracle enumera tablas privadas como owner; mediciones y contratos de RPC usan authenticated. No se cambia ningún permiso para las pruebas.'
        card=scalar("select id from tarjetas_credito where nombre='Carga 1'")
        before=prior['snapshot']
        reference_sql="""WITH individuales AS MATERIALIZED (
          SELECT p.id,p.orden,p.fecha_cierre,p.fecha_vencimiento,public.obtener_saldo_periodo_tarjeta_admin(p.id) j
          FROM public.periodos_tarjetas p)
          SELECT jsonb_object_agg(id::text,j||jsonb_build_object('orden',orden,'fecha_cierre',fecha_cierre,'fecha_vencimiento',fecha_vencimiento)) FROM individuales"""
        reference=json.loads(sql(f"SET test.uid='{ACTOR}'; SET statement_timeout='120s'; SELECT ("+reference_sql+")",timeout=130).stdout.strip())
    else:
        sql(old)
        # Nuevas fixtures ANTES de ambas mediciones: carry atravesando una página y estados extremos.
        if prior:
            check('dataset del benchmark previo idéntico',snapshot()==prior['snapshot'])
            carry=scalar("select jsonb_build_object('card',tarjeta_id) from periodos_tarjetas group by tarjeta_id having count(*)=4")
            ids=scalar(f"select jsonb_agg(id order by orden) from periodos_tarjetas where tarjeta_id='{carry['card']}'")
        else:
            carry=fixture(100,100)
            ids=[carry['period']]+[uid() for _ in range(3)]
            for i,p in enumerate(ids[1:],2):
                sql(f"INSERT INTO periodos_tarjetas(id,tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id) VALUES('{p}','{carry['card']}',{i},'2030-0{i}-10','2030-0{i}-20','{ACTOR}');")
            extra_purchase(carry['card'],ids[1],50);extra_purchase(carry['card'],ids[2],100)
            call(payment(carry,100));call(credit(carry,80))
            paid=fixture();call(payment(paid,100))
        sql('ANALYZE;')
        before=snapshot()
        REPORT['dataset_sha256']=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest()
        REPORT['snapshot']=before
        card=scalar("select id from tarjetas_credito where nombre='Carga 1'")
        target=f"select * from public.listar_resumenes_tarjeta_financieros_admin('{card}',100,0)"
        if prior:
            REPORT['benchmarks'].append(next(x for x in prior['benchmarks'] if x['name']=='antes listado 60 resumenes'))
            print('REUSE medición previa: mismo checksum de todas las tablas',flush=True)
        else:
            measure('antes listado 60 resumenes',target)
        expected=export_list(card);expected_legacy=export_list(card,legacy=True)
        expected_carry=export_list(carry['card'],2,1)
        check('referencia incluye carry fuera de la página',expected_carry[0]['saldo_a_favor_entrante']==80 and expected_carry[1]['saldo']==70)
        # Oracle independiente: el saldo individual no se modifica. MATERIALIZED evita evaluarlo por campo.
        reference_sql="""WITH individuales AS MATERIALIZED (
          SELECT p.id,p.tarjeta_id,p.orden,p.fecha_cierre,p.fecha_vencimiento,public.obtener_saldo_periodo_tarjeta_admin(p.id) j
          FROM public.periodos_tarjetas p)
          SELECT jsonb_object_agg(id::text,j||jsonb_build_object('orden',orden,'fecha_cierre',fecha_cierre,'fecha_vencimiento',fecha_vencimiento)) FROM individuales"""
        reference=json.loads(sql(f"SET test.uid='{ACTOR}'; SET statement_timeout='120s'; SELECT ("+reference_sql+")",timeout=130).stdout.strip())
        definitions=scalar("select jsonb_object_agg(oid::regprocedure::text,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname not in ('listar_resumenes_tarjeta_admin','listar_resumenes_tarjeta_financieros_admin','listar_resumenes_tarjeta_conjunto_interno')")
        # Aplicación sólo del bloque de listados: ningún otro objeto financiero se cambia.
        sql('BEGIN;'+patch+'COMMIT;')
        check('hechos idénticos antes/después',snapshot()==before)
        check('otras funciones idénticas',definitions==scalar("select jsonb_object_agg(oid::regprocedure::text,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname not in ('listar_resumenes_tarjeta_admin','listar_resumenes_tarjeta_financieros_admin','listar_resumenes_tarjeta_conjunto_interno')"))
        measure('despues listado 60 resumenes',target)
        measure('despues listado compatible',f"select * from public.listar_resumenes_tarjeta_admin('{card}',100,0)")
        check('JSON ampliado idéntico',export_list(card)==expected)
        check('RPC compatible idéntica',export_list(card,legacy=True)==expected_legacy)
        check('offset conserva crédito previo',export_list(carry['card'],2,1)==expected_carry)
    card_ids=scalar('select jsonb_agg(id) from public.tarjetas_credito')
    actual=call("(SELECT jsonb_object_agg((j->>'periodo_id'),j) FROM jsonb_array_elements_text("+lit(card_ids)+"::jsonb) t(id) CROSS JOIN LATERAL public.listar_resumenes_tarjeta_financieros_admin(t.id::uuid,100,0) j)")
    check('todos los períodos iguales al saldo individual',actual==reference,{'periodos':len(reference),'estados':sorted({r['estado'] for r in actual.values()})})
    check('página vacía compatible',export_list(card,100,1000)==[] and export_list(card,100,1000,True)==[])
    for args in [(None,100,0),(card,0,0),(card,101,0),(card,100,-1),(card,None,0),(uid(),100,0)]:
        for name in ['listar_resumenes_tarjeta_admin','listar_resumenes_tarjeta_financieros_admin']:
            r=sql(auth('select * from '+rpc(name,*args)),False)
            check('rechazo parámetros '+name,r.returncode!=0 and '22023' in r.stderr)
    for name in ['listar_resumenes_tarjeta_admin','listar_resumenes_tarjeta_financieros_admin','listar_resumenes_tarjeta_conjunto_interno']:
        r=sql(f"SET test.uid='{uid()}'; SET ROLE authenticated; SELECT * FROM "+rpc(name,card,100,0),False)
        check('ACL/autorización '+name,r.returncode!=0 and '42501' in r.stderr)
    # Plan interno real: bajo owner, porque las vistas son privadas. Las RPC ya se midieron como authenticated.
    internal=patch[patch.index('    with pagina as materialized'):patch.index('\n  loop')]
    internal=internal.replace('p_tarjeta_id',lit(card)+'::uuid').replace('p_limite','100').replace('p_offset','0')
    plan=json.loads(sql('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+internal).stdout.strip())[0]
    REPORT['internal_plan']=plan
    def nodes(n):
        yield n
        for child in n.get('Plans',[]):yield from nodes(child)
    financial=[n for n in nodes(plan['Plan']) if n.get('Subplan Name')=='CTE finanzas']
    check('plan materializa finanzas una sola vez',len(financial)==1 and financial[0]['Actual Loops']==1)
    check('sin modificaciones de datos al consultar',snapshot()==before)
    REPORT['migration_sha256']=hashlib.sha256(optimized.encode()).hexdigest()
    afters=[x for x in REPORT['benchmarks'] if x['name'].startswith('despues')]
    REPORT['recommendation']='PUBLICABLE' if len(afters)==2 and all(x['passed'] for x in afters) else 'NO PUBLICABLE'
except Exception as e:
    REPORT['failures'].append(str(e));REPORT['recommendation']='NO PUBLICABLE';print('FAIL',str(e),flush=True)
finally:
    if started:REPORT['server_stopped']=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop']).returncode==0
    OUT.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+'\n');print('REPORT',OUT,REPORT['recommendation'],flush=True)
if REPORT['recommendation']!='PUBLICABLE':raise SystemExit(1)
