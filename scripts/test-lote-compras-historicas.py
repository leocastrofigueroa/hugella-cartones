"""PostgreSQL 17 LOCAL sin TCP. Nunca carga .env ni conecta a Supabase.

Reutiliza sólo bootstrap/helpers de la simulación; prueba 140005 real. La
identidad auth.uid es fixture local; es_admin usa la tabla admin_users real.
No acredita JWT/PostgREST real: ese smoke test queda para despliegue autorizado.
"""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[1]
previous = ROOT/'scripts/simular-lote-compras-historicas.py'
namespace = {'__file__': str(previous)}
exec(compile(previous.read_text().split('REPORT_DATA =')[0], str(previous), 'exec'), namespace)
globals().update({k: v for k, v in namespace.items() if not k.startswith('__')})
BATCH = ROOT/'supabase/migrations/202610140005_importar_lote_compras_historicas.sql'
TECHNICAL = '43a4717c-4673-4bab-bce3-96516e62a835'
CALL = 'public.importar_lote_compras_historicas_admin()'
OUTPUT = ROOT/'scripts/fixtures/compras-historicas-lote-pruebas.json'
test_results = []

def passed_test(name):
    test_results.append(dict(prueba=name, estado='PASS'))
    print('PASS:', name, flush=True)


def rejects(name, statements, expected, actor=ACTOR, raw=False):
    before = snapshot()
    response = sql('BEGIN; '+statements+'; COMMIT;' if raw else auth('SELECT '+statements, actor), False)
    assert response.returncode != 0 and expected in response.stderr, (name,response.stderr)
    assert before == snapshot(), name+': cambios parciales'
    passed_test(name)


# Reproduce todos los campos reales suministrados. Los campos no suministrados
# (created_at de tramo/inicio/obligaciones/items y operaciones) siguen siendo
# exclusivamente fixture: no se presentan como evidencia productiva.
_seed_source = _previous_path.read_text().split('def seed_partial(')[1].split('\ndef contend(')[0]
_seed_source = 'def seed_partial(' + _seed_source
_seed_source = _seed_source.replace("uid(7001), uid(7002)", "'ab8e8956-ea0c-4b30-a7b3-994be00a6a21', 'fa4ce36c-1fb8-4299-bc34-f0e68d6ffdd8'")
_seed_source = _seed_source.replace("(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES", "(id,tipo,proveedor_id,fecha,moneda,actor_id,comprobante,created_at) VALUES")
_seed_source = _seed_source.replace("'2026-09-01','ARS','{ACTOR}');", "'2026-10-09','ARS','{ACTOR}','Detalle de la compra 9 de octubre  |  # 2000018893350068','2026-10-11 20:49:42.712662+00');")
_seed_source = _seed_source.replace("(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('{purchase}',1,'Fixture parcial',1,{total})", "(id,compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('ce64d2bf-960d-4da4-9b8a-0c835c0d3ba7','{purchase}',1,'Impresora Hp Smart Tank 210 Sistema Continuo Color 6',1,{total})")
_seed_source = _seed_source.replace("(compra_id,actor_id) VALUES ('{purchase}','{ACTOR}')", "(compra_id,actor_id,created_at) VALUES ('{purchase}','{ACTOR}','2026-10-11 20:49:42.726104+00')")
_seed_source = _seed_source.replace("confirmado_at=clock_timestamp()", "confirmado_at='2026-10-11 20:49:42.740769+00'")
exec(compile(_seed_source, str(_previous_path), 'exec'))

started=False
try:
    for node in _setup_try.body[:_setup_stop]:
        technical_assignment = isinstance(node, ast.Assign) and any(isinstance(t,ast.Name) and t.id=='normal_before' for t in node.targets)
        if technical_assignment:
            sql(f"""BEGIN;
            INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,comprobante,observaciones,created_at,actor_id)
            VALUES ('{TECHNICAL}','MERCADERIA','{SUPPLIER}','2026-10-09','ARS',
             'Detalle de la compra 9 de octubre  |  # 2000018893350068','PRUEBA TÉCNICA 11D.4 — NO ES OPERACIÓN REAL',
             '2026-10-10 21:00:56.651357+00','{ACTOR}');
            INSERT INTO items_compras_gastos(id,compra_gasto_id,posicion,descripcion,cantidad,costo_unitario)
            VALUES ('8fb3c40e-2506-4006-a654-68f52c79d8b0','{TECHNICAL}',1,'Impresora Hp Smart Tank 210 Sistema Continuo Color 6',1,343499);
            COMMIT;""")
            normal_before={'compra_id':TECHNICAL}
        else:
            exec(compile(ast.Module(body=[node], type_ignores=[]),str(_previous_path),'exec'))
    assert normal_before['compra_id']==TECHNICAL
    for _,(supplier_id,name) in PROVIDERS.items():
        if supplier_id==SUPPLIER:
            sql(f"UPDATE proveedores SET nombre={lit(name)} WHERE id='{supplier_id}'")
        else:
            sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES ('{supplier_id}',{lit(name)},'{ACTOR}')")
    for card,order,pid,close,due in PERIODS:
        sql(f"UPDATE periodos_tarjetas SET id='{pid}' WHERE tarjeta_id='{card}' AND orden={order} AND id<>'{pid}'")
    sql(MIGRATION.read_text())
    sql(FINAL.read_text())
    # Hechos de baseline fixture; importaciones/cortes posteriores sólo por RPC.
    sql(f"""BEGIN;
    INSERT INTO operaciones_financieras_compras(operacion_id,actor_id,accion,solicitud,resultado)
    VALUES ('dbdc2cf5-3ce1-4c22-86ce-2f6009769d68','{ACTOR}','ANULACION_COMPRA',
     jsonb_build_object('compra_gasto_id','{TECHNICAL}','motivo','Es una prueba tecnica'),
     jsonb_build_object('compra_gasto_id','{TECHNICAL}','operacion_id','dbdc2cf5-3ce1-4c22-86ce-2f6009769d68',
      'motivo','Es una prueba tecnica','created_at','2026-10-13T22:14:39.462838+00:00','actor_id','{ACTOR}','estado','ANULADA'));
    INSERT INTO anulaciones_compras_gastos(compra_gasto_id,operacion_id,motivo,created_at,actor_id)
    VALUES ('{TECHNICAL}','dbdc2cf5-3ce1-4c22-86ce-2f6009769d68','Es una prueba tecnica','2026-10-13 22:14:39.462838+00','{ACTOR}');
    COMMIT;""")
    # Mismo mecanismo de autorización existente: membership, no UUID hardcodeado.
    sql(f"""CREATE TABLE public.admin_users(user_id uuid primary key references auth.users(id));
    INSERT INTO public.admin_users VALUES ('{ACTOR}'),('{OTHER}');
    CREATE OR REPLACE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
     SELECT EXISTS(SELECT 1 FROM public.admin_users au WHERE au.user_id=auth.uid()) $$;
    REVOKE ALL ON public.admin_users FROM PUBLIC,anon,authenticated,service_role;
    -- Sólo fixture: permite fallos deterministas dentro de las RPC originales.
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
    BEGIN
     IF current_setting('test.fault',true)='compra60' AND (SELECT count(*) FROM public.compras_gastos WHERE fuente='GOOGLE_SHEETS_COMPRAS')=59 THEN
      RAISE EXCEPTION 'FALLO_COMPRA_60'; END IF;
     IF current_setting('test.fault',true)='corte54' AND (SELECT count(*) FROM public.cortes_historicos_obligaciones_tarjeta)=53 THEN
      RAISE EXCEPTION 'FALLO_CORTE_54'; END IF;
     IF current_setting('test.fault',true)='postcheck' AND (SELECT count(*) FROM public.cortes_historicos_obligaciones_tarjeta)=54 THEN
      RAISE EXCEPTION 'FALLO_POSTCHECK_FINAL'; END IF;
     RETURN nullif(current_setting('test.uid',true),'')::uuid;
    END $$;""")
    financial_before = snapshot()
    # Instalaciones incompatibles abortan toda su DDL, sin adoptar el catálogo.
    for label,mutation,message in [
        ('instalación rechaza helper expuesto', 'GRANT EXECUTE ON FUNCTION public.asignar_obligaciones_compra_interno(uuid,uuid) TO anon;', 'Permisos financieros incompatibles'),
        ('instalación rechaza estructura alterada', 'ALTER TABLE public.items_compras_gastos ADD CONSTRAINT fixture_cambio CHECK(total>=0) NOT VALID;', 'Estructura/seguridad financiera incompatible'),
    ]:
        bad=sql('BEGIN; '+mutation+BATCH.read_text(),False)
        assert bad.returncode!=0 and message in bad.stderr,(label,bad.stderr)
        assert snapshot()==financial_before
        assert sql("SELECT to_regclass('public.control_lote_compras_historicas') IS NULL").stdout.strip()=='t'
        passed_test(label)
    sql(BATCH.read_text())
    Path('/private/tmp/hg005-tables-md5.txt').write_text(sql("SELECT md5(((public.catalogo_lote_compras_historicas_interno()->'tablas')-'control_lote_compras_historicas')::text)").stdout.strip())
    assert financial_before==snapshot()
    passed_test('instalar 140005 no carga datos financieros')
    sql('SELECT public.validar_baseline_lote_compras_historicas_interno()')
    passed_test('baseline coincide con todos los campos reales suministrados')
    assert json.loads(sql("SELECT jsonb_agg(value->'row' ORDER BY ord) FROM jsonb_array_elements(public.datos_lote_compras_historicas_interno()) WITH ORDINALITY x(value,ord)").stdout)==source
    passed_test('60 filas embebidas iguales al manifiesto aprobado, campo por campo')
    TABLES.append('control_lote_compras_historicas')
    baseline=snapshot()
    protected_before=protected_snapshot()
    check('SQL Editor sin actor falla', "SELECT auth.uid() IS NULL")
    rejects('sin autenticar',CALL,'No autorizado',actor='')
    rejects('authenticated no admin',CALL,'No autorizado',actor=NONADMIN)
    for role in ['anon','service_role']:
        rejects(role+' sin permiso',f"SET LOCAL ROLE {role}; SELECT {CALL}",'permission denied',raw=True)
    for role in ['anon','authenticated','service_role']:
        assert sql(f"SELECT NOT has_table_privilege('{role}','public.control_lote_compras_historicas','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')").stdout.strip()=='t'
        assert sql(f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname LIKE '%lote_compras_historicas_interno' AND has_function_privilege('{role}',oid,'EXECUTE'))").stdout.strip()=='t'
    passed_test('ACL explícitas de RPC/helpers/control, RLS')
    rejects('REPEATABLE READ rechazado',f"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{ACTOR}'; SELECT {CALL}",'READ COMMITTED',raw=True)
    prefix=f"SET LOCAL test.uid='{ACTOR}'; "
    rejects('proveedor inactivo',prefix+f"UPDATE proveedores SET activo=false WHERE id='{SUPPLIER}'; SELECT {CALL}",'proveedor',raw=True)
    rejects('proveedor renombrado',prefix+f"UPDATE proveedores SET nombre='Otra' WHERE id='{SUPPLIER}'; SELECT {CALL}",'proveedor',raw=True)
    rejects('periodo alterado',prefix+f"UPDATE periodos_tarjetas SET fecha_vencimiento=fecha_vencimiento+1 WHERE id='{PERIODS[0][2]}'; SELECT {CALL}",'período',raw=True)
    # Cambio permitido de metadatos sin tocar defensas: el baseline debe detectarlo.
    rejects('tarjeta alterada',prefix+f"UPDATE tarjetas_credito SET nombre='Otra' WHERE id='{LEO}'; SELECT {CALL}",'tarjeta',raw=True)
    rejects('impresora metadata alterada',prefix+f"UPDATE compras_gastos SET observaciones='Otra' WHERE id='{PRINTER}'; SELECT {CALL}",'cabeceras reales',raw=True)
    rejects('técnica anulada metadata alterada',prefix+f"UPDATE compras_gastos SET observaciones='Otra' WHERE id='{TECHNICAL}'; SELECT {CALL}",'cabeceras reales',raw=True)
    rejects('técnica con financiación inesperada',prefix+f"INSERT INTO financiaciones_compras(compra_id,actor_id) VALUES ('{TECHNICAL}','{ACTOR}'); SELECT {CALL}",'financiación real',raw=True)
    rejects('impresora período alterado',prefix+f"UPDATE obligaciones_tarjetas SET periodo_id='{PERIODS[4][2]}' WHERE compra_id='{PRINTER}' AND numero_cuota=2; SELECT {CALL}",'impresora',raw=True)
    # Prueba de rama exacta impresora: cambio de período sin mover una cuota asignada.
    rejects('impresora alterada rechazada por defensa original',prefix+f"UPDATE obligaciones_tarjetas SET importe=importe+1 WHERE compra_id='{PRINTER}' AND numero_cuota=2; SELECT {CALL}",'inmutable',raw=True)
    # Anular la impresora crea una segunda anulación: no debe adoptarse como A.
    rejects('estado técnica/baseline anulaciones incompatible',prefix+'SELECT '+rpc('anular_compra_gasto_admin',operation_id('fixture','extra-annul'),PRINTER,'fixture')+f'; SELECT {CALL}','técnica anulada',raw=True)
    first=source[0]
    rejects('estado parcial rechazado C',prefix+'SELECT '+PAYLOADS[first['id_origen']]+f'; SELECT {CALL}','C PARCIAL_O_INCONSISTENTE',raw=True)
    for fault,expected in [('compra60','FALLO_COMPRA_60'),('corte54','FALLO_CORTE_54'),('postcheck','FALLO_POSTCHECK_FINAL')]:
        rejects('rollback total '+fault,prefix+f"SET LOCAL test.fault='{fault}'; SET LOCAL ROLE authenticated; SELECT {CALL}",expected,raw=True)
        assert snapshot()==baseline and protected_snapshot()==protected_before
    # Dos sesiones concurrentes: la segunda espera el lock del lote hasta COMMIT.
    a=subprocess.Popen(ARGS,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    b=None
    try:
        a.stdin.write("SET application_name='lote_primero'; "+auth('SELECT '+CALL).replace('COMMIT;','')+'\n\\echo DONE\n'); a.stdin.flush()
        lines=[]
        for line in a.stdout:
            if line.strip()=='DONE': break
            lines.append(line)
        first_result=json.loads(''.join(lines))
        assert first_result['estado_lote']=='IMPORTADO_CORRECTAMENTE', first_result
        b=subprocess.Popen(ARGS,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        b.stdin.write("SET application_name='lote_segundo'; "+auth('SELECT '+CALL)+'\n\\q\n'); b.stdin.flush()
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='lote_segundo' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip()=='t': break
            time.sleep(.02)
        else: raise AssertionError('Segunda sesión no esperó lock')
        a.stdin.write('COMMIT;\n\\q\n'); a.stdin.flush()
        ao,ae=a.communicate(timeout=45); bo,be=b.communicate(timeout=45)
        assert a.returncode==0,ae
        assert b.returncode==0,be
        assert json.loads(bo)['estado_lote']=='YA_APLICADO_CORRECTAMENTE',bo
    finally:
        for process in [a,b]:
            if process is not None and process.poll() is None:
                process.kill(); process.communicate()
    passed_test('admin fixture real membership importa; concurrencia A/B y espera real')
    after=snapshot()
    assert result(CALL)['estado_lote']=='YA_APLICADO_CORRECTAMENTE' and snapshot()==after
    passed_test('segunda llamada y COMMIT incierto reconocen B sin cambios')
    assert result(CALL,OTHER)['estado_lote']=='YA_APLICADO_CORRECTAMENTE' and snapshot()==after
    passed_test('otro admin verifica B sin atribuirse el actor original')
    tx=LocalTransaction()
    controls=audit_batch(tx)
    tx.finish(False)
    assert controls['obligaciones_asignadas']==104 and controls['obligaciones_periodo_null']==176
    assert protected_snapshot()==protected_before
    passed_test('todos los controles exactos por HG/tarjeta y totales de simulación')
    passed_test('104 con período / 176 NULL / 54 cortes con período / cero pagos y aplicaciones')
    passed_test('impresora/técnica/referencias preservadas columna por columna')
    rejects('B rechaza referencia alterada',prefix+f"UPDATE proveedores SET nombre='Otra' WHERE id='{SUPPLIER}'; SELECT {CALL}",'lote aplicado cambió',raw=True)
    rejects('comprobante aplicado inmutable',prefix+"UPDATE control_lote_compras_historicas SET aplicado_at=now()",'inmutable',raw=True)
    assert MANIFEST.read_bytes()==manifest_bytes
    assert hashlib.sha256(FINAL.read_bytes()).hexdigest()=='24a78e37867518043cc542bc0519360aff979e6002f105ec5e6c2cb4ea960011'
    passed_test('manifiesto/140004 intactos')
    OUTPUT.write_text(exact_json(dict(estado='PASS',pruebas=test_results,controles=controls,
      sha256_140005=hashlib.sha256(BATCH.read_bytes()).hexdigest(),produccion=False,
      limitacion='auth.uid fixture local; membership real admin_users. JWT/PostgREST y plataforma requieren smoke test autorizado posterior. Todos los campos reales suministrados reproducidos; tramo/inicio y timestamps no suministrados siguen siendo fixture.'))+'\n')
    print('PASS GLOBAL',len(test_results),flush=True)
finally:
    if started:
        r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
        assert r.returncode==0,r.stderr
