"""PostgreSQL 17 disposable synthetic fixture; no .env or TCP/production."""
from pathlib import Path
setup = Path(__file__).with_name('test-credit-origin.py').read_text().split('exec(compile')[0]
namespace = {'__file__': str(Path(__file__))}
exec(compile(setup, __file__, 'exec'), namespace)
source = namespace['source']
source = source[:source.index("    race('sheets_primero'")]
source += '''
    sql((ROOT/'supabase/migrations/202610080006_codigos_creditos_automaticos.sql').read_text())
    def old(op,dni):
        return "set local role authenticated; set local test.uid='"+uid(1)+"'; select row_to_json(r) from crear_credito_admin('"+uid(op)+"','"+dni+"',true,null,'Cliente fixture',null,null,'Fixture','2026-10-08',10,100) r;"
    p=session('historical_operation',old(900,'40000001')); historical_result=json.loads(ready(p)[-1]); assert finish(p)[0]==0
    original_request=sql("select solicitud from operaciones_altas_creditos where operacion_id='"+uid(900)+"'")
    sql((ROOT/'supabase/migrations/202610080007_inversion_ubicacion_altas.sql').read_text())
    sql("alter table pagos add column estado text not null default 'VALIDO', add column cuotas_aplicadas integer not null default 0; create table cierres_creditos(credito_id uuid primary key references creditos(id),tipo text not null,fecha date not null);")
    migration008=(ROOT/'supabase/migrations/202610080008_auditoria_ficha_credito.sql').read_text()
    broken008=migration008.replace("using errcode = '42501'", "usingerrcode='42501'",1)
    assert broken008!=migration008
    reject(broken008,'42601')
    assert sql("select to_regclass('public.cambios_datos_complementarios') is null and to_regprocedure('public.proteger_cambio_complementario()') is null and to_regprocedure('public.proteger_dato_complementario_directo()') is null")=='t'
    sql(migration008)
    assert sql("select relrowsecurity from pg_class where oid='public.cambios_datos_complementarios'::regclass")=='t'
    assert sql("select count(*) from pg_trigger where tgname in ('cambios_complementarios_inmutables','creditos_inversion_controlada','clientes_ubicacion_controlada') and not tgisinternal")=='3'
    ficha=json.loads(sql("set role authenticated; set test.uid='"+uid(1)+"'; select obtener_ficha_credito_admin('"+historical_result['credito_id']+"')"))
    assert ficha['inversion'] is None and ficha['total_pagado_valido']==0 and 'access_token' not in ficha
    assert sql("select hugella_fecha_fin_prevista('2026-10-13',195)")=='2027-05-27'
    print('PASS: full 008 syntax failure rolls back all objects; exact complete file BEGIN through COMMIT installs on retry; independent connections verify triggers, RLS, ficha and end date.',flush=True)
    def new(op,dni,cost=500):
        return old(op,dni).replace('10,100) r;', '10,100,'+str(cost)+',null) r;')
    race('new_same_operation',new(901,'40000002'),new(901,'40000002'),['40000002'],['CR-0049'],[901],(1,1,1,0),retry=True)
    race('new_conflicting_investment',new(902,'40000003'),new(902,'40000003',600),['40000003'],['CR-0050'],[902],(1,1,1,0),error='22023')
    race('old_then_new_same_id',old(900,'40000001'),new(900,'40000001'),['40000001'],['CR-0048'],[900],(1,1,1,0),error='22023')
    race('new_then_old_same_id',new(903,'40000004'),old(903,'40000004'),['40000004'],['CR-0051'],[903],(1,1,1,0),error='22023')
    race('sheets_wins_new',legacy('40000005','CR-0052'),new(904,'40000006'),['40000005','40000006'],['CR-0052','CR-0053'],[904],(2,2,1,0))
    race('new_wins_sheets',new(905,'40000007'),legacy('40000008','CR-0054'),['40000007','40000008'],['CR-0054'],[905],(1,1,1,0),error='22023')
    def edit(op,cost,previous='null'):
        payload=json.dumps(dict(p_operacion_id=uid(op),p_tipo='INVERSION',p_entidad_id=historical_result['credito_id'],p_valor_anterior_esperado=json.loads(previous),p_valor_nuevo=cost,p_motivo='Motivo fixture'))
        return "set local role authenticated; set local test.uid='"+uid(1)+"'; select row_to_json(r) from json_to_record('"+payload+"'::json) a(p_operacion_id uuid,p_tipo text,p_entidad_id uuid,p_valor_anterior_esperado jsonb,p_valor_nuevo jsonb,p_motivo text) cross join lateral actualizar_dato_complementario_admin(a.p_operacion_id,a.p_tipo,a.p_entidad_id,a.p_valor_anterior_esperado,a.p_valor_nuevo,a.p_motivo) r;"
    def audit_race(label,first,second,error=None):
        a=session(label+'_a',first); ra=ready(a)
        b=session(label+'_b',second)
        deadline=time.monotonic()+8; blocked=False
        while time.monotonic()<deadline:
            if sql("select exists(select 1 from pg_stat_activity a join pg_stat_activity b on a.pid=any(pg_blocking_pids(b.pid)) where a.application_name='"+label+"_a' and b.application_name='"+label+"_b')")=='t':
                blocked=True; break
            time.sleep(0.05)
        assert blocked, 'No real audit blocking observed'
        assert finish(a)[0]==0
        if error:
            out,err=b.communicate(timeout=20); assert b.returncode!=0 and error+':' in err,(out,err)
        else:
            rb=ready(b); assert finish(b)[0]==0; assert ra[-1]==rb[-1]
        print('PASS: '+label+' independent backends; real blocking; '+(error or 'identical audit'),flush=True)
    audit_race('audit_competing_null_expectations',edit(948,200),edit(949,350),'40001')
    audit_race('audit_same_operation',edit(950,250,'200'),edit(950,250,'200'))

    audit_race('audit_stale_expected_value',edit(951,300,'250'),edit(952,350,'250'),'40001')
    assert sql('select count(*) from cambios_datos_complementarios')=='3'
    assert sql("select solicitud from operaciones_altas_creditos where operacion_id='"+uid(900)+"'")==original_request
    assert sql('select deadlocks from pg_stat_database where datname=current_database()')=='0'
    assert sql("select count(*) from clientes c where not exists(select 1 from creditos cr where cr.cliente_id=c.id)")=='0'
    print('PASS: dual signatures, idempotency, investment conflicts, Sheets both orders, audited edits; historical request untouched; no deadlocks/orphans.',flush=True)
'''
original = Path(__file__).with_name('test-admin-credit-concurrency.py').read_text()
source += original[original.index('\nfinally:'):]
exec(compile(source, __file__, 'exec'))
