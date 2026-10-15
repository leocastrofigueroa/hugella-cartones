"""PostgreSQL 17 aislado, solo socket /private/tmp; jamás usa credenciales remotas.

Fixtures sintéticos: no manifiesto ni carga de las 60 compras. Instala los SQL
originales (incluidos preflights) y comprueba el esquema final y concurrencia.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'PSQL'))}
BASE = Path(tempfile.mkdtemp(prefix='hg-importacion-test-', dir='/private/tmp'))
DATA, SOCKET = BASE / 'data', BASE / 'socket'
SOCKET.mkdir(mode=0o700)
ARGS = [str(BIN/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(SOCKET), '-p', '55498', '-U', 'postgres', '-d', 'postgres']
uid = lambda n: f'00000000-0000-4000-8000-{n:012d}'
ACTOR = '34366896-c76c-4959-ac05-519274da9736'
OTHER, NONADMIN, SUPPLIER = uid(2), uid(3), uid(4)
LEO = '6087c186-6e63-4469-9b4d-99f0873caf5e'
FACU = '028985a6-a5f7-4569-948b-10abf9ba2b76'
PRINTER = '7171c5cb-90dc-4a41-a470-29b207bc2895'
TRAMO = '362fba80-fa95-49ff-8514-22dbf1627c2d'
PERIOD = '5d5a4689-416e-451b-add1-ec71fd3eea36'
OBLIGATION = '545c1742-003a-451c-9e55-748d1cc93dcb'
MIGRATION = ROOT/'supabase/migrations/202610140003_importacion_compras_historicas.sql'
TABLES = ['compras_gastos', 'items_compras_gastos', 'operaciones_compras_gastos',
          'operaciones_financieras_compras', 'financiaciones_compras', 'tramos_pago_compras',
          'obligaciones_tarjetas', 'inicios_tramos_tarjeta', 'periodos_tarjetas',
          'pagos_resumenes_tarjetas', 'aplicaciones_pagos_obligaciones',
          'anulaciones_compras_gastos', 'cortes_historicos_obligaciones_tarjeta']
passed = 0


def run(args, **kwargs):
    return subprocess.run(args, env=ENV, text=True, capture_output=True, timeout=45, **kwargs)


def sql(query, ok=True):
    r = run(ARGS, input=query)
    if ok:
        assert r.returncode == 0, r.stderr
    return r


def mark(label):
    global passed
    passed += 1
    print('PASS:', label, flush=True)


def check(label, query):
    assert sql(query).stdout.strip() == 't', label
    mark(label)


def lit(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def rpc(name, *args):
    return name + '(' + ','.join(lit(x) for x in args) + ')'


def auth(query, actor=ACTOR):
    return f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{actor}'; {query}; COMMIT;"


def result(query, actor=ACTOR):
    return json.loads(sql(auth('SELECT ' + query, actor)).stdout)


def snapshot():
    return sql('SELECT jsonb_build_object(' + ','.join(
        lit(t) + f",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM {t} x)"
        for t in TABLES) + ')').stdout


def reject(label, query, message, actor=ACTOR, raw=False):
    before = snapshot()
    r = sql('BEGIN; ' + query + '; COMMIT;' if raw else auth('SELECT ' + query, actor), False)
    assert r.returncode != 0 and message in r.stderr, (label, r.stderr)
    assert before == snapshot(), label + ': partial write'
    mark(label + ' / rollback íntegro')


def credit(card, first, amount=100, cuotas=3, position=1):
    return dict(posicion=position, medio='TARJETA_CREDITO', importe=amount,
                tarjeta_id=card, cantidad_cuotas=cuotas, primer_periodo_id=first)


def immediate(amount=100, medium='TARJETA_DEBITO', date='2026-09-01', position=1):
    return dict(posicion=position, medio=medium, importe=amount, fecha_pago=date)


def historic(op, hg, total=100, tramos=None, description=' Resumen heredado ', date='2026-09-01', supplier=SUPPLIER):
    return rpc('importar_compra_historica_admin', uid(op), hg, 'MERCADERIA', supplier,
               date, 'ARS', ' ', None, description, total,
               json.dumps(tramos if tramos is not None else [immediate(total)]))


def normal(op, total=100, tramos=None, items=None):
    return rpc('crear_compra_financiada_admin', uid(op), 'MERCADERIA', SUPPLIER,
               '2026-09-01', 'ARS', None, None,
               json.dumps(items if items is not None else [dict(posicion=1, descripcion='Normal', cantidad=1, costo_unitario=total)]),
               json.dumps(tramos if tramos is not None else [immediate(total, 'EFECTIVO')]))


def obligations(purchase):
    return sql(f"SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY numero_cuota),'[]') FROM obligaciones_tarjetas o WHERE compra_id='{purchase}'").stdout


def existing_facts():
    return sql(f"SELECT jsonb_build_object('compra',(SELECT to_jsonb(c)-ARRAY['fuente','id_origen'] FROM compras_gastos c WHERE id='{PRINTER}'),'items',(SELECT jsonb_agg(to_jsonb(i)-ARRAY['modalidad','importe_historico'] ORDER BY posicion) FROM items_compras_gastos i WHERE compra_gasto_id='{PRINTER}'),'financiacion',(SELECT to_jsonb(f) FROM financiaciones_compras f WHERE compra_id='{PRINTER}'),'tramos',(SELECT jsonb_agg(to_jsonb(t) ORDER BY posicion) FROM tramos_pago_compras t WHERE compra_id='{PRINTER}'),'obligaciones',(SELECT jsonb_agg(to_jsonb(o) ORDER BY numero_cuota) FROM obligaciones_tarjetas o WHERE compra_id='{PRINTER}'),'inicio',(SELECT to_jsonb(i) FROM inicios_tramos_tarjeta i WHERE tramo_id='{TRAMO}'))").stdout


def seed_partial(purchase, tramo, card, first, total=100, obligation=None):
    # Estado válido de financiación confirmada antes del siguiente barrido.
    amounts = [((total*100)//3 + (1 if n <= (total*100)%3 else 0))/100 for n in range(1, 4)]
    ids = [obligation or uid(7000), uid(7001), uid(7002)] if purchase == PRINTER else [uid(7100), uid(7101), uid(7102)]
    values = ','.join(f"('{ids[n-1]}','{purchase}','{tramo}','{card}',{n},3,{amounts[n-1]},{lit(first) if n==1 else 'NULL'})" for n in range(1, 4))
    sql(f"""BEGIN;
    INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES ('{purchase}','MERCADERIA','{SUPPLIER}','2026-09-01','ARS','{ACTOR}');
    INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('{purchase}',1,'Fixture parcial',1,{total});
    INSERT INTO financiaciones_compras(compra_id,actor_id) VALUES ('{purchase}','{ACTOR}');
    INSERT INTO tramos_pago_compras(id,compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas) VALUES ('{tramo}','{purchase}',1,'TARJETA_CREDITO',{total},'{card}',3);
    INSERT INTO obligaciones_tarjetas(id,compra_id,tramo_id,tarjeta_id,numero_cuota,cantidad_cuotas,importe,periodo_id) VALUES {values};
    INSERT INTO inicios_tramos_tarjeta(tramo_id,primer_periodo_id,actor_id) VALUES ('{tramo}','{first}','{ACTOR}');
    UPDATE financiaciones_compras SET estado='CONFIRMADA',confirmado_at=clock_timestamp() WHERE compra_id='{purchase}'; COMMIT;""")


def contend(first, second, second_ok=True):
    """Demuestra bloqueo real; la segunda sesión empieza antes del COMMIT de la primera."""
    a = subprocess.Popen(ARGS, env=ENV, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    b = None
    try:
        a.stdin.write("SET application_name='historico_first'; " + auth('SELECT ' + first).replace('COMMIT;', '') + '\n')
        a.stdin.flush()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='historico_first' AND state='idle in transaction')").stdout.strip() == 't':
                break
            time.sleep(.02)
        else:
            raise AssertionError('First session failed to hold transaction')
        b = subprocess.Popen(ARGS, env=ENV, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        b.stdin.write("SET application_name='historico_second'; " + auth('SELECT ' + second) + '\n\\q\n')
        b.stdin.flush()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='historico_second' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip() == 't':
                break
            time.sleep(.02)
        else:
            raise AssertionError('Second session was not blocked')
        a.stdin.write('COMMIT;\n\\q\n')
        a.stdin.flush()
        ao, ae = a.communicate(timeout=20)
        bo, be = b.communicate(timeout=20)
        assert a.returncode == 0, ae
        if second_ok:
            assert b.returncode == 0, be
            assert json.loads(ao) == json.loads(bo)
        else:
            assert b.returncode != 0 and 'HG existente' in be, be
        return json.loads(ao)
    finally:
        for proc in (a, b):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.communicate()


started = False
try:
    r = run([str(BIN/'initdb'), '-D', str(DATA), '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    assert r.returncode == 0, r.stderr
    r = run([str(BIN/'pg_ctl'), '-D', str(DATA), '-l', str(BASE/'server.log'), '-o', f"-k {SOCKET} -p 55498 -c listen_addresses=''", '-w', 'start'])
    assert r.returncode == 0, r.stderr
    started = True
    print(sql('SELECT version()').stdout.strip(), flush=True)
    sql(f"""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('{ACTOR}'),('{OTHER}'),('{NONADMIN}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION public.es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('{ACTOR}'::uuid,'{OTHER}'::uuid) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated,service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;""")
    for name in ['202610090003_compras_gastos_base.sql', '202610090004_compras_gastos_rpc_admin.sql',
                 '202610100001_comprobantes_compras_gastos.sql', '202610110001_financiacion_compras_base.sql',
                 '202610110002_financiacion_compras_rpc_admin.sql', '202610110003_compra_financiada_admin.sql',
                 '202610110004_editar_tarjeta_credito_admin.sql', '202610110005_observaciones_listado_compras.sql',
                 '202610110006_anulacion_compras_gastos.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES ('{SUPPLIER}','Fixture','{ACTOR}'); INSERT INTO tarjetas_credito(id,nombre,entidad,actor_id) VALUES ('{LEO}','Visa Leo','Santander','{ACTOR}'),('{FACU}','Visa Facu','Santander','{ACTOR}'); INSERT INTO periodos_tarjetas(id,tarjeta_id,orden,fecha_cierre,fecha_vencimiento,actor_id) VALUES ('{PERIOD}','{LEO}',1,'2026-10-22','2026-11-02','{ACTOR}');")
    seed_partial(PRINTER, TRAMO, LEO, PERIOD, 343499, OBLIGATION)
    # Segunda compra existente: RPC normal con decimales, para comparar economía.
    normal_before = result(normal(10, total=1.01, items=[dict(posicion=1, descripcion='Decimal existente', cantidad=3, costo_unitario=.335)]))
    for name in ['202610140001_backfill_periodos_tarjetas_historicos.sql', '202610140002_corte_historico_compras.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    mark('baseline completo original, seis períodos reales, dos compras existentes')
    before = snapshot()
    original_printer = existing_facts()
    original_detail = result(rpc('obtener_compra_gasto_admin', normal_before['compra_id']))
    migration = MIGRATION.read_text()
    r = sql(migration.replace('commit;', 'SELECT 1/0; commit;'), False)
    assert r.returncode != 0 and 'division by zero' in r.stderr, r.stderr
    assert snapshot() == before
    check('rollback instalación conserva esquema', "SELECT NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='compras_gastos'::regclass AND attname='fuente' AND NOT attisdropped)")
    sql('ALTER TABLE compras_gastos DISABLE TRIGGER compra_financiada_inmutable')
    r = sql(migration, False)
    assert r.returncode != 0 and 'Estructura financiera incompatible' in r.stderr, r.stderr
    sql('ALTER TABLE compras_gastos ENABLE TRIGGER compra_financiada_inmutable')
    mark('preflight rechaza trigger deshabilitado')
    sql(migration)
    assert existing_facts() == original_printer
    after_detail = result(rpc('obtener_compra_gasto_admin', normal_before['compra_id']))
    after_detail.pop('fuente'); after_detail.pop('id_origen')
    for item in after_detail['items']:
        assert item.pop('modalidad') == 'DETALLADO' and item.pop('importe_historico') is None
    assert after_detail == original_detail
    check('infraestructura no carga historia ni cortes', "SELECT count(*)=2 AND bool_and(fuente IS NULL AND id_origen IS NULL) AND NOT EXISTS(SELECT 1 FROM cortes_historicos_obligaciones_tarjeta) FROM compras_gastos")
    mark('dos compras existentes preservadas columna por columna / total decimal idéntico')

    helpers = ['proteger_procedencia_compra', 'validar_compra_historica_integridad',
               'canonicalizar_tramos_compra_interno', 'asignar_obligaciones_compra_interno',
               'confirmar_financiacion_compra_interno']
    for role in ['anon', 'authenticated', 'service_role']:
        check(role + ' sin EXECUTE helpers', f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ({','.join(lit(x) for x in helpers)}) AND has_function_privilege('{role}',oid,'EXECUTE'))")
        check(role + ' sin acceso directo', f"SELECT NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv WHERE c.oid IN ({','.join(lit('public.'+t)+'::regclass' for t in TABLES)}) AND has_table_privilege('{role}',c.oid,priv))")
    check('tablas RLS sin policies y owner postgres', f"SELECT bool_and(relrowsecurity AND relowner='postgres'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid IN ({','.join(lit('public.'+t)+'::regclass' for t in TABLES)})) FROM pg_class WHERE oid IN ({','.join(lit('public.'+t)+'::regclass' for t in TABLES)})")
    check('helpers y RPC metadata seguros', f"SELECT count(*)=6 AND bool_and(proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=\"\"']) FROM pg_proc WHERE proname IN ({','.join(lit(x) for x in helpers+['importar_compra_historica_admin'])})")
    reject('no admin', historic(20, 'HG-0001'), 'No autorizado', actor=NONADMIN)
    reject('sin sesión', historic(20, 'HG-0001'), 'No autorizado', actor='')
    for role in ['anon', 'service_role']:
        reject(role + ' sin RPC', f"SET LOCAL ROLE {role}; SELECT {historic(20, 'HG-0001')}", 'permission denied', raw=True)
    for isolation in ['REPEATABLE READ', 'SERIALIZABLE']:
        reject('aislamiento ' + isolation, f"SET TRANSACTION ISOLATION LEVEL {isolation}; SET LOCAL ROLE authenticated; SET LOCAL test.uid='{ACTOR}'; SELECT {historic(20, 'HG-0001')}", 'READ COMMITTED', raw=True)

    q = historic(20, 'HG-0001')
    h = result(q); hp = h['compra_id']
    assert h['id_origen'] == 'HG-0001' and h['fuente'] == 'GOOGLE_SHEETS_COMPRAS'
    d = result(rpc('obtener_compra_gasto_admin', hp)); i = d['items'][0]
    assert i['cantidad'] is None and i['costo_unitario'] is None and i['modalidad'] == 'TOTAL_HISTORICO' and i['total'] == 100
    mark('HG conserva ceros, procedencia y único resumen con desconocidos NULL')
    assert result(q) == h and result(historic(21, 'HG-0001', description='Resumen heredado')) == h
    mark('idempotencia por UUID y HG con UUID diferente / canonicalización')
    check('operaciones auditadas reales', f"SELECT (SELECT count(*) FROM operaciones_financieras_compras WHERE operacion_id IN ('{h['operacion_id']}','{h['operacion_financiacion_id']}'))=2 AND (SELECT solicitud->>'id_origen'='HG-0001' AND solicitud->>'total'='100' AND NOT solicitud ? 'cantidad' FROM operaciones_compras_gastos WHERE operacion_id='{h['operacion_compra_id']}')")
    check('débito histórico sin obligaciones ni tarjeta', f"SELECT medio='TARJETA_DEBITO' AND fecha_pago='2026-09-01' AND tarjeta_id IS NULL AND cantidad_cuotas IS NULL AND NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas WHERE compra_id='{hp}') FROM tramos_pago_compras WHERE compra_id='{hp}'")
    reject('HG distinto contenido', historic(22, 'HG-0001', total=101), 'HG existente')
    reject('HG otro actor', historic(23, 'HG-0001'), 'HG existente', actor=OTHER)
    reject('UUID otro contenido', historic(20, 'HG-0002'), 'Operación utilizada')
    for hg in ['HG-1', 'HG-00001', 'hg-0001', ' HG-0001', None]:
        reject('HG inválido ' + str(hg), historic(24, hg), 'Compra histórica inválida')
    for total in [-1, 'NaN', 'Infinity', '100.001', '10000000000000000']:
        reject('importe inválido ' + str(total), historic(25, 'HG-0002', total=total, tramos=[]), 'Compra histórica inválida')
    reject('débito fecha distinta', historic(26, 'HG-0002', tramos=[immediate(date='2026-09-02')]), 'Débito histórico')
    reject('débito con tarjeta', historic(26, 'HG-0002', tramos=[dict(immediate(), tarjeta_id=LEO)]), 'Tramo inmediato inválido')
    reject('suma incompatible', historic(26, 'HG-0002', tramos=[immediate(99)]), 'Suma de tramos')
    reject('proveedor inexistente', historic(26, 'HG-0002', supplier=uid(999)), 'Proveedor inexistente')
    reject('descripción vacía', historic(26, 'HG-0002', description=' '), 'Compra histórica inválida')
    check('unique PostgreSQL válido', "SELECT convalidated FROM pg_constraint WHERE conrelid='compras_gastos'::regclass AND conname='compras_gastos_fuente_id_origen_unique'")
    reject('duplicado HG por DML directo', f"INSERT INTO compras_gastos(tipo,proveedor_id,fecha,moneda,actor_id,fuente,id_origen) VALUES ('GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS','HG-0001')", 'unique constraint', raw=True)
    reject('procedencia incompleta', f"INSERT INTO compras_gastos(tipo,proveedor_id,fecha,moneda,actor_id,fuente) VALUES ('GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS')", 'procedencia_check', raw=True)
    reject('HG inmutable', f"UPDATE compras_gastos SET id_origen='HG-9999' WHERE id='{hp}'", 'Procedencia', raw=True)
    reject('no reinterpretar compra existente', f"UPDATE compras_gastos SET fuente='GOOGLE_SHEETS_COMPRAS',id_origen='HG-9999' WHERE id='{PRINTER}'", 'Procedencia', raw=True)
    reject('ítems históricos inmutables', f"UPDATE items_compras_gastos SET importe_historico=99 WHERE compra_gasto_id='{hp}'", 'inmutables', raw=True)
    reject('histórico sin operación RPC', f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id,fuente,id_origen) VALUES ('{uid(40)}','GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS','HG-0040'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,modalidad,importe_historico) VALUES ('{uid(40)}',1,'Resumen','TOTAL_HISTORICO',100)", 'operación de importación', raw=True)
    reject('histórico sin resumen', f"INSERT INTO compras_gastos(tipo,proveedor_id,fecha,moneda,actor_id,fuente,id_origen) VALUES ('GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS','HG-0040')", 'exactamente un resumen', raw=True)
    reject('resumen en compra normal', f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES ('{uid(40)}','GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,modalidad,importe_historico) VALUES ('{uid(40)}',1,'Resumen','TOTAL_HISTORICO',100)", 'requiere procedencia', raw=True)
    reject('mezcla modalidades', f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id,fuente,id_origen) VALUES ('{uid(40)}','GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS','HG-0040'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('{uid(40)}',1,'Detalle',1,100); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,modalidad,importe_historico) VALUES ('{uid(40)}',2,'Resumen','TOTAL_HISTORICO',100)", 'exactamente un resumen', raw=True)
    reject('cantidad ficticia en resumen', f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id,fuente,id_origen) VALUES ('{uid(40)}','GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}','GOOGLE_SHEETS_COMPRAS','HG-0040'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,modalidad,cantidad,costo_unitario,importe_historico) VALUES ('{uid(40)}',1,'Resumen','TOTAL_HISTORICO',1,100,100)", 'modalidad_check', raw=True)
    sql("CREATE FUNCTION fail_historical_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.accion='IMPORTACION_COMPRA_HISTORICA' THEN RAISE EXCEPTION 'historical audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_historical_audit_fixture BEFORE INSERT ON operaciones_financieras_compras FOR EACH ROW EXECUTE FUNCTION fail_historical_audit_fixture();")
    reject('falla auditoría final histórica revierte compra/ítem/financiación/tres operaciones', historic(41, 'HG-0041'), 'historical audit failure')
    sql('DROP TRIGGER fail_historical_audit_fixture ON operaciones_financieras_compras; DROP FUNCTION fail_historical_audit_fixture()')
    sql("CREATE FUNCTION fail_historical_deferred_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.modalidad='TOTAL_HISTORICO' THEN RAISE EXCEPTION 'historical deferred failure'; END IF; RETURN NULL; END $$; CREATE CONSTRAINT TRIGGER fail_historical_deferred_fixture AFTER INSERT ON items_compras_gastos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_historical_deferred_fixture();")
    reject('error al COMMIT histórico revierte todo el conjunto', historic(42, 'HG-0042'), 'historical deferred failure')
    sql('DROP TRIGGER fail_historical_deferred_fixture ON items_compras_gastos; DROP FUNCTION fail_historical_deferred_fixture()')
    reject('authenticated DML directo bloqueado', 'SET LOCAL ROLE authenticated; SELECT * FROM compras_gastos', 'permission denied', raw=True)
    reject('asignador limitado exige compra', f"SELECT public.asignar_obligaciones_compra_interno('{LEO}',NULL)", 'Compra obligatoria', raw=True)

    contend(historic(50, 'HG-0050'), historic(50, 'HG-0050')); mark('concurrencia mismo HG mismo UUID / bloqueo observado')
    contend(historic(51, 'HG-0051'), historic(52, 'HG-0051')); mark('concurrencia mismo HG UUID distinto / bloqueo observado')
    contend(historic(53, 'HG-0053'), historic(54, 'HG-0053', total=101), False); mark('concurrencia HG payload diferente falla sin duplicar')
    check('una compra por HG concurrente', "SELECT count(*)=3 FROM compras_gastos WHERE id_origen IN ('HG-0050','HG-0051','HG-0053')")

    fl = sql(f"SELECT id FROM periodos_tarjetas WHERE tarjeta_id='{LEO}' AND orden=1").stdout.strip()
    ff = sql(f"SELECT id FROM periodos_tarjetas WHERE tarjeta_id='{FACU}' AND orden=1").stdout.strip()
    witness = uid(60)
    seed_partial(witness, uid(61), LEO, fl)
    witness_before = obligations(witness)
    printer_before = obligations(PRINTER)
    assigned_before = sql("SELECT jsonb_object_agg(id,periodo_id) FROM obligaciones_tarjetas WHERE periodo_id IS NOT NULL").stdout
    for n in range(100, 103):
        hleo = result(historic(n, f'HG-{n:04d}', tramos=[credit(LEO, fl)]))
        assert obligations(PRINTER) == printer_before and obligations(witness) == witness_before
        check('Leo histórica ' + str(n) + ' períodos reales y restante NULL', f"SELECT array_agg(p.orden ORDER BY o.numero_cuota)=ARRAY[1,2,NULL] FROM obligaciones_tarjetas o LEFT JOIN periodos_tarjetas p ON p.id=o.periodo_id WHERE o.compra_id='{hleo['compra_id']}'")
    for n in range(110, 113):
        hfacu = result(historic(n, f'HG-{n:04d}', tramos=[credit(FACU, ff)]))
        check('Facu histórica ' + str(n) + ' julio/agosto/septiembre', f"SELECT array_agg(p.orden ORDER BY o.numero_cuota)=ARRAY[1,2,3] FROM obligaciones_tarjetas o JOIN periodos_tarjetas p ON p.id=o.periodo_id WHERE o.compra_id='{hfacu['compra_id']}'")
    assert obligations(PRINTER) == printer_before and obligations(witness) == witness_before and existing_facts() == original_printer
    mark('impresora byte-for-byte y testigo misma tarjeta sin completar después de seis históricas')
    assigned = json.loads(assigned_before)
    after_assigned = json.loads(sql("SELECT jsonb_object_agg(id,periodo_id) FROM obligaciones_tarjetas WHERE periodo_id IS NOT NULL").stdout)
    assert all(after_assigned[k] == v for k, v in assigned.items())
    mark('ninguna obligación asignada movida')
    result(normal(120, tramos=[credit(LEO, fl)]))
    check('flujo NORMAL mantiene barrido amplio y completa testigo', f"SELECT array_agg(p.orden ORDER BY o.numero_cuota)=ARRAY[1,2,NULL] FROM obligaciones_tarjetas o LEFT JOIN periodos_tarjetas p ON p.id=o.periodo_id WHERE o.compra_id='{witness}'")
    assert obligations(PRINTER) == printer_before
    check('no períodos inventados', 'SELECT count(*)=6 FROM periodos_tarjetas')
    reject('primer período otra tarjeta / atomicidad', historic(130, 'HG-0130', tramos=[credit(LEO, ff)]), 'Primer período incompatible')
    unassigned = result(historic(131, 'HG-0131', tramos=[credit(LEO, None)]))
    check('sin ancla mantiene todas NULL', f"SELECT bool_and(periodo_id IS NULL) FROM obligaciones_tarjetas WHERE compra_id='{unassigned['compra_id']}'")
    zero = result(historic(132, 'HG-0132', total=0, tramos=[]))
    check('total cero sin tramos', f"SELECT NOT EXISTS(SELECT 1 FROM tramos_pago_compras WHERE compra_id='{zero['compra_id']}')")
    mixed = result(historic(133, 'HG-0133', total=100.01, tramos=[immediate(40.01), credit(FACU, ff, amount=60, position=2)]))
    check('tramos mixtos exactos', f"SELECT sum(importe)=100.01 FROM tramos_pago_compras WHERE compra_id='{mixed['compra_id']}'")
    check('centavos 100 / 3', f"SELECT array_agg(importe ORDER BY numero_cuota)=ARRAY[33.34,33.33,33.33]::numeric[] FROM obligaciones_tarjetas WHERE compra_id='{hfacu['compra_id']}'")

    # Cortes no son pagos; se prueban protecciones anteriores + procedencia nueva.
    oid = sql(f"SELECT id FROM obligaciones_tarjetas WHERE compra_id='{hleo['compra_id']}' AND numero_cuota=1").stdout.strip()
    cutq = rpc('registrar_corte_historico_obligacion_admin', uid(140), oid, 'HG-0102 cuota 1', '2026-10-14', 33.34)
    cut = result(cutq); assert result(cutq) == cut
    mark('corte idempotente en compra histórica')
    saldo = result(rpc('obtener_financiacion_compra_admin', hleo['compra_id']))
    assert saldo['total_pagado'] == 0 and saldo['total_corte_historico'] == 33.34 and saldo['saldo_operativo'] == 66.66 and saldo['saldo_historico'] == 100
    detail = result(rpc('obtener_detalle_financiacion_compra_admin', hleo['compra_id']))
    assert detail['cuotas'][0]['total_aplicado'] == 0 and detail['cuotas'][0]['estado'] == 'SALDADA_HISTORICAMENTE'
    mark('corte no aumenta total_pagado ni total_aplicado; saldo operativo correcto')
    reject('corte compra normal', rpc('registrar_corte_historico_obligacion_admin', uid(141), OBLIGATION, 'fixture', '2026-10-14', 114499.67), 'origen histórico')
    reject('corte incompleto', rpc('registrar_corte_historico_obligacion_admin', uid(142), sql(f"SELECT id FROM obligaciones_tarjetas WHERE compra_id='{hleo['compra_id']}' AND numero_cuota=2").stdout.strip(), 'fixture', '2026-10-14', 1), 'cubrir obligación completa')
    reject('corte sin período', rpc('registrar_corte_historico_obligacion_admin', uid(143), sql(f"SELECT id FROM obligaciones_tarjetas WHERE compra_id='{hleo['compra_id']}' AND numero_cuota=3").stdout.strip(), 'fixture', '2026-10-14', 33.33), 'Corte requiere obligación')
    reject('obligación cortada no cambia período', f"UPDATE obligaciones_tarjetas SET periodo_id=NULL WHERE id='{oid}'", 'corte histórico inmutable', raw=True)
    reject('compra cortada no se anula', rpc('anular_compra_gasto_admin', uid(144), hleo['compra_id'], 'fixture'), 'corte histórico')
    reject('pago directo sobre corte', f"INSERT INTO aplicaciones_pagos_obligaciones(pago_id,obligacion_id,importe) VALUES ('{uid(900)}','{oid}',1)", 'saldada históricamente', raw=True)
    reject('corte inmutable', f"UPDATE cortes_historicos_obligaciones_tarjeta SET referencia='otra' WHERE obligacion_id='{oid}'", 'Corte histórico inmutable', raw=True)
    reject('evidencia corte incompatible / diferido', f"SET LOCAL test.uid='{ACTOR}'; INSERT INTO cortes_historicos_obligaciones_tarjeta(obligacion_id,operacion_id,fuente,referencia,fecha_corte,importe,actor_id) SELECT id,'{uid(145)}','GOOGLE_SHEETS_COMPRAS','fixture','2026-10-14',importe,'{ACTOR}' FROM obligaciones_tarjetas WHERE compra_id='{hfacu['compra_id']}' AND numero_cuota=1", 'foreign key', raw=True)
    paid = result(rpc('registrar_pago_resumen_tarjeta_admin', uid(150), ff, '2026-10-14', 1, None))
    paid_oid = paid['aplicaciones'][0]['obligacion_id']
    amount = sql(f"SELECT importe FROM obligaciones_tarjetas WHERE id='{paid_oid}'").stdout.strip()
    reject('corte bloquea obligación con pago real', rpc('registrar_corte_historico_obligacion_admin', uid(151), paid_oid, 'fixture', '2026-10-14', amount), 'pago real')
    reject('pago excede saldo / atomicidad', rpc('registrar_pago_resumen_tarjeta_admin', uid(152), ff, '2026-10-14', 999999, None), 'excede saldo')
    reject('pago real inmutable', f"UPDATE pagos_resumenes_tarjetas SET importe=2 WHERE id='{paid['pago_id']}'", 'Hecho de pago inmutable', raw=True)
    anul = result(rpc('anular_compra_gasto_admin', uid(160), hp, 'Fixture'))
    assert anul['estado'] == 'ANULADA'
    assert result(rpc('anular_compra_gasto_admin', uid(160), hp, 'Fixture')) == anul
    assert result(q) == h
    mark('anulación histórica auditada y retry importación nunca recrea compra anulada')
    n = result(normal(170))
    assert result(normal(170)) == n
    mark('RPC normal conserva resultado e idempotencia')
    check('compras nuevas normales sin procedencia', f"SELECT fuente IS NULL AND id_origen IS NULL FROM compras_gastos WHERE id='{n['compra_id']}'")
    reject('normal payload alterado', normal(170, total=101), 'Operación utilizada')
    reject('normal total cliente no aceptado', normal(171, items=[dict(posicion=1, descripcion='N', cantidad=1, costo_unitario=100, total=100)]), 'total no se acepta')
    reject('normal cantidad NULL no aceptada', normal(171, items=[dict(posicion=1, descripcion='N', cantidad=None, costo_unitario=100)]), 'total no se acepta')
    reject('normal resumen no aceptado', normal(171, items=[dict(posicion=1, descripcion='N', modalidad='TOTAL_HISTORICO', importe_historico=100)]), 'total no se acepta')
    reject('confirmada normal ítems inmutables', f"UPDATE items_compras_gastos SET costo_unitario=101 WHERE compra_gasto_id='{n['compra_id']}'", 'inmutables', raw=True)
    result(rpc('anular_compra_gasto_admin', uid(172), n['compra_id'], 'Fixture normal'))
    reject('anulada no admite financiación', rpc('confirmar_financiacion_compra_admin', uid(173), n['compra_id'], '[]'), 'Compra anulada')
    assert existing_facts() == original_printer
    mark('impresora completa preservada al final de todas las pruebas')
    final_detail = result(rpc('obtener_compra_gasto_admin', normal_before['compra_id']))
    final_detail.pop('fuente'); final_detail.pop('id_origen')
    for item in final_detail['items']:
        item.pop('modalidad'); item.pop('importe_historico')
    assert final_detail == original_detail
    mark('segunda compra existente preservada al final de todas las pruebas')
    print(f'PASS: {passed} checks; PostgreSQL local only', flush=True)
    print('SHA-256:', hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), flush=True)
finally:
    if started:
        r = run([str(BIN/'pg_ctl'), '-D', str(DATA), '-m', 'fast', '-w', 'stop'])
        assert r.returncode == 0, r.stderr
