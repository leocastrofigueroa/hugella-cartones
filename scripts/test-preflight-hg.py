"""Sólo PostgreSQL temporal sin TCP. NUNCA llama al importador de lote.

El estado B se prepara como fixture local mediante las RPC individuales ya
probadas; no se invoca importar_lote_compras_historicas_admin. auth.uid/role son
fixtures: el smoke test JWT/PostgREST real queda fuera de esta suite.
"""
from pathlib import Path
import ast
import sys

ROOT=Path(__file__).resolve().parents[1]
lote=ROOT/'scripts/test-lote-compras-historicas.py'
ns={'__file__':str(lote)}
exec(compile(lote.read_text().split('started=False\ntry:')[0],str(lote),'exec'),ns)
globals().update({k:v for k,v in ns.items() if not k.startswith('__')})
# Completa únicamente el fixture con la nueva evidencia real suministrada.
_seed_source=_seed_source.replace("(id,compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas) VALUES", "(id,compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas,created_at) VALUES")
_seed_source=_seed_source.replace("'{card}',3);", "'{card}',3,'2026-10-11 20:49:42.7306+00');")
_seed_source=_seed_source.replace("(tramo_id,primer_periodo_id,actor_id) VALUES ('{tramo}','{first}','{ACTOR}')", "(tramo_id,primer_periodo_id,actor_id,created_at) VALUES ('{tramo}','{first}','{ACTOR}','2026-10-11 20:49:42.738671+00')")
VARIANT='--tramo-alterado-fixture' in sys.argv
if VARIANT:
    # Se siembra ANTES de confirmar; no se deshabilita ninguna defensa.
    _seed_source=_seed_source.replace('2026-10-11 20:49:42.7306+00','2026-10-11 20:49:42.730601+00')
exec(compile(_seed_source,str(_previous_path),'exec'))
PREFLIGHT=ROOT/'supabase/migrations/202610150001_preflight_lote_compras_historicas.sql'
VERIFY='public.verificar_lote_hg_admin()'
OUTPUT=ROOT/'scripts/fixtures/preflight-hg-pruebas.json'
tests=[]

def mark_test(name):
    tests.append(dict(prueba=name,estado='PASS'))
    print('PASS:',name,flush=True)


def whole_state_query():
    names=json.loads(sql("SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'").stdout)
    return 'SELECT jsonb_build_object('+','.join(lit(t)+f",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.{t} x)" for t in names)+')'


def call(actor=ACTOR,claim_role='authenticated',db_role='authenticated',timeout='8s'):
    return sql(f"BEGIN READ ONLY; SET LOCAL ROLE {db_role}; SET LOCAL test.uid='{actor}'; SET LOCAL test.role='{claim_role}'; SET LOCAL statement_timeout='{timeout}'; SELECT {VERIFY}; COMMIT;",False)


def verify_ready(label='admin LISTO sin escrituras'):
    before=sql(STATE).stdout
    r=call(); assert r.returncode==0,r.stderr
    data=json.loads(r.stdout)
    assert data['estado_lote']=='LISTO_PARA_IMPORTAR',data
    assert data['actor_id']==ACTOR and data['administrador'] and data['solo_lectura']
    assert data['rol_jwt']=='authenticated' and data['transaction_read_only']=='on'
    assert data['statement_timeout']=='8s',data
    assert sql(STATE).stdout==before
    mark_test(label)
    return data


def inconsistent(label,mutation,message):
    baseline=sql(STATE).stdout
    tx=LocalTransaction()
    try:
        tx.query("SET LOCAL test.role='authenticated'")
        tx.query(mutation)
        before=tx.query(STATE)
        data=tx.rpc(VERIFY)
        assert data['estado_lote']=='PARCIAL_O_INCONSISTENTE' and message in data['diagnostico'],(label,data)
        assert tx.query(STATE)==before,'El preflight modificó datos'
    finally:
        tx.finish(False)
    assert sql(STATE).stdout==baseline
    mark_test(label)

started=False
try:
    setup=ast.parse(lote.read_text()).body[-1]
    assert isinstance(setup,ast.Try)
    for node in setup.body:
        # Sólo bootstrap hasta instalar 140005; nunca ejecuta sus tests/importador.
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(lote),'exec'))
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and ast.unparse(node.value)== 'sql(BATCH.read_text())':
            break
    else: raise AssertionError('Cambió el bootstrap')
    sql("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$; GRANT USAGE ON SCHEMA auth TO authenticated;")
    STATE=whole_state_query()
    before=sql(STATE).stdout
    catalog=sql('SELECT public.catalogo_lote_compras_historicas_interno()').stdout
    sql(PREFLIGHT.read_text())
    assert sql(STATE).stdout==before
    assert sql('SELECT public.catalogo_lote_compras_historicas_interno()').stdout==catalog
    mark_test('instalación no altera ninguna tabla ni huella/control de 140005')
    if VARIANT:
        sql('SELECT public.validar_baseline_lote_compras_historicas_interno()')
        r=call(); assert r.returncode==0,r.stderr
        data=json.loads(r.stdout)
        assert data['estado_lote']=='PARCIAL_O_INCONSISTENTE' and 'Tramo real' in data['diagnostico'],data
        assert sql(STATE).stdout==before
        mark_test('timestamp de tramo incorrecto sembrado antes de confirmar: preflight rechaza C sin escrituras')
        raise SystemExit(0)
    assert sql("SELECT NOT ('verificar_lote_hg_admin' LIKE '%compra%' OR 'verificar_lote_hg_admin' LIKE '%tarjeta%' OR 'verificar_lote_hg_admin' LIKE '%historica%')").stdout.strip()=='t'
    mark_test('nombre excluido de los filtros exactos del catálogo')
    ready=verify_ready('A de 140005 sigue válido; admin LISTO en READ ONLY, cero escrituras')
    for label,actor,claim,role,expected in [
        ('sin auth.uid','', 'authenticated','authenticated','No autorizado'),
        ('authenticated no admin',NONADMIN,'authenticated','authenticated','No autorizado'),
        ('anon',ACTOR,'anon','anon','permission denied'),
        ('service_role',ACTOR,'service_role','service_role','permission denied'),
        ('claim service_role no sustituye admin',ACTOR,'service_role','authenticated','No autorizado'),
    ]:
        before=sql(STATE).stdout; r=call(actor,claim,role)
        assert r.returncode!=0 and expected in r.stderr,(label,r.stderr)
        assert sql(STATE).stdout==before
        mark_test(label+' rechazado sin escrituras')
    assert sql("SELECT proowner='postgres'::regrole AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=\"\"'] FROM pg_proc WHERE oid='public.verificar_lote_hg_admin()'::regprocedure").stdout.strip()=='t'
    assert sql("SELECT count(*)=2 AND bool_and(a.grantee IN ('postgres'::regrole,'authenticated'::regrole)) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.verificar_lote_hg_admin()'::regprocedure AND a.privilege_type='EXECUTE'").stdout.strip()=='t'
    mark_test('ACL sin PUBLIC/anon/service_role; postgres owner, STABLE, SECURITY DEFINER, search_path vacío')
    r=call(timeout='13s'); assert json.loads(r.stdout)['statement_timeout']=='13s'
    mark_test('statement_timeout observa 8s y 13s de la solicitud sin cambiarlo')
    inconsistent('permisos del importador alterados', 'GRANT EXECUTE ON FUNCTION public.importar_lote_compras_historicas_admin() TO anon', 'Infraestructura/ACL')
    inconsistent('proveedor alterado',f"UPDATE proveedores SET activo=false WHERE id='{SUPPLIER}'",'proveedor')
    inconsistent('período alterado',f"UPDATE periodos_tarjetas SET fecha_vencimiento=fecha_vencimiento+1 WHERE id='{PERIODS[0][2]}'",'período')
    inconsistent('impresora alterada',f"UPDATE compras_gastos SET observaciones='Otra' WHERE id='{PRINTER}'",'cabeceras reales')
    inconsistent('técnica alterada',f"UPDATE compras_gastos SET observaciones='Otra' WHERE id='{TECHNICAL}'",'cabeceras reales')
    inconsistent('obligación alterada',f"UPDATE obligaciones_tarjetas SET periodo_id='{PERIODS[4][2]}' WHERE compra_id='{PRINTER}' AND numero_cuota=2",'obligaciones reales')
    # Los hechos ya confirmados no se pueden alterar ni como owner por DML normal.
    for label,mutation in [
      ('tramo alterado',f"UPDATE tramos_pago_compras SET posicion=2 WHERE id='{TRAMO}'"),
    ]:
        before=sql(STATE).stdout
        r=sql('BEGIN; '+mutation+'; ROLLBACK;',False)
        assert r.returncode!=0 and 'inmutable' in r.stderr,(label,r.stderr)
        assert sql(STATE).stdout==before
        mark_test(label+' rechazado por defensa financiera original')
    inconsistent('inicio alterado',f"UPDATE inicios_tramos_tarjeta SET created_at=created_at+interval '1 second' WHERE tramo_id='{TRAMO}'",'Inicio real')
    # Aplicación inesperada genuina: fixture financiero local en tx que se revierte.
    inconsistent('aplicación/pago inesperados',f"SET LOCAL test.uid='{ACTOR}'; SELECT "+rpc('registrar_pago_resumen_tarjeta_admin',operation_id('fixture','unexpected-payment'),PERIOD,'2026-10-15',1,'fixture'),'baseline de compras/obligaciones/pagos')
    first=source[0]
    inconsistent('estado parcial no se completa', 'SELECT '+PAYLOADS[first['id_origen']], 'PARCIAL_O_INCONSISTENTE')
    variant=run([sys.executable,str(Path(__file__).resolve()),'--tramo-alterado-fixture'])
    assert variant.returncode==0,(variant.stdout,variant.stderr)
    mark_test('tramo con timestamp real alterado: diagnóstico C en fixture independiente, sin desactivar defensas')
    # B sin ejecutar el importador de lote: preparación explícita de fixture.
    before_fixture=sql('SELECT public.snapshot_lote_compras_historicas_interno()').stdout.strip()
    sql(f"""BEGIN; SET LOCAL test.uid='{ACTOR}'; SET LOCAL test.role='authenticated';
    DO $fixture$ DECLARE e jsonb; r jsonb; cut jsonb; o public.obligaciones_tarjetas%rowtype; BEGIN
     FOR e IN SELECT value FROM jsonb_array_elements(public.datos_lote_compras_historicas_interno()) LOOP
      r:=e->'row';
      PERFORM public.importar_compra_historica_admin((e->>'op')::uuid,r->>'id_origen',r->>'tipo',(e->>'proveedor_id')::uuid,
       (r->>'fecha')::date,r->>'moneda',null,null,r->>'descripcion',(r->>'total_historico')::numeric,e->'tramos',nullif(e->'evidencia','null'::jsonb));
     END LOOP;
     SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
     FOR e IN SELECT value FROM jsonb_array_elements(public.datos_lote_compras_historicas_interno()) LOOP
      r:=e->'row';
      FOR cut IN SELECT value FROM jsonb_array_elements(e->'cortes') LOOP
       SELECT ob.* INTO STRICT o FROM public.obligaciones_tarjetas ob JOIN public.compras_gastos c ON c.id=ob.compra_id
        WHERE c.id_origen=r->>'id_origen' AND ob.numero_cuota=(cut->>'numero')::integer;
       PERFORM public.registrar_corte_historico_obligacion_admin((cut->>'operacion_id')::uuid,o.id,
        (r->>'id_origen')||' cuota '||o.numero_cuota||' / fuente GOOGLE_SHEETS_COMPRAS','2026-10-14',o.importe);
      END LOOP;
     END LOOP;
    END $fixture$;
    SET CONSTRAINTS ALL IMMEDIATE;
    UPDATE public.control_lote_compras_historicas SET actor_id='{ACTOR}',antes={lit(before_fixture)}::jsonb,
      despues=public.snapshot_lote_compras_historicas_interno(),aplicado_at=clock_timestamp(); COMMIT;""")
    before=sql(STATE).stdout; r=call(); assert r.returncode==0,r.stderr
    applied=json.loads(r.stdout); assert applied['estado_lote']=='YA_APLICADO_CORRECTAMENTE',applied
    assert sql(STATE).stdout==before
    mark_test('B reconocido en READ ONLY sin escrituras, fixture sin ejecutar importador de lote')
    inconsistent('B alterado exige revisión',f"UPDATE proveedores SET nombre='Otra' WHERE id='{SUPPLIER}'",'Lote aplicado cambió')
    assert hashlib.sha256(BATCH.read_bytes()).hexdigest()=='d27d59c450da90b2c2f149b75dd259e50f362c67bd8175e96fdb51c593b992b9'
    mark_test('140005 intacta')
    OUTPUT.write_text(exact_json(dict(estado='PASS',pruebas=tests,preflight_a=ready,preflight_b=applied,
      sha256_migracion=hashlib.sha256(PREFLIGHT.read_bytes()).hexdigest(),produccion=False,importador_lote_ejecutado=False,
      limitacion='auth.uid/role fixtures; sin JWT/PostgREST real. B preparado con RPC individuales en PostgreSQL temporal.'))+'\n')
    print('PASS GLOBAL PREFLIGHT:',len(tests),flush=True)
finally:
    if started:
        stopped=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
        assert stopped.returncode==0,stopped.stderr
