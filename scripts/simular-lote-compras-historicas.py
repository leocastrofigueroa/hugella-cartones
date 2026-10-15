"""SIMULACIÓN LOCAL SOLAMENTE: sin URL/credenciales remotas ni SQL productivo.

Crea PostgreSQL temporal sin TCP. Solo fixtures base usan DML directo. Las 60
compras y 54 cortes pasan por las RPC reales, como authenticated/admin, en una
transacción global READ COMMITTED. Auditoría SELECT como owner local. Repite el
lote y comprueba ausencia de cualquier cambio. El manifiesto es solo lectura.
"""
import ast
from pathlib import Path

_previous_path = Path(__file__).with_name('test-importacion-compras-historicas.py')
_previous = ast.parse(_previous_path.read_text())
_setup_try = _previous.body[-1]
assert isinstance(_setup_try, ast.Try)
_setup_stop = next(i for i, n in enumerate(_setup_try.body) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'before' for t in n.targets))
# Solo helpers y bootstrap original; no ejecuta la suite anterior ni sus cargas.
exec(compile(ast.Module(body=_previous.body[:-1], type_ignores=[]), str(_previous_path), 'exec'))
import uuid
from decimal import Decimal

MANIFEST = ROOT/'scripts/fixtures/compras-historicas-manifiesto.json'
FINAL = ROOT/'supabase/migrations/202610140004_financiacion_historica_sheets.sql'
REPORT = ROOT/'scripts/fixtures/compras-historicas-simulacion-final.json'
PROVIDERS = {
    'Easy': ('878bc732-5988-4764-aa4f-ec1d9511c553', 'Easy'),
    'Fravega': ('4c852785-2964-4ad2-9de6-cb43089ef4b6', 'Fravega'),
    'Genérico': ('f3fc8ad2-f733-43aa-8ddb-62fc95db795e', 'Genérico'),
    'Luciana Hogar': ('3ead5802-bb15-4c0b-951c-2eb82ba45a0e', 'Luciana Hogar'),
    'Mercadolibre': ('6c4cb2b8-d47b-451c-b572-a2cb1f1a7ce1', 'Mercadolibre'),
    'Metalpplex': ('7f4514f1-d5d9-4e17-9a5d-4bb39a7cc8d9', 'Metalpplex'),
    'NIC Argentina': ('58c30774-4317-4956-ab3d-09f26f0215c2', 'Nic Argentina'),
    'Novo Hogar': ('ee6bb6d0-418c-4d7a-a87d-a9ab65cea4c4', 'Novo Hogar'),
    'On City': ('302ddcbb-8628-441a-8f1b-4f6091799315', 'On City'),
    'Salamone': ('46ece73b-c01c-40fd-b575-1081ec3d8d5e', 'Salamone'),
}
CARDS = {'Visa Facu Santander': FACU, 'Visa Leo Santander': LEO}
PERIODS = [
    (FACU, 1, '09f0a7d5-032f-432c-a709-b224c3e4de02', '2026-07-23', '2026-08-03'),
    (FACU, 2, 'dcb37669-3afe-46d8-994f-22f67f0966e7', '2026-08-20', '2026-09-01'),
    (FACU, 3, 'f18afdb8-8b91-49e2-8dcf-579954f56f9b', '2026-09-24', '2026-10-05'),
    (FACU, 4, '6b3b707f-8e1f-4dac-9f08-9cb98efc9fb6', '2026-10-22', '2026-11-02'),
    (LEO, 1, 'a213ec7f-53f2-424f-ba4b-d2b949f7c14b', '2026-09-24', '2026-10-05'),
    (LEO, 2, '5d5a4689-416e-451b-add1-ec71fd3eea36', '2026-10-22', '2026-11-02'),
]
SUPPLIER = PROVIDERS['Mercadolibre'][0]
TABLES.append('evidencias_financiacion_historica_compras')
manifest_bytes = MANIFEST.read_bytes()
manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
input_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'supabase/migrations').glob('*.sql')}
source = json.loads(manifest_bytes)['compras']
assert len(source) == 60 and {x['id_origen'] for x in source} == {f'HG-{i:04d}' for i in range(1, 62) if i != 2}
assert len({x['id_origen'] for x in source}) == 60


def exact_json(value):
    """Serialización JSON NUMERIC exacta; nunca convierte importes a float."""
    if isinstance(value, Decimal):
        assert value.is_finite()
        return format(value, 'f')
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False)+':'+exact_json(v) for k, v in value.items()) + '}'
    if isinstance(value, (list, tuple)):
        return '[' + ','.join(exact_json(v) for v in value) + ']'
    return json.dumps(value, ensure_ascii=False)


def operation_id(domain, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'hugella:simulacion-final:v1:'+manifest_sha+':'+domain+':'+key))


class LocalTransaction:
    def __init__(self):
        self.error_path = BASE/'batch-stderr.log'
        self.stderr = self.error_path.open('w')
        self.proc = subprocess.Popen(ARGS, env=ENV, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr)
        self.serial = 0
        self.query('BEGIN ISOLATION LEVEL READ COMMITTED; '+f"SET LOCAL test.uid='{ACTOR}';")

    def query(self, statement, rpc_call=False):
        self.serial += 1
        marker = f'LOCAL_SIMULATION_RESULT_{self.serial}'
        # Las escrituras son RPC reales bajo rol authenticated. Owner solo SELECT/SET.
        role = 'SET LOCAL ROLE authenticated;' if rpc_call else 'RESET ROLE;'
        self.proc.stdin.write(role+'\n'+statement+';\n\\echo '+marker+'\n')
        self.proc.stdin.flush()
        lines = []
        for line in self.proc.stdout:
            if line.rstrip('\n') == marker:
                return '\n'.join(lines).strip()
            lines.append(line.rstrip('\n'))
        self.stderr.flush()
        raise RuntimeError(self.error_path.read_text())

    def get(self, query):
        return json.loads(self.query(query), parse_float=Decimal)

    def rpc(self, query):
        return json.loads(self.query('SELECT '+query, rpc_call=True), parse_float=Decimal)

    def finish(self, commit):
        if self.proc.poll() is None:
            self.query('COMMIT' if commit else 'ROLLBACK')
            self.proc.stdin.write('\\q\n')
            self.proc.stdin.flush()
        self.proc.communicate(timeout=30)
        self.stderr.close()
        assert self.proc.returncode == 0, self.error_path.read_text()


PAYLOADS = {}
for row in source:
    assert row['proveedor_canonico'] in PROVIDERS
    hg = row['id_origen']
    amount = Decimal(row['total_historico'])
    ev = None
    tramos = []
    if row['medio'] == 'TARJETA_CREDITO':
        card = CARDS[row['tarjeta_canonica']]
        matches = [p for p in PERIODS if p[0] == card and p[3] == row['cierre_tarjeta'] and p[4] == row['primer_vencimiento']]
        assert len(matches) == 1, hg
        period = matches[0]
        documentary = hg == 'HG-0043'
        assert documentary == (amount == 0)
        ev = dict(tarjeta_original=row['evidencia_csv']['valores_originales']['Tarjeta'], tarjeta_canonica=row['tarjeta_canonica'],
                  tarjeta_id=card, periodo_inicial_id=period[2], cuotas_fuente=row['cuotas'],
                  valor_cuota_historico=Decimal(row['valor_cuota_historico']), pagadas_historicas=row['pagadas_historicas'],
                  pendientes_historicas=row['pendientes_historicas'], saldo_historico=Decimal(row['saldo_historico']),
                  estado_original=row['estado_historico'], cierre_original=row['cierre_tarjeta'], vencimiento_original=row['primer_vencimiento'],
                  tratamiento='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' if documentary else 'FINANCIACION_HISTORICA_OPERATIVA')
        if not documentary:
            tramos = [dict(posicion=1, medio='TARJETA_CREDITO', importe=amount, tarjeta_id=card, cantidad_cuotas=row['cuotas'], primer_periodo_id=period[2])]
    else:
        assert row['medio'] == 'TARJETA_DEBITO' and row['fecha_pago'] == row['fecha']
        tramos = [dict(posicion=1, medio='TARJETA_DEBITO', importe=amount, fecha_pago=row['fecha'])]
    PAYLOADS[hg] = rpc('importar_compra_historica_admin', operation_id('compra', hg), hg, row['tipo'],
                       PROVIDERS[row['proveedor_canonico']][0], row['fecha'], row['moneda'], None, None,
                       row['descripcion'], amount, exact_json(tramos), exact_json(ev) if ev else None)


# El lote global debe prebloquear TODAS las identidades antes del primer lock
# financiero global. Evita invertir el orden al llamar una segunda RPC dentro
# de la misma transacción o ante otro reintento concurrente del lote.
IDENTITY_KEYS = set()
for row in source:
    hg = row['id_origen']
    op = operation_id('compra', hg)
    compra_child = str(uuid.UUID(hashlib.md5(('hugella:compra-historica:compra:v1:'+op).encode()).hexdigest()))
    fin_child = str(uuid.UUID(hashlib.md5(('hugella:compra-historica:financiacion:v1:'+op).encode()).hexdigest()))
    IDENTITY_KEYS.update(['hugella:historico:GOOGLE_SHEETS_COMPRAS:'+hg,
                          'hugella:finanzas:operacion:'+op,
                          'hugella:finanzas:operacion:'+fin_child,
                          'hugella:compra:operacion:'+compra_child])
    if row['medio']=='TARJETA_CREDITO':
        for n in range(1,row['pagadas_historicas']+1):
            IDENTITY_KEYS.add('hugella:finanzas:operacion:'+operation_id('corte',hg+':'+str(n)))
assert len(IDENTITY_KEYS)==294


def prelock_batch(tx):
    keys=','.join(lit(x) for x in sorted(IDENTITY_KEYS))
    tx.query("DO $local_locks$ DECLARE k bigint; BEGIN FOR k IN SELECT DISTINCT pg_catalog.hashtextextended(v,0) FROM unnest(ARRAY["+keys+"]) v ORDER BY 1 LOOP PERFORM pg_catalog.pg_advisory_xact_lock(k); END LOOP; END $local_locks$",rpc_call=True)


def protected_snapshot():
    return sql(f"""SELECT jsonb_build_object(
    'compras',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM compras_gastos c WHERE fuente IS NULL),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM items_compras_gastos i JOIN compras_gastos c ON c.id=i.compra_gasto_id WHERE c.fuente IS NULL),
    'financiaciones',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.compra_id) FROM financiaciones_compras f JOIN compras_gastos c ON c.id=f.compra_id WHERE c.fuente IS NULL),
    'tramos',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM tramos_pago_compras t JOIN compras_gastos c ON c.id=t.compra_id WHERE c.fuente IS NULL),
    'obligaciones',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM obligaciones_tarjetas o JOIN compras_gastos c ON c.id=o.compra_id WHERE c.fuente IS NULL),
    'inicios',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.tramo_id) FROM inicios_tramos_tarjeta i JOIN tramos_pago_compras t ON t.id=i.tramo_id JOIN compras_gastos c ON c.id=t.compra_id WHERE c.fuente IS NULL),
    'anulaciones',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.compra_gasto_id) FROM anulaciones_compras_gastos a),
    'periodos',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tarjeta_id,orden) FROM periodos_tarjetas p),
    'tarjetas',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tarjetas_credito t),
    'proveedores',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM proveedores p))""").stdout


def audit_batch(tx):
    facts = tx.get("""SELECT jsonb_build_object(
    'compras',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id_origen) FROM compras_gastos c WHERE fuente='GOOGLE_SHEETS_COMPRAS'),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM items_compras_gastos i JOIN compras_gastos c ON c.id=i.compra_gasto_id WHERE c.fuente='GOOGLE_SHEETS_COMPRAS'),
    'evidencias',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.compra_id) FROM evidencias_financiacion_historica_compras e),
    'tramos',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM tramos_pago_compras t JOIN compras_gastos c ON c.id=t.compra_id WHERE c.fuente='GOOGLE_SHEETS_COMPRAS'),
    'obligaciones',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM obligaciones_tarjetas o JOIN compras_gastos c ON c.id=o.compra_id WHERE c.fuente='GOOGLE_SHEETS_COMPRAS'),
    'cortes',(SELECT coalesce(jsonb_agg(to_jsonb(ch) ORDER BY ch.obligacion_id),'[]') FROM cortes_historicos_obligaciones_tarjeta ch),
    'pagos',(SELECT count(*) FROM pagos_resumenes_tarjetas),
    'aplicaciones',(SELECT count(*) FROM aplicaciones_pagos_obligaciones),
    'periodos',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tarjeta_id,orden) FROM periodos_tarjetas p))""")
    purchases = facts['compras']; obs = facts['obligaciones']; cuts = facts['cortes']; items = facts['items']
    assert len(purchases) == 60 and len({x['id_origen'] for x in purchases}) == 60
    assert not any(x['id_origen'] == 'HG-0002' for x in purchases)
    assert sum(x['total'] for x in items) == Decimal('17186976.43')
    assert sum(x['tipo'] == 'MERCADERIA' for x in purchases) == 57 and sum(x['tipo'] == 'GASTO' for x in purchases) == 3
    assert all(x['modalidad']=='TOTAL_HISTORICO' and x['cantidad'] is None and x['costo_unitario'] is None for x in items)
    assert len(obs) == 280 and len(cuts) == 54 and facts['pagos']==0 and facts['aplicaciones']==0
    assert len(facts['periodos'])==6 and {x['id'] for x in facts['periodos']}=={p[2] for p in PERIODS}
    assert sum(x['cuotas_fuente'] for x in facts['evidencias'])==281
    assert sum(x['pendientes_historicas'] for x in facts['evidencias'])==227
    cuts_by_id = {x['obligacion_id']: x for x in cuts}
    by_hg = {x['id_origen']:x for x in purchases}
    summary = []
    detail = []
    assigned, unassigned = 0, []
    for row in source:
        hg = row['id_origen']; c = by_hg[hg]
        assert c['proveedor_id']==PROVIDERS[row['proveedor_canonico']][0] and c['fecha']==row['fecha'] and c['tipo']==row['tipo']
        ob = sorted((o for o in obs if o['compra_id']==c['id']), key=lambda o:o['numero_cuota'])
        tranche = [t for t in facts['tramos'] if t['compra_id']==c['id']]
        evidence = [e for e in facts['evidencias'] if e['compra_id']==c['id']]
        finance = tx.rpc(rpc('obtener_detalle_financiacion_compra_admin', c['id']))
        total = Decimal(row['total_historico']); v=Decimal(row['valor_cuota_historico']); n=row['pagadas_historicas']
        if hg=='HG-0043':
            assert not ob and not tranche and len(evidence)==1
            assert evidence[0]['cuotas_fuente']==1 and evidence[0]['pendientes_historicas']==1
            assert finance['estado']=='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO' and finance['saldo_operativo']==0
        elif row['medio']=='TARJETA_CREDITO':
            assert len(ob)==row['cuotas'] and len(tranche)==1 and len(evidence)==1
            assert tranche[0]['estrategia_distribucion']=='HISTORICA_SHEETS'
            expected=[v]*(row['cuotas']-1)+[total-v*(row['cuotas']-1)]
            assert [x['importe'] for x in ob]==expected and sum(expected)==total
            assert {x['numero_cuota'] for x in ob if x['id'] in cuts_by_id}==set(range(1,n+1))
            assert sum((cuts_by_id[x['id']]['importe'] for x in ob if x['id'] in cuts_by_id),Decimal(0))==v*n
            assert finance['saldo_operativo']==Decimal(row['saldo_historico']) and finance['total_pagado']==0
            assert all(o['total_aplicado']==0 for o in finance['cuotas'])
            first=row['periodo_inicial_esperado']; card=CARDS[row['tarjeta_canonica']]
            for o in ob:
                expected_order=first['orden']+o['numero_cuota']-1
                matches=[p for p in PERIODS if p[0]==card and p[1]==expected_order]
                if matches:
                    assert o['periodo_id']==matches[0][2],(hg,o['numero_cuota'])
                    assigned+=1
                else:
                    assert o['periodo_id'] is None and expected_order>max(p[1] for p in PERIODS if p[0]==card)
                    unassigned.append(dict(id_origen=hg,numero_cuota=o['numero_cuota'],orden_requerido=expected_order,tarjeta=row['tarjeta_canonica']))
        else:
            assert not ob and not evidence and len(tranche)==1
            assert tranche[0]['medio']=='TARJETA_DEBITO' and tranche[0]['fecha_pago']==row['fecha'] and tranche[0]['importe']==total
            assert finance['saldo_operativo']==0 and finance['total_pagado']==total
        detail.append(dict(id_origen=hg,compra_id=c['id'],saldo_operativo=finance['saldo_operativo'],obligaciones=len(ob),cortes=sum(o['id'] in cuts_by_id for o in ob)))
    for name in ['Visa Facu Santander','Visa Leo Santander','TARJETA_DEBITO']:
        group=[r for r in source if (r['tarjeta_canonica'] or r['medio'])==name]
        ids={by_hg[r['id_origen']]['id'] for r in group}
        group_ob=[x for x in obs if x['compra_id'] in ids]
        group_cut=[x for x in cuts if x['obligacion_id'] in {o['id'] for o in group_ob}]
        group_ev=[x for x in facts['evidencias'] if x['compra_id'] in ids]
        summary.append(dict(medio_o_tarjeta=name,compras=len(group),total_historico=sum((Decimal(r['total_historico']) for r in group),Decimal(0)),
                            cuotas_fuente=sum(x['cuotas_fuente'] for x in group_ev),obligaciones_monetarias=len(group_ob),
                            cuotas_documentales=sum(x['cuotas_fuente'] for x in group_ev if x['tratamiento']=='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'),
                            cortes=len(group_cut),pendientes_fuente=sum(x['pendientes_historicas'] for x in group_ev),
                            pendientes_monetarios=len(group_ob)-len(group_cut),
                            pendientes_documentales=sum(x['pendientes_historicas'] for x in group_ev if x['tratamiento']=='FINANCIACION_HISTORICA_SIN_IMPORTE_OPERATIVO'),
                            saldo_monetario_pendiente=sum((x['importe'] for x in group_ob),Decimal(0))-sum((x['importe'] for x in group_cut),Decimal(0))))
    f,l,d=summary
    assert (f['compras'],f['obligaciones_monetarias'],f['cortes'],f['pendientes_monetarios'],f['saldo_monetario_pendiente'])==(19,98,34,64,Decimal('2275912.87'))
    assert (l['compras'],l['cuotas_fuente'],l['obligaciones_monetarias'],l['cuotas_documentales'],l['cortes'],l['pendientes_monetarios'],l['pendientes_documentales'],l['pendientes_fuente'],l['saldo_monetario_pendiente'])==(39,183,182,1,20,162,1,163,Decimal('11983717.34'))
    assert d['compras']==2 and d['total_historico']==Decimal('228500.00') and d['obligaciones_monetarias']==d['cortes']==0
    assert f['saldo_monetario_pendiente']+l['saldo_monetario_pendiente']==Decimal('14259630.21')
    return dict(compras=60,hg_unicos=60,hg_0002_ausente=True,total_historico=Decimal('17186976.43'),mercaderia=57,gasto=3,
                cuotas_fuente=281,obligaciones_monetarias=280,cuota_cero_documental=1,cortes=54,pendientes_fuente=227,
                pendientes_monetarios=226,pendiente_cero_documental=1,saldo_monetario_pendiente=Decimal('14259630.21'),
                pagos_nuevos=0,aplicaciones_nuevas=0,periodos=6,obligaciones_asignadas=assigned,obligaciones_periodo_null=len(unassigned),
                conciliacion_por_medio=summary,compras_detalle=detail,obligaciones_sin_periodo=unassigned)


REPORT_DATA = dict(estado='FAIL',sha256_manifiesto=manifest_sha,sha256_140004=hashlib.sha256(FINAL.read_bytes()).hexdigest(),
                   alcance='Simulación exclusivamente local, sin conexión a producción.',hg_problematico=None)
started=False
try:
    exec(compile(ast.Module(body=_setup_try.body[:_setup_stop],type_ignores=[]),str(_previous_path),'exec'))
    # Fixture base: referencias exactas suministradas por el usuario.
    for canonical,(supplier_id,real_name) in PROVIDERS.items():
        if supplier_id==SUPPLIER:
            sql(f"UPDATE proveedores SET nombre={lit(real_name)} WHERE id='{supplier_id}'")
        else:
            sql(f"INSERT INTO proveedores(id,nombre,actor_id) VALUES ('{supplier_id}',{lit(real_name)},'{ACTOR}')")
    for card,order,pid,close,due in PERIODS:
        # El backfill original crea UUID nuevos para los cinco períodos no usados.
        # Se sustituyen SOLO durante preparación del fixture, antes de importar.
        sql(f"UPDATE periodos_tarjetas SET id='{pid}' WHERE tarjeta_id='{card}' AND orden={order} AND id<>'{pid}'")
        check('referencia real período '+str(order)+' '+card, f"SELECT id='{pid}' AND fecha_cierre='{close}' AND fecha_vencimiento='{due}' FROM periodos_tarjetas WHERE tarjeta_id='{card}' AND orden={order}")
    sql(MIGRATION.read_text())
    sql(FINAL.read_text())
    technical_id=normal_before['compra_id']
    result(rpc('anular_compra_gasto_admin',operation_id('fixture','anulacion-tecnica'),technical_id,'PRUEBA TÉCNICA / FIXTURE LOCAL'))
    protected_before=protected_snapshot()
    baseline=snapshot()
    REPORT_DATA['fixtures_existentes']=dict(impresora_id=PRINTER,obligacion_impresora_1=OBLIGATION,
                                           compra_tecnica_anulada_id=technical_id,
                                           nota='La compra técnica usa el fixture representativo previo; su UUID productivo no fue suministrado. No se consultó producción.')
    passes=[]
    first_map=None
    all_cut_checks=[]
    for iteration in (0,1,2):
        tx=LocalTransaction()
        prelock_batch(tx)
        current_hg=None
        try:
            mapping={}
            for row in source:
                current_hg=row['id_origen']
                response=tx.rpc(PAYLOADS[current_hg])
                assert response['id_origen']==current_hg
                mapping[current_hg]=response['compra_id']
            tx.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
            assert tx.get("SELECT count(*) FROM compras_gastos WHERE fuente='GOOGLE_SHEETS_COMPRAS'")==60
            print(f'PASS ejecución {iteration}: 60 RPC de compra completas antes de cortes',flush=True)
            cut_checks=[]
            for row in source:
                current_hg=row['id_origen']
                if row['medio']!='TARJETA_CREDITO' or row['pagadas_historicas']==0:
                    continue
                for number in range(1,row['pagadas_historicas']+1):
                    o=tx.get(f"SELECT to_jsonb(o)||jsonb_build_object('hg',c.id_origen,'aplicaciones',(SELECT count(*) FROM aplicaciones_pagos_obligaciones a WHERE a.obligacion_id=o.id)) FROM obligaciones_tarjetas o JOIN compras_gastos c ON c.id=o.compra_id WHERE c.id='{mapping[current_hg]}' AND o.numero_cuota={number}")
                    assert o['hg']==current_hg and o['compra_id']==mapping[current_hg] and o['numero_cuota']==number
                    assert o['periodo_id'] is not None,(current_hg,number,'No existe período real para cuota histórica pagada')
                    assert o['importe']==Decimal(row['valor_cuota_historico']) and o['aplicaciones']==0
                    response=tx.rpc(rpc('registrar_corte_historico_obligacion_admin',operation_id('corte',current_hg+':'+str(number)),
                                       o['id'],current_hg+' cuota '+str(number)+' / fuente GOOGLE_SHEETS_COMPRAS','2026-10-14',o['importe']))
                    assert response['obligacion_id']==o['id'] and response['importe']==o['importe']
                    cut_checks.append(dict(id_origen=current_hg,compra_id=o['compra_id'],obligacion_id=o['id'],numero_cuota=number,
                                           periodo_id=o['periodo_id'],importe=o['importe'],aplicaciones_reales=0,estado=response['estado']))
            assert len(cut_checks)==54
            tx.query('SET CONSTRAINTS ALL IMMEDIATE')
            verified=audit_batch(tx)
            if iteration==0:
                try:
                    tx.query('SELECT 1/0')
                except RuntimeError as expected_failure:
                    assert 'division by zero' in str(expected_failure)
                else:
                    raise AssertionError('No falló el ensayo de rollback')
                tx.proc.wait(timeout=30)
                tx.stderr.close()
                assert snapshot()==baseline and protected_snapshot()==protected_before
                REPORT_DATA['rollback_global_probado']=dict(compras_revertidas=60,cortes_revertidos=54,estado_base_identico=True)
                print('PASS atomicidad global: fallo tardío revierte 60 compras y 54 cortes; base idéntica',flush=True)
                continue
            assert first_map is None or mapping==first_map
            if first_map is None:
                first_map=mapping
            tx.finish(True)
            assert protected_snapshot()==protected_before
            passes.append(verified)
            if iteration==1:
                after_first=snapshot()
                all_cut_checks=cut_checks
            else:
                assert snapshot()==after_first,'Segunda ejecución modificó filas'
                assert verified==passes[0]
            print(f'PASS ejecución {iteration}: 54 cortes, controles exactos, preservación y COMMIT',flush=True)
        except Exception:
            REPORT_DATA['hg_problematico']=current_hg
            if tx.proc.poll() is None:
                tx.finish(False)
            else:
                tx.stderr.close()
            raise
    REPORT_DATA.update(estado='PASS',ejecuciones=2,controles=passes[0],cortes_verificados=all_cut_checks,
                       idempotencia=dict(compras_nuevas_segunda=0,obligaciones_nuevas_segunda=0,cortes_nuevos_segunda=0,
                                        mismos_uuid_por_hg=True,mismos_saldos=True,todas_las_filas_identicas=True),
                       preservacion=dict(impresora=True,tres_obligaciones_impresora=True,tecnica_anulada=True,periodos=True,tarjetas=True,proveedores=True),
                       referencia_nic=dict(nombre_manifiesto='NIC Argentina',nombre_fixture='Nic Argentina',uuid=PROVIDERS['NIC Argentina'][0]),
                       identidades_prebloqueadas=294,ejecucion='Una transacción global READ COMMITTED por pasada: prelocks ordenados, 60 compras, validación diferida, 54 cortes, controles y COMMIT.',
                       explicacion_null='Cada NULL requiere un orden mayor al último período real de esa tarjeta. No hay huecos dentro de los seis períodos ni cuotas cortadas sin período.',
                       produccion_conectada=False,sql_productivo_generado=False,manifiesto_modificado=False)
    assert MANIFEST.read_bytes()==manifest_bytes
    assert input_hashes=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'supabase/migrations').glob('*.sql')}
except Exception as exc:
    REPORT_DATA['error']=str(exc)
    raise
finally:
    if started:
        stopped=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
        assert stopped.returncode==0,stopped.stderr
    REPORT.write_text(exact_json(REPORT_DATA)+'\n')
    print('REPORTE:',REPORT,flush=True)
    if REPORT_DATA['estado']=='PASS':
        compact={k:v for k,v in REPORT_DATA['controles'].items() if k not in ('compras_detalle','obligaciones_sin_periodo')}
        print(exact_json(compact),flush=True)
        print('PASS GLOBAL: lote completo e idempotencia, solo PostgreSQL temporal',flush=True)
