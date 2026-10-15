"""Infraestructura 140004: PostgreSQL local sin TCP, fixtures aislados.

Reutiliza solo helpers/bootstrap de 140003. Nunca importa el manifiesto de 60
compras en una base; el lote completo se verifica aritméticamente en memoria.
"""
import ast
from pathlib import Path

_previous_path = Path(__file__).with_name('test-importacion-compras-historicas.py')
_previous = ast.parse(_previous_path.read_text())
_setup_try = _previous.body[-1]
assert isinstance(_setup_try, ast.Try)
_setup_stop = next(i for i, n in enumerate(_setup_try.body) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'before' for t in n.targets))
exec(compile(ast.Module(body=_previous.body[:-1], type_ignores=[]), str(_previous_path), 'exec'))
NEW = ROOT/'supabase/migrations/202610140004_financiacion_historica_sheets.sql'
started = False
try:
    exec(compile(ast.Module(body=_setup_try.body[:_setup_stop], type_ignores=[]), str(_previous_path), 'exec'))
    sql(MIGRATION.read_text())
    migration = NEW.read_text()
    schema_query = migration[migration.index('(select md5(baseline::text)'):migration.index(" is distinct from '535b9bb1d15c1d341ce7294e77bed45d'")]
    assert sql('SELECT '+schema_query).stdout.strip() == '535b9bb1d15c1d341ce7294e77bed45d'
    before = snapshot()
    r = sql(migration.replace('commit;', 'SELECT 1/0; commit;'), False)
    assert r.returncode != 0 and 'division by zero' in r.stderr, r.stderr
    assert before == snapshot()
    mark('fallo instalación revierte catálogo y datos')
    sql('ALTER TABLE obligaciones_tarjetas DISABLE TRIGGER obligaciones_integridad')
    r = sql(migration, False)
    assert r.returncode != 0 and 'Estructura histórica incompatible' in r.stderr, r.stderr
    sql('ALTER TABLE obligaciones_tarjetas ENABLE TRIGGER obligaciones_integridad')
    mark('preflight detecta trigger financiero deshabilitado')
    sql(migration)
    TABLES.append('evidencias_financiacion_historica_compras')
    check('infraestructura sin cargas ni evidencia sembrada', "SELECT (SELECT count(*) FROM compras_gastos)=2 AND NOT EXISTS(SELECT 1 FROM evidencias_financiacion_historica_compras) AND NOT EXISTS(SELECT 1 FROM cortes_historicos_obligaciones_tarjeta)")
    periods_before = sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY tarjeta_id,orden) FROM periodos_tarjetas p').stdout
    printer_before = existing_facts()
    printer_obligations = obligations(PRINTER)
    second_before = result(rpc('obtener_compra_gasto_admin', normal_before['compra_id']))
    after_install = json.loads(snapshot())
    for t in after_install['tramos_pago_compras']:
        assert t.pop('estrategia_distribucion') == 'NORMAL'
        assert t.pop('valor_cuota_historico') is None
    after_install.pop('evidencias_financiacion_historica_compras')
    assert after_install == json.loads(before)
    mark('dos compras existentes: todas las columnas previas idénticas tras instalar')
    fl = sql(f"SELECT id FROM periodos_tarjetas WHERE tarjeta_id='{LEO}' AND orden=1").stdout.strip()
    ff = sql(f"SELECT id FROM periodos_tarjetas WHERE tarjeta_id='{FACU}' AND orden=1").stdout.strip()

    def evidence(card=LEO, first=None, value=33.33, q=3, paid=1, pending=2, saldo=66.67, documentary=False):
        first = first or fl
        p = json.loads(sql(f"SELECT to_jsonb(p) FROM periodos_tarjetas p WHERE id='{first}'").stdout)
        return dict(tarjeta_original='Visa L' if card == LEO else 'Visa F',
                    tarjeta_canonica='Visa Leo Santander' if card == LEO else 'Visa Facu Santander',
                    tarjeta_id=card, periodo_inicial_id=first, cuotas_fuente=q,
                    valor_cuota_historico=value, pagadas_historicas=paid, pendientes_historicas=pending,
                    saldo_historico=saldo, estado_original='🟢 Activa', cierre_original=p['fecha_cierre'],
                    vencimiento_original=p['fecha_vencimiento'],
                    tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' if documentary else 'FINANCIACION_HISTORICA_OPERATIVA')

    def hist(op, hg, total=100, e=None, tramos=None, date='2026-09-01', tipo='MERCADERIA'):
        ts = tramos
        if ts is None:
            ts = [] if e and e['tratamiento']=='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' else [credit(e['tarjeta_id'], e['periodo_inicial_id'], total, e['cuotas_fuente'])]
        return rpc('importar_compra_historica_admin', uid(op), hg, tipo, SUPPLIER, date, 'ARS', None, None,
                   'FIXTURE histórica aislada', total, json.dumps(ts), json.dumps(e) if e is not None else None)

    e = evidence()
    q = hist(2000, 'HG-2000', e=e)
    first = result(q)
    hp = first['compra_id']
    assert result(q) == first and result(hist(2001, 'HG-2000', e=e)) == first
    mark('histórica con evidencia idempotente por operación y HG; retry de respuesta perdida')
    check('estrategia histórica explícita e inmutable', f"SELECT estrategia_distribucion='HISTORICA_SHEETS' AND valor_cuota_historico=33.33 FROM tramos_pago_compras WHERE compra_id='{hp}'")
    check('residuo exclusivamente final', f"SELECT array_agg(importe ORDER BY numero_cuota)=ARRAY[33.33,33.33,33.34]::numeric[] FROM obligaciones_tarjetas WHERE compra_id='{hp}'")
    reject('evidencia distinta mismo HG', hist(2002, 'HG-2000', e=e|{'estado_original':'Otra'}), 'HG existente')
    reject('otro actor mismo HG', q, 'Operación utilizada', actor=OTHER)
    reject('saldo no reconcilia', hist(2003, 'HG-2003', e=e|{'saldo_historico':66.66}), 'no reconcilia')
    reject('pagadas+pendientes no reconcilia', hist(2003, 'HG-2003', e=e|{'pendientes_historicas':1}), 'no reconcilia')
    reject('última cuota no positiva', hist(2003, 'HG-2003', e=evidence(value=60, paid=0, pending=3, saldo=100)), 'tramos_estrategia')
    reject('fuente fully-paid con residuo pendiente', hist(2003, 'HG-2003', e=evidence(value=33.33, paid=3, pending=0, saldo=.01)), 'incompatible')
    reject('firma antigua tarjeta sin evidencia', historic(2004, 'HG-2004', tramos=[credit(LEO, fl)]), 'requiere evidencia')
    reject('zero sin evidencia no se degrada', historic(2004, 'HG-0043', total=0, tramos=[]), 'requiere evidencia')
    reject('número evidencia string', hist(2003, 'HG-2003', e=e|{'valor_cuota_historico':'33.33'}), 'Número de evidencia')
    reject('tarjeta canónica incorrecta', hist(2003, 'HG-2003', e=e|{'tarjeta_canonica':'Visa Facu Santander'}), 'Tarjeta canónica')
    reject('período pertenece otra tarjeta', hist(2003, 'HG-2003', e=e|{'periodo_inicial_id':ff}, tramos=[credit(LEO, ff)]), 'foreign key')
    reject('fecha de evidencia diferente al período real', hist(2003, 'HG-2003', e=e|{'cierre_original':'2026-09-23'}), 'Período histórico')

    ze = evidence(first=PERIOD, value=0, q=1, paid=0, pending=1, saldo=0, documentary=True)
    zq = hist(2043, 'HG-0043', total=0, e=ze, tipo='GASTO', date='2026-09-25')
    for phase, table in [('evidencia','evidencias_financiacion_historica_compras'),('auditoria','operaciones_financieras_compras')]:
        sql(f"CREATE FUNCTION fail_zero_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo cero fixture'; END $$; CREATE TRIGGER fail_zero_fixture BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION fail_zero_fixture();")
        reject('HG-0043 atomicidad fallo '+phase, zq, 'fallo cero fixture')
        sql(f'DROP TRIGGER fail_zero_fixture ON {table}; DROP FUNCTION fail_zero_fixture()')
    sql("CREATE FUNCTION fail_zero_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo cero COMMIT'; END $$; CREATE CONSTRAINT TRIGGER fail_zero_fixture AFTER INSERT ON evidencias_financiacion_historica_compras DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_zero_fixture();")
    reject('HG-0043 atomicidad fallo COMMIT', zq, 'fallo cero COMMIT')
    sql('DROP TRIGGER fail_zero_fixture ON evidencias_financiacion_historica_compras; DROP FUNCTION fail_zero_fixture()')
    z = contend(zq, zq); zp = z['compra_id']
    mark('HG-0043 creación concurrente con bloqueo observado y única compra/evidencia')
    assert result(zq) == z and result(hist(2044, 'HG-0043', total=0, e=ze, tipo='GASTO', date='2026-09-25')) == z
    mark('HG-0043 retry/pérdida de respuesta sin duplicar y evidencia preservada')
    check('HG-0043 sin financiación/tramos/obligaciones/cortes', f"SELECT NOT EXISTS(SELECT 1 FROM financiaciones_compras WHERE compra_id='{zp}') AND NOT EXISTS(SELECT 1 FROM tramos_pago_compras WHERE compra_id='{zp}') AND NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas WHERE compra_id='{zp}')")
    zd = result(rpc('obtener_detalle_financiacion_compra_admin', zp))
    assert zd['estado'] == 'FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' and zd['saldo_operativo'] == 0 and zd['total_pagado'] == 0 and zd['formas_pago'] == [] and zd['cuotas'] == []
    assert zd['evidencia_historica']['pendientes_historicas'] == 1
    mark('lectura documental explícita; no pagada, anulada, sin financiación ni deuda monetaria')
    reject('documental no admite financiación normal', rpc('confirmar_financiacion_compra_admin', uid(2045), zp, '[]'), 'sin importe no admite')
    reject('documental no se anula', rpc('anular_compra_gasto_admin', uid(2046), zp, 'fixture'), 'documental')
    reject('documental ítem inmutable', f"UPDATE items_compras_gastos SET importe_historico=1 WHERE compra_gasto_id='{zp}'", 'documental inmutable', raw=True)
    reject('documental cabecera inmutable', f"UPDATE compras_gastos SET observaciones='otra' WHERE id='{zp}'", 'documental inmutable', raw=True)
    reject('evidencia inmutable UPDATE', f"UPDATE evidencias_financiacion_historica_compras SET pendientes_historicas=0 WHERE compra_id='{zp}'", 'Evidencia histórica inmutable', raw=True)
    reject('evidencia inmutable DELETE', f"DELETE FROM evidencias_financiacion_historica_compras WHERE compra_id='{zp}'", 'Evidencia histórica inmutable', raw=True)
    reject('cero documental solo HG-0043', hist(2047, 'HG-2047', total=0, e=ze, tipo='GASTO'), 'sin importe operativo incompatible')
    reject('HG-0043 no acepta tramo ficticio', hist(2047, 'HG-0043', total=0, e=ze, tramos=[credit(LEO, PERIOD, amount=0, cuotas=1)], tipo='GASTO'), 'Medio o importe inválido')
    reject('HG-0043 evidencia alterada', hist(2047, 'HG-0043', total=0, e=ze|{'estado_original':'Otro'}, tipo='GASTO', date='2026-09-25'), 'HG existente')

    for role in ['anon','authenticated','service_role']:
        check(role+' sin acceso directo evidencia', f"SELECT NOT has_table_privilege('{role}','evidencias_financiacion_historica_compras','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')")
        check(role+' sin helpers internos', f"SELECT NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('canonicalizar_evidencia_historica_interno','validar_evidencia_compra_interno','proteger_evidencia_historica_compra','validar_evidencia_historica_compra','proteger_compra_documental_historica','proteger_operacion_documental_historica','confirmar_financiacion_compra_interno') AND has_function_privilege('{role}',oid,'EXECUTE'))")
    check('evidencia postgres/RLS/sin policies', "SELECT relowner='postgres'::regrole AND relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='evidencias_financiacion_historica_compras'::regclass) FROM pg_class WHERE oid='evidencias_financiacion_historica_compras'::regclass")
    reject('no admin', hist(2100, 'HG-2100', e=e), 'No autorizado', actor=NONADMIN)
    reject('escritura directa evidencia', 'SET LOCAL ROLE authenticated; DELETE FROM evidencias_financiacion_historica_compras', 'permission denied', raw=True)
    reject('normal tramo cero', normal(2101, total=0, tramos=[credit(LEO, fl, amount=0, cuotas=1)]), 'Medio o importe inválido')
    reject('normal obligación cero por DML', f"INSERT INTO compras_gastos(id,tipo,proveedor_id,fecha,moneda,actor_id) VALUES ('{uid(2190)}','GASTO','{SUPPLIER}','2026-09-01','ARS','{ACTOR}'); INSERT INTO items_compras_gastos(compra_gasto_id,posicion,descripcion,cantidad,costo_unitario) VALUES ('{uid(2190)}',1,'fixture',1,100); INSERT INTO financiaciones_compras(compra_id,actor_id) VALUES ('{uid(2190)}','{ACTOR}'); INSERT INTO tramos_pago_compras(id,compra_id,posicion,medio,importe,tarjeta_id,cantidad_cuotas) VALUES ('{uid(2191)}','{uid(2190)}',1,'TARJETA_CREDITO',100,'{LEO}',1); INSERT INTO obligaciones_tarjetas(compra_id,tramo_id,tarjeta_id,numero_cuota,cantidad_cuotas,importe) VALUES ('{uid(2190)}','{uid(2191)}','{LEO}',1,1,0)", 'check constraint', raw=True)
    reject('normal no admite evidencia ni por owner DML', f"INSERT INTO evidencias_financiacion_historica_compras SELECT (jsonb_populate_record(NULL::evidencias_financiacion_historica_compras,to_jsonb(e)||jsonb_build_object('compra_id','{PRINTER}'))).* FROM evidencias_financiacion_historica_compras e WHERE compra_id='{hp}'", 'solo permitida', raw=True)
    reject('normal no acepta estrategia/evidencia en payload', normal(2102, tramos=[credit(LEO, fl)|{'estrategia_distribucion':'HISTORICA_SHEETS'}]), 'Campos de tramo inválidos')
    reject('estrategia normal confirmada inmutable', f"UPDATE tramos_pago_compras SET estrategia_distribucion='HISTORICA_SHEETS',valor_cuota_historico=114499.67 WHERE id='{TRAMO}'", 'inmutable', raw=True)
    check('pagos/aplicaciones siguen vacíos', 'SELECT NOT EXISTS(SELECT 1 FROM pagos_resumenes_tarjetas) AND NOT EXISTS(SELECT 1 FROM aplicaciones_pagos_obligaciones)')
    reject('corte cero rechazado', rpc('registrar_corte_historico_obligacion_admin', uid(2103), OBLIGATION, 'fixture', '2026-10-14', 0), 'Corte inválido')
    reject('corte fuera de primeras N rechazado', rpc('registrar_corte_historico_obligacion_admin', uid(2104), json.loads(obligations(hp))[1]['id'], 'fixture', '2026-10-14', 33.33), 'primeras cuotas históricas')

    debit_q = hist(2110, 'HG-2110', e=None, tramos=[immediate(100)])
    debit = result(debit_q)
    assert result(debit_q) == debit
    check('débito histórico conserva medio/fecha y ninguna obligación', f"SELECT medio='TARJETA_DEBITO' AND fecha_pago='2026-09-01' AND tarjeta_id IS NULL AND estrategia_distribucion='NORMAL' AND NOT EXISTS(SELECT 1 FROM obligaciones_tarjetas WHERE compra_id='{debit['compra_id']}') FROM tramos_pago_compras WHERE compra_id='{debit['compra_id']}'")
    reject('débito histórico fecha incorrecta', hist(2111, 'HG-2111', e=None, tramos=[immediate(100, date='2026-09-02')]), 'Débito histórico')
    reject('débito no puede adjuntar evidencia de crédito', hist(2111, 'HG-2111', e=e, tramos=[immediate(100)]), 'Tramo no corresponde')

    # Concurrencia con bloqueo real, incluyendo el caso documental ya existente.
    contend(hist(2200, 'HG-2200', e=e), hist(2201, 'HG-2200', e=e))
    mark('concurrencia HG nuevo mismo payload con evidencia / bloqueo observado')
    contend(hist(2202, 'HG-2202', e=e), hist(2203, 'HG-2202', e=e|{'estado_original':'Otro'}), False)
    mark('concurrencia HG nuevo payload distinto / uno rechazado')
    contend(zq, zq)
    mark('concurrencia retry HG-0043 / resultado idéntico')
    contend(zq, hist(2204, 'HG-0043', total=0, e=ze|{'estado_original':'Otro'}, tipo='GASTO', date='2026-09-25'), False)
    mark('concurrencia HG-0043 payload diferente / rechazado')

    for phase, table in [('evidencia','evidencias_financiacion_historica_compras'),('financiacion','financiaciones_compras'),('auditoria','operaciones_financieras_compras')]:
        condition = "IF NEW.accion='IMPORTACION_COMPRA_HISTORICA' THEN RAISE EXCEPTION 'fallo fixture'; END IF;" if phase == 'auditoria' else "RAISE EXCEPTION 'fallo fixture';"
        sql(f"CREATE FUNCTION fail_final_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN {condition} RETURN NEW; END $$; CREATE TRIGGER fail_final_fixture BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION fail_final_fixture();")
        reject('atomicidad fallo '+phase, hist(2300, 'HG-2300', e=e), 'fallo fixture')
        sql(f'DROP TRIGGER fail_final_fixture ON {table}; DROP FUNCTION fail_final_fixture()')
    sql("CREATE FUNCTION fail_deferred_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo COMMIT fixture'; END $$; CREATE CONSTRAINT TRIGGER fail_deferred_fixture AFTER INSERT ON evidencias_financiacion_historica_compras DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_deferred_fixture();")
    reject('atomicidad fallo COMMIT', hist(2301, 'HG-2301', e=e), 'fallo COMMIT fixture')
    sql('DROP TRIGGER fail_deferred_fixture ON evidencias_financiacion_historica_compras; DROP FUNCTION fail_deferred_fixture()')

    witness = uid(2400)
    seed_partial(witness, uid(2401), LEO, fl)
    witness_before = obligations(witness)
    # Solo 11 casos de prueba aislados. Nunca se carga el lote de 60 compras.
    source = json.loads((ROOT/'scripts/fixtures/compras-historicas-manifiesto.json').read_text())['compras']
    affected = {'HG-0004','HG-0007','HG-0014','HG-0015','HG-0019','HG-0020','HG-0030','HG-0031','HG-0032','HG-0037','HG-0041'}
    from decimal import Decimal
    def num(s): return float(Decimal(s))
    for n, row in enumerate([x for x in source if x['id_origen'] in affected], 2500):
        card = LEO if row['tarjeta_canonica']=='Visa Leo Santander' else FACU
        fp = sql(f"SELECT id FROM periodos_tarjetas WHERE tarjeta_id='{card}' AND fecha_cierre='{row['cierre_tarjeta']}' AND fecha_vencimiento='{row['primer_vencimiento']}'").stdout.strip()
        ev = evidence(card, fp, num(row['valor_cuota_historico']), row['cuotas'], row['pagadas_historicas'], row['pendientes_historicas'], num(row['saldo_historico']))
        h = result(hist(n, row['id_origen'], num(row['total_historico']), ev, date=row['fecha'], tipo=row['tipo']))
        hid = h['compra_id']
        check(row['id_origen']+' suma obligaciones exacta', f"SELECT sum(importe)={row['total_historico']} FROM obligaciones_tarjetas WHERE compra_id='{hid}'")
        for ob in json.loads(obligations(hid))[:row['pagadas_historicas']]:
            result(rpc('registrar_corte_historico_obligacion_admin', uid(10000+n*10+ob['numero_cuota']), ob['id'], 'FIXTURE '+row['id_origen'], '2026-10-14', ob['importe']))
        balance = result(rpc('obtener_detalle_financiacion_compra_admin', hid))
        assert Decimal(str(balance['saldo_operativo'])) == Decimal(row['saldo_historico'])
        assert balance['total_pagado']==0 and all(o['total_aplicado']==0 for o in balance['cuotas'])
        assert Decimal(str(balance['total_corte_historico'])) == Decimal(row['valor_cuota_historico'])*row['pagadas_historicas']
        mark(row['id_origen']+' saldo/cortes exactos, ningún pago/aplicación')
        assert obligations(PRINTER)==printer_obligations and obligations(witness)==witness_before
    mark('impresora y testigo misma tarjeta intactos después de 11 importaciones con cortes locales')
    result(normal(2700, tramos=[credit(LEO, fl)]))
    check('normal conserva distribución anterior', "SELECT array_agg(o.importe ORDER BY o.numero_cuota)=ARRAY[33.34,33.33,33.33]::numeric[] FROM obligaciones_tarjetas o JOIN operaciones_financieras_compras op ON op.resultado->>'compra_id'=o.compra_id::text WHERE op.operacion_id='"+uid(2700)+"'")
    check('normal conserva asignador amplio', f"SELECT count(*)=2 FROM obligaciones_tarjetas WHERE compra_id='{witness}' AND periodo_id IS NOT NULL")
    assert obligations(PRINTER)==printer_obligations
    assert sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY tarjeta_id,orden) FROM periodos_tarjetas p').stdout==periods_before
    mark('seis períodos intactos columna por columna')
    assert existing_facts()==printer_before
    assert result(rpc('obtener_compra_gasto_admin', normal_before['compra_id']))==second_before
    mark('dos compras existentes preservadas al final columna por columna')
    check('exactamente seis períodos sin nuevos pagos/aplicaciones', 'SELECT (SELECT count(*) FROM periodos_tarjetas)=6 AND NOT EXISTS(SELECT 1 FROM pagos_resumenes_tarjetas) AND NOT EXISTS(SELECT 1 FROM aplicaciones_pagos_obligaciones)')
    # Controles del lote completo exclusivamente en memoria, nunca INSERT/RPC.
    cr = [r for r in source if r['medio']=='TARJETA_CREDITO']
    counts = dict(compras=len(source), cuotas_fuente=0, obligaciones=0, documental=0, cortes=0, pendientes_fuente=0, pendientes_monetarios=0, pendiente_documental=0)
    total_cost=Decimal(0); total_cut=Decimal(0); total_balance=Decimal(0)
    for row in cr:
        c=Decimal(row['total_historico']); v=Decimal(row['valor_cuota_historico']); qn=row['cuotas']; paid=row['pagadas_historicas']; pending=row['pendientes_historicas']
        counts['cuotas_fuente']+=qn; counts['cortes']+=paid; counts['pendientes_fuente']+=pending
        if c==0:
            assert row['id_origen']=='HG-0043' and qn==1 and paid==0 and pending==1
            counts['documental']+=1; counts['pendiente_documental']+=1
            continue
        dist=[v]*(qn-1)+[c-v*(qn-1)]
        assert all(x>0 and x==x.quantize(Decimal('.01')) for x in dist)
        assert sum(dist)==c and sum(dist[:paid])==v*paid and sum(dist[paid:])==Decimal(row['saldo_historico'])
        counts['obligaciones']+=len(dist); counts['pendientes_monetarios']+=len(dist[paid:])
        total_cost+=sum(dist); total_cut+=sum(dist[:paid]); total_balance+=sum(dist[paid:])
    assert counts==dict(compras=60, cuotas_fuente=281, obligaciones=280, documental=1, cortes=54, pendientes_fuente=227, pendientes_monetarios=226, pendiente_documental=1)
    assert total_cost==Decimal('16958476.43') and total_cut==Decimal('2698846.22') and total_balance==Decimal('14259630.21')
    mark('58 créditos aritméticos: total, cortes y saldo exactos; 57 positivos + 1 documental')
    print('CONTROLES LOTE (solo memoria):',counts,'saldo',total_balance,flush=True)
    print(f'PASS: {passed} checks; PostgreSQL aislado + aritmética; ningún lote cargado',flush=True)
    print('SHA-256:',hashlib.sha256(NEW.read_bytes()).hexdigest(),flush=True)

finally:
    if started:
        r = run([str(BIN/'pg_ctl'), '-D', str(DATA), '-m', 'fast', '-w', 'stop'])
        assert r.returncode == 0, r.stderr
