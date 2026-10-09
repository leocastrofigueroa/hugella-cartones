"""Real PostgreSQL sequence tests; reuses only the isolated synthetic harness."""
from pathlib import Path
import sys
# Expand the approved provenance test setup, without executing its cluster yet.
setup = Path(__file__).with_name('test-credit-origin.py').read_text().split('exec(compile')[0]
namespace = {'__file__': str(Path(__file__))}
exec(compile(setup, __file__, 'exec'), namespace)
source = namespace['source']
source = source[:source.index("    race('sheets_primero'")]
maximum = int(sys.argv[1]) if len(sys.argv) > 1 else 47
source += f"\n    maximum={maximum}\n"
source += '''
    if maximum != 47:
        sql("update creditos set codigo='CR-'||lpad('"+str(maximum)+"',greatest(4,length('"+str(maximum)+"')),'0') where codigo='CR-0047'")
    historical_before=sql("select json_agg(c order by id) from creditos c")
    sql((ROOT/'supabase/migrations/202610080006_codigos_creditos_automaticos.sql').read_text())
    assert sql("select json_agg(c order by id) from creditos c")==historical_before
    def automatic(op,dni):
        return "set local role authenticated; set local test.uid='"+uid(1)+"'; select row_to_json(r) from crear_credito_admin('"+uid(op)+"','"+dni+"',true,null,'Cliente fixture',null,null,'Fixture','2026-10-08',10,100) r;"
    first=session('first',automatic(900,'40000001')); result=json.loads(ready(first)[-1]); assert finish(first)[0]==0
    expected='CR-'+str(maximum+1).zfill(4)
    assert result['codigo']==expected and not result['ya_procesada']
    sequence_before=sql('select last_value from creditos_codigo_seq')
    retry=session('retry',automatic(900,'40000001')); repeated=json.loads(ready(retry)[-1]); assert finish(retry)[0]==0
    assert repeated=={**result,'ya_procesada':True}
    assert sql('select last_value from creditos_codigo_seq')==sequence_before
    assert sql("select origen from creditos where codigo='"+expected+"'")=='ADMIN'
    for role in ['anon','authenticated','service_role']:
        for permission in ['SELECT','USAGE','UPDATE']:
            assert sql("select has_sequence_privilege('"+role+"','creditos_codigo_seq','"+permission+"')")=='f'
        signature='public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,date,integer,numeric)'
        assert sql("select has_function_privilege('"+role+"','"+signature+"','EXECUTE')")==('t' if role=='authenticated' else 'f')
    assert sql("select to_regprocedure('public.crear_credito_admin(uuid,text,boolean,uuid,text,text,text,text,text,date,integer,numeric)') is null")=='t'
    assert sql("select count(*) from pg_proc where proname='crear_credito_admin'")=='1'
    print('PASS: max='+str(maximum)+' first='+expected+'; retry consumes no number; ACL; old signature absent.',flush=True)
    if maximum==47:
        # Independent Admin backends complete before either transaction commits.
        a=session('admin_a',automatic(901,'40000002')); ra=json.loads(ready(a)[-1])
        b=session('admin_b',automatic(902,'40000003')); rb=json.loads(ready(b)[-1])
        assert ra['codigo']!=rb['codigo']
        pids=sql("select json_agg(pid order by pid) from pg_stat_activity where application_name in ('admin_a','admin_b')")
        assert len(set(json.loads(pids)))==2
        print('Admin parallel backend PIDs='+pids+' codes='+ra['codigo']+','+rb['codigo'],flush=True)
        assert finish(a)[0]==finish(b)[0]==0
        candidate='CR-'+str(int(sql('select last_value from creditos_codigo_seq'))+1).zfill(4)
        race('same_operation',automatic(920,'40000020'),automatic(920,'40000020'),['40000020'],[candidate],[920],(1,1,1,0),retry=True)
        # Restore the next candidate only in this disposable fixture.
        sql("select setval('creditos_codigo_seq',100,false)")
        race('sheets_wins',legacy('40000004','CR-0100'),automatic(903,'40000005'),['40000004','40000005'],['CR-0100','CR-0101'],[903],(2,2,1,0))
        assert sql("select codigo from creditos where id=(select credito_id from operaciones_altas_creditos where operacion_id='"+uid(903)+"')")=='CR-0101'
        sql("select setval('creditos_codigo_seq',110,false)")
        race('admin_wins',automatic(904,'40000006'),legacy('40000007','CR-0110'),['40000006','40000007'],['CR-0110'],[904],(1,1,1,0),error='22023')
        sql("select setval('creditos_codigo_seq',120,false)")
        # External writer bypasses advisory locks; UNIQUE drives Admin retry.
        race('external_wins',external('40000008','CR-0120'),automatic(905,'40000009'),['40000008','40000009'],['CR-0120','CR-0121'],[905],(2,2,1,0))
        aborted=session('rollback',automatic(906,'40000010')); r=json.loads(ready(aborted)[-1]); aborted.stdin.write('rollback;\\n'+chr(92)+'q\\n'); aborted.stdin.flush(); aborted.communicate(timeout=20)
        assert counts(['40000010'],[r['codigo']],[906])==dict(clientes=0,creditos=0,operaciones=0,huerfanos=0)
        nextp=session('after_rollback',automatic(907,'40000011')); rn=json.loads(ready(nextp)[-1]); assert finish(nextp)[0]==0
        assert int(rn['codigo'][3:])>int(r['codigo'][3:])
        # Force a token collision; it must propagate, not consume 1000 candidates.
        token=sql("select access_token from creditos where codigo='CR-0047'")
        sql("alter table creditos alter column access_token set default '"+token+"'::uuid")
        before=int(sql('select last_value from creditos_codigo_seq'))
        rejected=session('token_conflict',automatic(908,'40000012')); out,err=rejected.communicate(timeout=20)
        assert rejected.returncode!=0 and '23505:' in err
        assert int(sql('select last_value from creditos_codigo_seq'))==before+1
        assert sql("select count(*) from clientes where dni='40000012'")=='0'
        sql('alter table creditos alter column access_token set default gen_random_uuid()')
        assert sql("select count(*) from clientes c where not exists(select 1 from creditos cr where cr.cliente_id=c.id)")=='0'
        assert sql("select count(*) from (select regexp_replace(dni,'[^0-9]','','g') from clientes group by 1 having count(*)>1) d")=='0'
        assert sql('select deadlocks from pg_stat_database where datname=current_database()')=='0'
        assert sql("select json_agg(c order by id) from creditos c where origen='SHEETS' and codigo in (select 'CR-'||lpad(i::text,4,'0') from generate_series(1,43)i union all select 'CR-0047')")==historical_before
        print('PASS: concurrent Admin; Sheets/Admin both orders; external UNIQUE retry; rollback gap; token UNIQUE propagates; zero orphans/duplicates/deadlocks.',flush=True)
'''
original = Path(__file__).with_name('test-admin-credit-concurrency.py').read_text()
source += original[original.index('\nfinally:'):]
exec(compile(source, __file__, 'exec'))
