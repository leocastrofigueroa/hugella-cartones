"""Reejecuta las suites RPC existentes contra el esquema final, sin editarlas.

Los checks de instalación originales corren contra su baseline original. Antes
de las pruebas de comportamiento se instalan las migraciones restantes, cortes
e importación. Los marcadores exactos fallan cerrado si cambia una suite.
Sus fechas sintéticas son fixtures de regresión; el escenario histórico de los
seis períodos reales se prueba en test-importacion-compras-historicas.py.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SUITES = {
    'compras': ('test-compras-gastos-rpc.py', "    supplier_result=json.loads(success('admin supplier creation'", [
        '202610100001_comprobantes_compras_gastos.sql',
        '202610110001_financiacion_compras_base.sql',
        '202610110002_financiacion_compras_rpc_admin.sql',
        '202610110003_compra_financiada_admin.sql',
        '202610110004_editar_tarjeta_credito_admin.sql',
        '202610110005_observaciones_listado_compras.sql',
        '202610110006_anulacion_compras_gastos.sql',
    ], True),
    'financiacion': ('test-financiacion-compras-rpc.py', "    q=rpc('crear_tarjeta_credito_admin',uid(100)", [
        '202610100001_comprobantes_compras_gastos.sql',
        '202610110003_compra_financiada_admin.sql',
        '202610110004_editar_tarjeta_credito_admin.sql',
        '202610110005_observaciones_listado_compras.sql',
        '202610110006_anulacion_compras_gastos.sql',
    ], True),
    'compra-financiada': ('test-compra-financiada.py', "    card=result(rpc('crear_tarjeta_credito_admin',uid(100)", [
        '202610110004_editar_tarjeta_credito_admin.sql',
        '202610110005_observaciones_listado_compras.sql',
        '202610110006_anulacion_compras_gastos.sql',
    ], False),
    'anulacion': ('test-anulacion-compras.py', '    def annul(op,compra,motivo=', [
        '202610100001_comprobantes_compras_gastos.sql',
    ], True),
}

if len(sys.argv) != 2 or sys.argv[1] not in SUITES:
    raise SystemExit('Uso: python3 scripts/test-regresion-compras-historicas.py ' + '|'.join(SUITES))
name, marker, migrations, storage = SUITES[sys.argv[1]]
source_path = ROOT/'scripts'/name
source = source_path.read_text()
assert source.count(marker) == 1, 'Cambió el punto de instalación de la suite'
setup = ''
if storage:
    setup += '''    sql("CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;")
'''
migrations = migrations + ['202610140002_corte_historico_compras.sql', '202610140003_importacion_compras_historicas.sql', '202610140004_financiacion_historica_sheets.sql', '202610140005_importar_lote_compras_historicas.sql', '202610150001_preflight_lote_compras_historicas.sql', '202610150002_plazo_lote_hg.sql']
setup += f"    for historical_regression_migration in {migrations!r}:\n"
setup += "        sql((ROOT/'supabase/migrations'/historical_regression_migration).read_text())\n"
setup += "    print('INFRAESTRUCTURA FINAL INSTALADA: comienza regresión de comportamiento', flush=True)\n"
source = source.replace(marker, setup + marker)
if sys.argv[1] == 'compra-financiada':
    # Única aserción adaptada: la expresión ahora tiene dos modalidades. Se
    # exige la rama DETALLADO exacta y se comparan todos sus totales reales.
    old = "attgenerated='s' AND pg_get_expr(d.adbin,d.adrelid)='round((cantidad * costo_unitario), 2)'"
    new = "attgenerated='s' AND strpos(pg_get_expr(d.adbin,d.adrelid),'ELSE round((cantidad * costo_unitario), 2)')>0 AND NOT EXISTS(SELECT 1 FROM items_compras_gastos WHERE modalidad='DETALLADO' AND total IS DISTINCT FROM round(cantidad*costo_unitario,2))"
    assert source.count(old) == 1
    source = source.replace(old, new)
exec(compile(source, str(source_path), 'exec'), {'__file__': str(source_path), '__name__': '__main__'})
