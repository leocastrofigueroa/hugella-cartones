"""Reuse the isolated PostgreSQL harness; execute all tests with synthetic data."""
from pathlib import Path
source = Path(__file__).with_name('test-admin-credit-concurrency.py').read_text()
source = source.replace("'HISTORICO','Fixture'", "'CR-0047','Fixture'")
source = source.replace("    before = sql(historical)", """    sql(\"create function auth.role() returns text language sql stable as $$select current_setting('role')$$;\")
    sql((ROOT/'scripts/fixtures/credit-origin-legacy.sql').read_text())
    sql(\"revoke all on function public.importar_credito_hugella(text,text,text,text,text,text,date,integer,numeric), public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric) from public,anon,authenticated,service_role; grant execute on function public.importar_credito_hugella(text,text,text,text,text,text,date,integer,numeric), public.actualizar_credito_desde_sheets(text,text,text,text,text,text,date,integer,numeric) to authenticated;\")
    before = sql(historical)
    sql("insert into creditos(cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota) select '"+uid(3)+"','CR-'||lpad(i::text,4,'0'),'Fixture','2026-10-08',10,100 from generate_series(1,43) i;")
    all_before=sql("select json_agg(c order by id) from creditos c")
    sql((ROOT/'supabase/migrations/202610080005_procedencia_creditos.sql').read_text())
    all_after=json.loads(sql("select json_agg(c order by id) from creditos c"))
    assert all(c.pop('origen')=='SHEETS' for c in all_after)
    assert all_after==json.loads(all_before)
    for role in ['anon','authenticated','service_role']:
        for name in ['importar_credito_hugella','actualizar_credito_desde_sheets']:
            signature=name+'(text,text,text,text,text,text,date,integer,numeric)'
            assert sql("select has_function_privilege('"+role+"','"+signature+"','EXECUTE')")==('t' if role=='authenticated' else 'f')
    assert sql("select bool_and(prosecdef and proconfig=array['search_path='||chr(34)||chr(34)]) from pg_proc where proname in ('importar_credito_hugella','actualizar_credito_desde_sheets','crear_credito_admin')")=='t'
    assert sql("select relrowsecurity from pg_class where oid='creditos'::regclass")=='t'

    assert json.loads(sql(historical))['cliente']==json.loads(before)['cliente']
    old=json.loads(before); after=json.loads(sql(historical))
    assert after['credito'].pop('origen')=='SHEETS' and after==old
    before=sql(historical)
    def reject(q, state):
        try: sql(q)
        except RuntimeError as e:
            assert state+':' in str(e), str(e)
        else: raise AssertionError('Expected rejection '+state)
    reject(\"insert into creditos(cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota) values('\"+uid(3)+\"','NULO','F','2026-10-08',1,1)\",'23502')
    reject(\"update creditos set origen='ADMIN'\",'23514')
    reject(\"insert into creditos(cliente_id,codigo,producto,fecha_inicio,cantidad_cuotas,importe_cuota,origen) values('\"+uid(3)+\"','INVALIDO','F','2026-10-08',1,1,'OTRO')\",'23514')
    def legacy(dni,code):
        return \"set local role authenticated; set local test.uid='\"+uid(1)+\"'; select public.importar_credito_hugella('\"+code+\"','Cliente fixture','\"+dni+\"','Ficticio',null,'Fixture','2026-10-08',10,100);\"
    race('sheets_primero',legacy('30000001','S1'),rpc(800,'30000002','S1'),['30000001','30000002'],['S1'],[800],(1,1,0,0),error='23505')
    race('admin_primero',rpc(801,'30000003','S2'),legacy('30000004','S2'),['30000003','30000004'],['S2'],[801],(1,1,1,0),error='22023')
    assert sql(\"select origen from creditos where codigo='S1'\")=='SHEETS'
    assert sql(\"select origen from creditos where codigo='S2'\")=='ADMIN'
    p=session('repeat_sheets',legacy('30000001','S1')); ready(p); assert finish(p)[0]==0
    admin_before=sql(\"select row_to_json(c) from creditos c where codigo='S2'\")
    reject(\"set role authenticated; select actualizar_credito_desde_sheets('S2','Cliente fixture','30000003',null,null,'CAMBIO','2026-10-08',11,200)\",'22023')
    assert sql(\"select row_to_json(c) from creditos c where codigo='S2'\")==admin_before
    sql(\"set role authenticated; select actualizar_credito_desde_sheets('S1','Cliente fixture','30000001',null,null,'CAMBIO','2026-10-08',11,200)\")
    assert sql(\"select producto from creditos where codigo='S1'\")=='CAMBIO'
    race('externo_sheets_importador',external('30000005','S3'),legacy('30000006','S3'),['30000005','30000006'],['S3'],[802],(1,1,0,0))
    race('externo_admin_importador',external('30000007','S4').replace("'SHEETS'","'ADMIN'"),legacy('30000008','S4'),['30000007','30000008'],['S4'],[803],(1,1,0,0),error='22023')
    baseline=sql("select json_agg(c order by id) from clientes c")
    reject("set role authenticated; set test.uid='"+uid(1)+"'; select importar_credito_hugella('S2','Otro','30000099','Ficticio',null,'F','2026-10-08',1,1)",'22023')
    assert sql("select json_agg(c order by id) from clientes c")==baseline
    reject("set role authenticated; set test.uid='"+uid(1)+"'; select actualizar_credito_desde_sheets('S1','Otro','30000001',null,null,'F','2026-10-08',1,1)",'22023')
    # Fault injection in the audit table, without disabling the immutable origin trigger.
    sql("update operaciones_altas_creditos set credito_id=(select id from creditos where codigo='CR-0047'),cliente_id='"+uid(3)+"' where operacion_id='"+uid(801)+"'")
    reject(rpc(801,'30000003','S2'),'23514')
    sql("update operaciones_altas_creditos set credito_id=(select id from creditos where codigo='S2'),cliente_id=(select cliente_id from creditos where codigo='S2') where operacion_id='"+uid(801)+"'")
    reject("set role authenticated; set test.uid=''; "+rpc(804,'30000009','S5').replace("set local test.uid='"+uid(1)+"';",''),'42501')

""")
# External fixtures are valid legacy writers: mandatory provenance is explicit.
source = source.replace('fecha_inicio,cantidad_cuotas,importe_cuota) "', 'fecha_inicio,cantidad_cuotas,importe_cuota,origen) "')
source = source.replace("'2026-10-08',10,100 from clientes", "'2026-10-08',10,100,'SHEETS' from clientes")
source = source.replace("'-v', 'ON_ERROR_STOP=1',", "'-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',")
source = source.replace("    assert sql(historical) == before", "    assert sql(\"select count(*) from creditos where codigo='C1' and origen='ADMIN'\")=='1'\n    assert sql(historical) == before")
exec(compile(source, str(Path(__file__)), 'exec'))
