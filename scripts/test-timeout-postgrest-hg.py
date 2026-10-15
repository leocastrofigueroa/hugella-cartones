"""Integración PostgreSQL + PostgREST LOCAL. Jamás usa .env/URLs productivas.

Requiere binario oficial PostgREST (HG_POSTGREST_BIN). HTTP sólo 127.0.0.1,
PostgreSQL sólo socket privado /tmp. JWT firmados con secreto efímero de fixture.
Ejecuta el lote sólo en ese fixture para medir/probar la delegación autorizada.
"""
from pathlib import Path
import ast
import base64
import hmac
import http.client
import os
import secrets
import socket
import statistics
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
helper=ROOT/'scripts/test-preflight-hg.py'
ns={'__file__':str(helper)}
exec(compile(helper.read_text().split('started=False\ntry:')[0],str(helper),'exec'),ns)
globals().update({k:v for k,v in ns.items() if not k.startswith('__')})
NEW=ROOT/'supabase/migrations/202610150002_plazo_lote_hg.sql'
OUTPUT=ROOT/'scripts/fixtures/timeout-postgrest-hg.json'
PGRST=Path(os.environ.get('HG_POSTGREST_BIN','/private/tmp/hg-postgrest-bin/postgrest'))
assert PGRST.is_file(),'Se requiere HG_POSTGREST_BIN con binario oficial local'
JWT_SECRET=secrets.token_hex(32)
checks=[]
server=None
started=False

def passed(label):
    checks.append(label); print('PASS:',label,flush=True)


def token(actor=ACTOR,role='authenticated'):
    enc=lambda x:base64.urlsafe_b64encode(x).rstrip(b'=')
    parts=[enc(json.dumps({'alg':'HS256','typ':'JWT'}).encode()),enc(json.dumps({'sub':actor,'role':role,'exp':int(time.time())+600}).encode())]
    parts.append(enc(hmac.new(JWT_SECRET.encode(),b'.'.join(parts),hashlib.sha256).digest()))
    return b'.'.join(parts).decode()


def http_rpc(name,method='POST',actor=ACTOR,role='authenticated',rollback=False,authenticated=True):
    assert name.replace('_','').isalnum()
    c=http.client.HTTPConnection('127.0.0.1',PORT,timeout=55)
    headers={}
    if authenticated: headers['Authorization']='Bearer '+token(actor,role)
    if rollback: headers['Prefer']='tx=rollback'
    if method=='POST': headers['Content-Type']='application/json'
    start=time.perf_counter()
    c.request(method,'/rpc/'+name,body='{}' if method=='POST' else None,headers=headers)
    r=c.getresponse(); body=r.read(); elapsed=time.perf_counter()-start; status=r.status
    c.close()
    return status,json.loads(body),elapsed

try:
    setup=ast.parse(lote.read_text()).body[-1]
    for node in setup.body:
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(lote),'exec'))
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and ast.unparse(node.value)=='sql(BATCH.read_text())':break
    # auth fixture que acepta JWT locales validados por PostgREST; no modifica
    # ninguna función public incluida en la huella ni sus permisos.
    sql("""CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
    BEGIN
     IF current_setting('test.slow',true)='corte54' AND (SELECT count(*) FROM public.cortes_historicos_obligaciones_tarjeta)=53 THEN
      RAISE NOTICE 'FIXTURE_LATE compras=60 cortes=53'; PERFORM pg_sleep(2); END IF;
     RETURN coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('test.uid',true),''))::uuid;
    END $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
     SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('test.role',true),'')) $$;
    CREATE ROLE authenticator LOGIN NOINHERIT;
    GRANT anon,authenticated,service_role TO authenticator;
    ALTER ROLE authenticated SET statement_timeout='8s';""")
    sql(PREFLIGHT.read_text())
    STATE=whole_state_query()
    before=sql(STATE).stdout; catalog=sql('SELECT public.catalogo_lote_compras_historicas_interno()').stdout
    sql(NEW.read_text())
    assert before==sql(STATE).stdout and catalog==sql('SELECT public.catalogo_lote_compras_historicas_interno()').stdout
    passed('instalar 150002 no cambia datos/control/huella; 140005 y 150001 compatibles')
    sql("""CREATE TABLE public.hg_timer_facts(id integer);
    REVOKE ALL ON public.hg_timer_facts FROM public,anon,authenticated,service_role;
    CREATE FUNCTION public.hg_timer_cfg() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='2s' AS $$
     BEGIN INSERT INTO public.hg_timer_facts VALUES(1); PERFORM pg_sleep(0.25); END $$;
    CREATE FUNCTION public.hg_timer_body() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
     BEGIN INSERT INTO public.hg_timer_facts VALUES(2); PERFORM set_config('statement_timeout','45s',true); PERFORM pg_sleep(9); END $$;
    REVOKE ALL ON FUNCTION public.hg_timer_body() FROM public,anon,service_role;
    GRANT EXECUTE ON FUNCTION public.hg_timer_body() TO authenticated;""")
    STATE=whole_state_query(); baseline=sql(STATE).stdout
    r=sql("SET statement_timeout='100ms'; SELECT public.hg_timer_cfg();",False)
    assert r.returncode!=0 and 'statement timeout' in r.stderr and baseline==sql(STATE).stdout,r.stderr
    passed('PostgreSQL directo: SET de función SECURITY DEFINER no extiende sentencia de 100ms')
    # Cancelación tardía del lote: 60 compras y 53 cortes ya escritos, sin COMMIT.
    r=sql(f"BEGIN; SET LOCAL test.uid='{ACTOR}'; SET LOCAL test.role='authenticated'; SET LOCAL test.slow='corte54'; SET LOCAL statement_timeout='1500ms'; SELECT public.ejecutar_lote_hg_admin(); COMMIT;",False)
    assert r.returncode!=0 and 'statement timeout' in r.stderr and 'FIXTURE_LATE compras=60 cortes=53' in r.stderr,r.stderr
    assert baseline==sql(STATE).stdout
    passed('cancelación SQL tardía revierte 60 compras/53 cortes/control; SET 45s interno no reinicia timer 1500ms')
    pgrst_env=dict(ENV,DYLD_LIBRARY_PATH='/opt/homebrew/opt/postgresql@17/lib/postgresql')
    with socket.socket() as s: s.bind(('127.0.0.1',0)); PORT=s.getsockname()[1]
    ver=subprocess.run([str(PGRST),'--version'],env=pgrst_env,text=True,capture_output=True,timeout=10)
    assert ver.returncode==0,ver.stderr
    version=ver.stdout.strip()
    config=BASE/'postgrest.conf'
    config.write_text(f'db-uri = "host={SOCKET} port=55498 dbname=postgres user=authenticator"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "{JWT_SECRET}"\nserver-host = "127.0.0.1"\nserver-port = {PORT}\ndb-tx-end = "commit-allow-override"\n')
    config.chmod(0o600)
    log=(BASE/'postgrest.log').open('w')
    server=subprocess.Popen([str(PGRST),str(config)],env=pgrst_env,stdout=log,stderr=log)
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        if server.poll() is not None: raise AssertionError((BASE/'postgrest.log').read_text())
        try:
            c=http.client.HTTPConnection('127.0.0.1',PORT,timeout=1); c.request('GET','/'); response=c.getresponse(); response.read(); c.close()
            if response.status==200:break
        except (ConnectionError,OSError): pass
        time.sleep(.1)
    else: raise AssertionError((BASE/'postgrest.log').read_text())
    status,a,_=http_rpc('verificar_lote_hg_admin','GET')
    assert status==200 and a['estado_lote']=='LISTO_PARA_IMPORTAR' and a['statement_timeout']=='8s' and a['transaction_read_only']=='on',(status,a)
    passed('PostgREST real local + JWT fixture: preflight normal conserva 8s/read-only')
    status,body,body_s=http_rpc('hg_timer_body')
    assert status!=200 and body.get('code')=='57014' and baseline==sql(STATE).stdout,(status,body)
    passed('PostgREST: set_config dentro del cuerpo no evita cancelación 8s, escritura revertida')
    status,probe,probe_s=http_rpc('verificar_plazo_hg_admin','GET')
    assert status==200 and probe['prueba_plazo']=='SUPERADA_9S' and probe['statement_timeout']=='45s' and probe['transaction_read_only']=='on' and probe_s>=9,(status,probe)
    assert baseline==sql(STATE).stdout
    passed('PostgREST hoista 45s antes de sentencia: probe READ ONLY supera 9s con rol base 8s')
    for actor,role,authenticated in [(NONADMIN,'authenticated',True),(ACTOR,'service_role',True),(ACTOR,'anon',False)]:
        status,data,_=http_rpc('ejecutar_lote_hg_admin',actor=actor,role=role,authenticated=authenticated)
        assert status in (401,403,404),(status,data)
    assert baseline==sql(STATE).stdout
    passed('wrapper rechaza no-admin, service_role y anónimo sin escrituras')
    assert sql("SELECT proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='public.importar_lote_compras_historicas_admin()'::regprocedure").stdout.strip()=='t'
    passed('importador original sin SET timeout; proconfig intacta')
    timings=[]
    for i in range(3):
        status,res,elapsed=http_rpc('ejecutar_lote_hg_admin',rollback=True)
        assert status==200 and res['estado_lote']=='IMPORTADO_CORRECTAMENTE',(status,res)
        assert baseline==sql(STATE).stdout
        timings.append(elapsed)
    passed('tres lotes REST completos con rollback: 60/280/54/postchecks y misma base')
    status,res,commit_s=http_rpc('ejecutar_lote_hg_admin')
    assert status==200 and res['estado_lote']=='IMPORTADO_CORRECTAMENTE',(status,res)
    committed=sql(STATE).stdout
    status,applied,_=http_rpc('verificar_lote_hg_admin','GET')
    assert status==200 and applied['estado_lote']=='YA_APLICADO_CORRECTAMENTE',(status,applied)
    status,retry,_=http_rpc('ejecutar_lote_hg_admin')
    assert status==200 and retry['estado_lote']=='YA_APLICADO_CORRECTAMENTE' and committed==sql(STATE).stdout
    passed('COMMIT local, pérdida simulada de respuesta, preflight B antes de reintentar; cero duplicados')
    sql_before=sql(STATE).stdout
    r=sql(f"BEGIN; SET LOCAL test.uid='{ACTOR}'; SET LOCAL test.role='authenticated'; UPDATE proveedores SET nombre='Otra' WHERE id='{SUPPLIER}'; SELECT public.ejecutar_lote_hg_admin(); COMMIT;",False)
    assert r.returncode!=0 and 'PARCIAL_O_INCONSISTENTE' in r.stderr and sql_before==sql(STATE).stdout
    passed('C falla cerrado sin reparar ni completar')
    report=dict(estado='PASS',checks=checks,postgres=sql('SELECT version()').stdout.strip(),
      postgrest=version,
      timer_interno_ignorado=True,body_set_cancelado_segundos=body_s,probe_9s=probe,probe_wall_segundos=probe_s,
      rest_muestras_a_segundos=timings,rest_promedio_segundos=statistics.mean(timings),rest_commit_segundos=commit_s,
      recuperacion_preflight_b=applied,produccion=False,
      sha256_150002=hashlib.sha256(NEW.read_bytes()).hexdigest())
    OUTPUT.write_text(exact_json(report)+'\n')
    print('PASS GLOBAL POSTGREST:',len(checks),flush=True)
finally:
    if server is not None:
        server.terminate(); server.wait(timeout=10)
    if started:
        stopped=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
        assert stopped.returncode==0,stopped.stderr
