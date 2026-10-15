"""Benchmark exclusivamente LOCAL del importador real, autorizado para medición.

Nunca carga .env ni URLs remotas. Bootstrap idéntico al preflight real/fixture.
Cada muestra A parte de una copia nueva del baseline y confirma íntegramente;
B se mide después y C se rechaza localmente. El reporte distingue tiempo de sentencia y overhead de proceso.
"""
from pathlib import Path
import ast
import statistics
import time

ROOT=Path(__file__).resolve().parents[1]
preflight_test=ROOT/'scripts/test-preflight-hg.py'
ns={'__file__':str(preflight_test)}
exec(compile(preflight_test.read_text().split('started=False\ntry:')[0],str(preflight_test),'exec'),ns)
globals().update({k:v for k,v in ns.items() if not k.startswith('__')})
IMPORT='public.importar_lote_compras_historicas_admin()'
REPORT=ROOT/'scripts/fixtures/tiempo-lote-hg.json'
# psql --timing mide SELECT incluyendo su resultado, sin el arranque de proceso.
def timed_select(expression,commit=False):
    query=f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{ACTOR}'; SET LOCAL test.role='authenticated'; SET LOCAL statement_timeout='8s';\n\\timing on\nSELECT {expression};\n"+('COMMIT;' if commit else 'ROLLBACK;')+'\n\\timing off\n'
    wall=time.perf_counter(); r=sql(query,False); wall=time.perf_counter()-wall
    assert r.returncode==0,r.stderr
    import re
    timing=re.findall(r'Time: ([0-9.]+) ms',r.stdout)
    assert len(timing)==2,r.stdout
    data=json.loads(r.stdout.splitlines()[0])
    return dict(segundos=sum(float(t) for t in timing)/1000,select_segundos=float(timing[0])/1000,fin_transaccion_segundos=float(timing[1])/1000,wall_segundos=wall,respuesta=data)

started=False
try:
    setup=ast.parse(lote.read_text()).body[-1]
    for node in setup.body:
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(lote),'exec'))
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and ast.unparse(node.value)=='sql(BATCH.read_text())':break
    sql("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;")
    sql(PREFLIGHT.read_text())
    TABLES.append('control_lote_compras_historicas')
    sql('CREATE DATABASE hg_measure_base TEMPLATE postgres')
    samples=[]
    for i in range(10):
        db=f'hg_measure_{i}'
        sql(f'CREATE DATABASE {db} TEMPLATE hg_measure_base')
        ARGS[-1]=db
        protected=protected_snapshot()
        sample=timed_select(IMPORT,commit=True)
        assert sample['respuesta']['estado_lote']=='IMPORTADO_CORRECTAMENTE'
        assert protected_snapshot()==protected
        assert sql("SELECT (SELECT count(*) FROM compras_gastos WHERE fuente='GOOGLE_SHEETS_COMPRAS')=60 AND (SELECT count(*) FROM cortes_historicos_obligaciones_tarjeta)=54").stdout.strip()=='t'
        samples.append(sample)
        print(f'PASS muestra A {i+1}: {sample["segundos"]:.6f}s, SELECT+COMMIT completo en copia nueva',flush=True)
    applied=samples[-1]
    after=snapshot()
    b=[timed_select(IMPORT) for _ in range(5)]
    assert all(x['respuesta']['estado_lote']=='YA_APLICADO_CORRECTAMENTE' for x in b) and snapshot()==after
    sql_before=snapshot()
    # C después de cambio documental permitido; la excepción revierte mutación.
    r=sql(f"BEGIN; SET LOCAL test.uid='{ACTOR}'; UPDATE proveedores SET nombre='Fixture alterado' WHERE id='{SUPPLIER}'; SELECT {IMPORT}; COMMIT;",False)
    assert r.returncode!=0 and 'PARCIAL_O_INCONSISTENTE' in r.stderr and snapshot()==sql_before
    data=dict(estado='PASS',postgres=sql('SELECT version()').stdout.strip(),
      hardware_contexto='Mac local aarch64; no representa CPU/carga/IO de Supabase',
      medicion='10 bases nuevas clonadas del baseline; sentencia completa + COMMIT, sin overhead de creación de base/proceso',
      muestras_a=samples,muestra_commit=applied,muestras_b=b,clasificacion_c_rechazada=True,
      minimo_segundos=min(x['segundos'] for x in samples),promedio_segundos=statistics.mean(x['segundos'] for x in samples),
      maximo_segundos=max(x['segundos'] for x in samples),
      margen_minimo_8s=8-max(x['segundos'] for x in samples),statement_timeout_prueba='8s',
      produccion=False,sha256_140005=hashlib.sha256(BATCH.read_bytes()).hexdigest(),
      sha256_150001=hashlib.sha256(PREFLIGHT.read_bytes()).hexdigest())
    REPORT.write_text(exact_json(data)+'\n')
    print(json.dumps({k:v for k,v in data.items() if k.endswith('segundos') or k=='margen_minimo_8s'}),flush=True)
finally:
    if started:
        stopped=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
        assert stopped.returncode==0,stopped.stderr
