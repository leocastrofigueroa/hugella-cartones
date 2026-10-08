"""PostgreSQL 17 desechable: fixtures sintéticos, socket privado, sin .env ni red."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time

BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ROOT = Path(__file__).resolve().parents[1]
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'PSQL'))}
BASE = Path(tempfile.mkdtemp(prefix='hugella-concurrency-', dir='/private/tmp'))
DATA, SOCKET = BASE / 'data', BASE / 'socket'
SOCKET.mkdir(mode=0o700)
PORT = '55487'
CHILDREN = []

def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'

def run(args, **kwargs):
    result = subprocess.run(args, env=ENV, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]}: {result.stderr} {result.stdout}')
    return result

def command(label):
    return [str(BIN / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-h', str(SOCKET), '-p', PORT, '-U', 'hugella_fixture', '-d', 'postgres',
            '-c', f"set application_name='{label}'; set statement_timeout='15s';"]

def sql(query):
    return run(command('observer') + ['-c', query], timeout=20).stdout.strip()

def session(label, query):
    # Each process opens its own backend, never a pool or in-memory serialization.
    args = command(label)[:-2]
    p = subprocess.Popen(args, env=ENV, text=True, stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1)
    CHILDREN.append(p)
    p.stdin.write(f"\\set VERBOSITY verbose\nset application_name='{label}';\nset statement_timeout='15s';\nbegin;\n{query}\nselect 'READY';\n")
    p.stdin.flush()
    return p

def ready(p):
    q = queue.Queue()
    def read():
        lines = []
        for line in p.stdout:
            if line.strip() == 'READY':
                q.put(lines)
                return
            lines.append(line.strip())
        q.put(RuntimeError(p.stderr.read()))
    t = threading.Thread(target=read, daemon=True)
    t.start()
    result = q.get(timeout=20)
    t.join()
    if isinstance(result, Exception):
        raise result
    return result

def finish(p):
    p.stdin.write('commit;\n\\q\n')
    p.stdin.flush()
    out, err = p.communicate(timeout=20)
    return p.returncode, out, err

def rpc(op, dni, code, product='Fixture'):
    return (f"set local role authenticated; set local test.uid='{uid(1)}';\n"
            f"select row_to_json(r) from public.crear_credito_admin('{uid(op)}','{dni}',"
            f"true,null,'Cliente fixture',null,null,'{code}','{product}',"
            "'2026-10-08',10,100) r;")

def external(dni, code):
    return (f"insert into clientes(nombre,dni) values('Escritor fixture','{dni}');\n"
            "insert into creditos(cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota) "
            f"select id,'{code}','Fixture','2026-10-08',10,100 from clientes "
            f"where dni='{dni}';")

def counts(dnis, codes, operations):
    ds = ','.join(f"'{x}'" for x in dnis)
    cs = ','.join(f"'{x}'" for x in codes)
    ops = ','.join(f"'{uid(x)}'::uuid" for x in operations)
    return json.loads(sql(f"""select json_build_object(
      'clientes',(select count(*) from clientes where regexp_replace(dni,'[^0-9]','','g') in ({ds})),
      'creditos',(select count(*) from creditos where codigo in ({cs})),
      'operaciones',(select count(*) from operaciones_altas_creditos where operacion_id in ({ops})),
      'huerfanos',(select count(*) from clientes cl where regexp_replace(dni,'[^0-9]','','g') in ({ds})
        and not exists(select 1 from creditos cr where cr.cliente_id=cl.id)))"""))

def race(label, first, second, dnis, codes, ops, expected, error=None, retry=False):
    a = session(label + '_a', first)
    result_a = ready(a)
    b = session(label + '_b', second)
    deadline = time.monotonic() + 8
    evidence = None
    while time.monotonic() < deadline:
        value = sql(f"""select row_to_json(t) from (
          select b.pid as esperando, a.pid as bloqueador,b.wait_event_type,b.wait_event
          from pg_stat_activity a join pg_stat_activity b on a.pid=any(pg_blocking_pids(b.pid))
          where a.application_name='{label}_a' and b.application_name='{label}_b') t""")
        if value:
            evidence = json.loads(value)
            break
        if b.poll() is not None:
            raise AssertionError('La segunda sesión terminó sin esperar: ' + b.stderr.read())
        time.sleep(0.05)
    assert evidence, 'No se observó bloqueo real'
    assert evidence['esperando'] != evidence['bloqueador']
    # Keep blocking after observing it, then verify again before releasing A.
    time.sleep(0.25)
    assert sql(f"select {evidence['bloqueador']}=any(pg_blocking_pids({evidence['esperando']}))") == 't'
    assert finish(a)[0] == 0
    if error:
        out, err = b.communicate(timeout=20)
        assert b.returncode != 0 and f'{error}:' in err, (out, err)
    else:
        result_b = ready(b)
        assert finish(b)[0] == 0
        if retry:
            ra, rb = json.loads(result_a[-1]), json.loads(result_b[-1])
            assert not ra['ya_procesada'] and rb['ya_procesada']
            assert {**ra, 'ya_procesada': True} == rb
    actual = counts(dnis, codes, ops)
    assert actual == dict(zip(['clientes','creditos','operaciones','huerfanos'], expected)), actual
    print(json.dumps({'escenario':label,'bloqueo':evidence,'espera_confirmada_ms_min':250,
                      'sqlstate_perdedora':error,'conteos':actual,'retry_coincide':retry}), flush=True)

try:
    print(f'Cluster temporal: {BASE}; socket={SOCKET}; TCP deshabilitado', flush=True)
    run([str(BIN/'initdb'), '-D', str(DATA), '-U', 'hugella_fixture',
         '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    run([str(BIN/'pg_ctl'), '-D', str(DATA), '-l', str(BASE/'server.log'), '-o',
         f"-k {SOCKET} -p {PORT} -c listen_addresses='' -c unix_socket_permissions=0700", 'start', '-w'])
    # Reuse ONLY the synthetic DDL fixture from the existing offline test.
    source = (ROOT/'scripts/test-admin-credit-creation.mjs').read_text()
    fixture = source.split('await db.exec(`',1)[1].split('`);',1)[0]
    sql(fixture)
    sql(f"""insert into auth.users values('{uid(1)}'); insert into admin_users values('{uid(1)}');
      insert into clientes(id,nombre,dni) values('{uid(3)}','Histórico fixture','12345678');
      insert into creditos(id,cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota)
        values('{uid(4)}','{uid(3)}','HISTORICO','Fixture','2026-10-01',10,100);
      insert into pagos values('{uid(5)}','{uid(4)}',100,'2026-10-02');""")
    for name in ['202609090001_estado_efectivo_helpers.sql',
                 '202610080002_clientes_dni_normalizado_unique.sql',
                 '202610080003_buscar_cliente_por_dni_admin.sql',
                 '202610080004_crear_credito_admin.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    historical = """select json_build_object('cliente',(select row_to_json(c) from clientes c where id='"""+uid(3)+"""'),
      'credito',(select row_to_json(c) from creditos c where id='"""+uid(4)+"""'),
      'pagos',(select json_agg(p) from pagos p))"""
    before = sql(historical)
    race('1_misma_solicitud',rpc(100,'20000001','C1'),rpc(100,'20000001','C1'),
         ['20000001'],['C1'],[100],(1,1,1,0),retry=True)
    race('2_solicitudes_distintas',rpc(200,'20000002','C2'),rpc(200,'20000002','C2','Otro'),
         ['20000002'],['C2'],[200],(1,1,1,0),error='22023')
    race('3_mismo_dni',rpc(300,'20000003','C3A'),rpc(301,'20.000.003','C3B'),
         ['20000003'],['C3A','C3B'],[300,301],(1,1,1,0),error='23505')
    race('4_mismo_codigo',rpc(400,'20000004','C4'),rpc(401,'20000005','C4'),
         ['20000004','20000005'],['C4'],[400,401],(1,1,1,0),error='23505')
    race('5a_externo_dni_primero',external('20.000.006','C5A'),rpc(500,'20000006','C5B'),
         ['20000006'],['C5A','C5B'],[500],(1,1,0,0),error='23505')
    race('5b_externo_codigo_primero',external('20000007','C5C'),rpc(501,'20000008','C5C'),
         ['20000007','20000008'],['C5C'],[501],(1,1,0,0),error='23505')
    race('5c_rpc_dni_primero',rpc(502,'20000009','C5D'),external('20 000 009','C5E'),
         ['20000009'],['C5D','C5E'],[502],(1,1,1,0),error='23505')
    race('5d_rpc_codigo_primero',rpc(503,'20000010','C5F'),external('20000011','C5F'),
         ['20000010','20000011'],['C5F'],[503],(1,1,1,0),error='23505')
    assert sql(historical) == before, 'Fixtures históricos alterados'
    assert sql('select deadlocks from pg_stat_database where datname=current_database()') == '0'
    print('PASS: 8 carreras reales; histórico intacto; deadlocks=0; sin huérfanos.', flush=True)
finally:
    for child in CHILDREN:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=10)
    status = subprocess.run([str(BIN/'pg_ctl'),'-D',str(DATA),'status'],env=ENV,capture_output=True)
    if status.returncode == 0:
        run([str(BIN/'pg_ctl'),'-D',str(DATA),'stop','-m','fast','-w'])
    try:
        processes = run(['/bin/ps','-axo','pid=,command=']).stdout
        assert not any(str(BASE) in line and 'postgres' in line for line in processes.splitlines()), 'Proceso temporal restante'
    finally:
        # Remove only after pg_ctl confirms that this isolated server is stopped.
        stopped = subprocess.run([str(BIN/'pg_ctl'),'-D',str(DATA),'status'],env=ENV,capture_output=True)
        assert stopped.returncode != 0, 'Servidor temporal todavía activo'
        assert BASE.parent == Path('/private/tmp') and BASE.name.startswith('hugella-concurrency-')
        shutil.rmtree(BASE)
        assert not BASE.exists()
    print('CLEANUP PASS: servidor detenido, sin procesos temporales, directorio eliminado.',flush=True)
