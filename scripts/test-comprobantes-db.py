"""11D.4: PostgreSQL 17 local, sin TCP/credenciales. Storage simulado por catálogo RLS."""
import os, subprocess, tempfile, json, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BIN=Path('/opt/homebrew/opt/postgresql@17/bin')
ENV={k:v for k,v in os.environ.items() if not k.startswith(('PG','PSQL'))}
BASE=Path(tempfile.mkdtemp(prefix='hg-receipts-',dir='/private/tmp')); DATA=BASE/'data'; SOCKET=BASE/'socket'; SOCKET.mkdir(mode=0o700)
count=0
actor='00000000-0000-4000-8000-000000000001'; other='00000000-0000-4000-8000-000000000002'; ordinary='00000000-0000-4000-8000-000000000003'
purchase='00000000-0000-4000-8000-000000000010'; receipt='00000000-0000-4000-8000-000000000020'
def run(args,**kw): return subprocess.run(args,env=ENV,text=True,capture_output=True,**kw)
def sql(q,ok=True):
 r=run([str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55492','-U','postgres'],input=q,timeout=30)
 if ok: assert r.returncode==0,r.stderr
 return r
def check(label,q):
 global count
 assert sql(q).stdout.strip()=='t',label
 count+=1; print('PASS:',label,flush=True)
def reject(label,q):
 global count
 assert sql(q,False).returncode!=0,label
 count+=1; print('PASS:',label,flush=True)
def auth(q,who=actor,role='authenticated'):return f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL test.uid='{who}'; {q}; COMMIT;"
def reserve(id=receipt,who=actor,name='foto.png',mime='image/png',size=70,hash='a'*64,compra=None):
 compra=compra or purchase
 return f"SELECT reservar_comprobante_compra_gasto_servidor('{id}','{compra}','{who}','{name}','{mime}',{size},'{hash}')"
def confirm(id=receipt,who=actor,hash='a'*64,size=70):return f"SELECT confirmar_comprobante_compra_gasto_servidor('{id}','{who}','{hash}',{size})"
try:
 r=run([str(BIN/'initdb'),'-D',str(DATA),'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']); assert r.returncode==0,r.stderr
 r=run([str(BIN/'pg_ctl'),'-D',str(DATA),'-l',str(BASE/'server.log'),'-o',f"-k {SOCKET} -p 55492 -c listen_addresses=''",'-w','start']); assert r.returncode==0,r.stderr
 sql(f"""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES ('{actor}'),('{other}'),('{ordinary}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE FUNCTION es_admin_hugella() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid() IN ('{actor}'::uuid,'{other}'::uuid)$$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role; GRANT ALL ON storage.objects TO anon,authenticated,service_role;
 INSERT INTO storage.buckets VALUES ('contratos-privados','contratos-privados',false,5242880,ARRAY['image/png','application/pdf']);
 INSERT INTO storage.objects(bucket_id,name) VALUES ('contratos-privados','firma-previa.png');
 ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 """)
 for file in ['202610090003_compras_gastos_base.sql','202610090004_compras_gastos_rpc_admin.sql']:sql((ROOT/'supabase/migrations'/file).read_text())
 supplier=json.loads(sql(auth(f"SELECT crear_proveedor_admin('{purchase}','Proveedor')")).stdout)['id']
 sql(auth(f"SELECT crear_compra_gasto_admin('{purchase}','GASTO','{supplier}',CURRENT_DATE,'ARS',NULL,NULL,'[{{\"posicion\":1,\"descripcion\":\"Gasto\",\"cantidad\":1,\"costo_unitario\":10}}]')"))
 purchase=sql('SELECT id FROM compras_gastos').stdout.strip()
 snapshot="SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace),'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE relnamespace='public'::regnamespace),'buckets',(SELECT jsonb_agg(to_jsonb(b)) FROM storage.buckets b),'objects',(SELECT jsonb_agg(to_jsonb(o)) FROM storage.objects o),'purchases',(SELECT jsonb_agg(to_jsonb(c)) FROM compras_gastos c))"
 before=sql(snapshot).stdout
 migration=(ROOT/'supabase/migrations/202610100001_comprobantes_compras_gastos.sql').read_text()
 reject('installation intentional rollback',migration.replace('commit;','SELECT 1/0; commit;'))
 check('rollback removes all new objects',"SELECT to_regclass('comprobantes_compras_gastos') IS NULL AND NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='compras-gastos-privados')")
 assert sql(snapshot).stdout==before
 sql('CREATE POLICY incompatible ON storage.objects FOR SELECT USING(true)')
 reject('unexpected Storage policy fails closed',migration)
 sql('DROP POLICY incompatible ON storage.objects')
 sql(migration)
 check('bucket private 3MiB and exact MIME',"SELECT NOT public AND file_size_limit=3145728 AND allowed_mime_types=ARRAY['image/jpeg','image/png','application/pdf'] FROM storage.buckets WHERE id='compras-gastos-privados'")
 check('contracts bucket and object untouched',"SELECT (SELECT file_size_limit=5242880 AND allowed_mime_types=ARRAY['image/png','application/pdf'] FROM storage.buckets WHERE id='contratos-privados') AND (SELECT count(*)=1 FROM storage.objects)")
 check('Storage has zero policies',"SELECT NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass)")
 check('metadata RLS and no policies',"SELECT relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid) FROM pg_class c WHERE oid='comprobantes_compras_gastos'::regclass")
 check('metadata direct access denied all API roles',"SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated'),('service_role')) r(role) WHERE has_table_privilege(r.role,'comprobantes_compras_gastos','SELECT') OR has_table_privilege(r.role,'comprobantes_compras_gastos','INSERT') OR has_table_privilege(r.role,'comprobantes_compras_gastos','UPDATE') OR has_table_privilege(r.role,'comprobantes_compras_gastos','DELETE'))")
 check('all RPCs postgres definer empty search_path',"SELECT bool_and(pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path="+ '""' +"']) FROM pg_proc WHERE proname IN ('reservar_comprobante_compra_gasto_servidor','confirmar_comprobante_compra_gasto_servidor','listar_comprobantes_compra_gasto_admin','obtener_comprobante_compra_gasto_admin','anular_comprobante_compra_gasto_admin')")
 for fn in ['reservar_comprobante_compra_gasto_servidor(uuid,uuid,uuid,text,text,bigint,text)','confirmar_comprobante_compra_gasto_servidor(uuid,uuid,text,bigint)']:
  check('server-only ACL '+fn,f"SELECT has_function_privilege('service_role','{fn}','EXECUTE') AND NOT has_function_privilege('authenticated','{fn}','EXECUTE') AND NOT has_function_privilege('anon','{fn}','EXECUTE')")
 check('no PUBLIC EXECUTE on any new RPC',"SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.proname IN ('reservar_comprobante_compra_gasto_servidor','confirmar_comprobante_compra_gasto_servidor','listar_comprobantes_compra_gasto_admin','obtener_comprobante_compra_gasto_admin','anular_comprobante_compra_gasto_admin') AND a.grantee=0 AND a.privilege_type='EXECUTE')")
 reject('anon cannot confirm',auth(confirm(),role='anon'))
 reject('anon cannot upload Storage',auth("INSERT INTO storage.objects(bucket_id,name) VALUES ('compras-gastos-privados','manual.png')",role='anon'))
 reject('authenticated cannot reserve',auth(reserve()))
 reject('authenticated cannot confirm',auth(confirm()))
 reject('admin JWT cannot upload Storage directly',auth("INSERT INTO storage.objects(bucket_id,name) VALUES ('compras-gastos-privados','manual.png')"))
 check('admin JWT cannot read Storage directly',auth("SELECT count(*)=0 FROM storage.objects"))
 reject('no admin list',auth(f"SELECT * FROM listar_comprobantes_compra_gasto_admin('{purchase}')",ordinary))
 reject('nonexistent purchase',auth(reserve(compra=ordinary),role='service_role'))
 reject('empty file',auth(reserve(size=0),role='service_role'))
 reject('too large',auth(reserve(size=3145729),role='service_role'))
 reject('invalid MIME',auth(reserve(mime='image/svg+xml'),role='service_role'))
 reject('bad hash',auth(reserve(hash='fake'),role='service_role'))
 reject('malicious name',auth(reserve(name='../evil.png'),role='service_role'))
 first=json.loads(sql(auth(reserve(),role='service_role')).stdout)
 again=json.loads(sql(auth(reserve(),role='service_role')).stdout);assert first==again
 check('same UUID returns one pending row',f"SELECT count(*)=1 AND bool_and(estado='PENDIENTE') FROM comprobantes_compras_gastos WHERE id='{receipt}'")
 reject('same UUID different actor',auth(reserve(who=other),role='service_role'))
 reject('same UUID different bytes',auth(reserve(hash='b'*64),role='service_role'))
 reject('confirm without object',auth(confirm(),role='service_role'))
 sql(f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('compras-gastos-privados','{first['ruta']}','{{\"size\":70}}')")
 reject('confirm incompatible hash',auth(confirm(hash='b'*64),role='service_role'))
 available=json.loads(sql(auth(confirm(),role='service_role')).stdout);assert available['estado']=='DISPONIBLE'
 assert json.loads(sql(auth(confirm(),role='service_role')).stdout)==available
 check('confirmation retry stable',f"SELECT estado='DISPONIBLE' AND confirmado_at IS NOT NULL FROM comprobantes_compras_gastos WHERE id='{receipt}'")
 for role in ('anon','authenticated'):
  sql(auth("UPDATE storage.objects SET name='changed'",role=role));sql(auth('DELETE FROM storage.objects',role=role))
 check('user UPDATE/DELETE Storage affect zero objects',f"SELECT count(*)=1 FROM storage.objects WHERE name='{first['ruta']}'")
 reject('original metadata immutable',f"UPDATE comprobantes_compras_gastos SET sha256=repeat('b',64) WHERE id='{receipt}'")
 reject('physical row delete denied even owner',f"DELETE FROM comprobantes_compras_gastos WHERE id='{receipt}'")
 check('authorized list and read',auth(f"SELECT (SELECT count(*)=1 FROM listar_comprobantes_compra_gasto_admin('{purchase}')) AND (obtener_comprobante_compra_gasto_admin('{receipt}')->>'id'='{receipt}')"))
 reject('annul empty reason',auth(f"SELECT anular_comprobante_compra_gasto_admin('{receipt}','  ')"))
 annul=json.loads(sql(auth(f"SELECT anular_comprobante_compra_gasto_admin('{receipt}',' Error de carga ')")).stdout)
 assert annul['estado']=='ANULADO' and annul['anulado_por']==actor and annul['confirmado_at']==available['confirmado_at']
 assert json.loads(sql(auth(f"SELECT anular_comprobante_compra_gasto_admin('{receipt}','Error de carga')")).stdout)==annul
 reject('annul different reason blocked',auth(f"SELECT anular_comprobante_compra_gasto_admin('{receipt}','Otro')"))
 reject('annul cannot be re-confirmed',auth(confirm(),role='service_role'))
 check('annul preserves object/history',f"SELECT (SELECT count(*)=2 FROM storage.objects) AND (SELECT estado='ANULADO' FROM comprobantes_compras_gastos WHERE id='{receipt}')")
 # Two real connections contend on the same operation lock.
 race='00000000-0000-4000-8000-000000000021'; args=[str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(SOCKET),'-p','55492','-U','postgres']
 a=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 a.stdin.write(f"BEGIN; SET ROLE service_role; {reserve(id=race)};\n");a.stdin.flush()
 time.sleep(.15)
 b=subprocess.Popen(args,env=ENV,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 b.stdin.write("SET application_name='receipt_second'; "+auth(reserve(id=race),role='service_role')+"\n\\q\n");b.stdin.flush()
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='receipt_second' AND cardinality(pg_blocking_pids(pid))>0)").stdout.strip()=='t':break
  time.sleep(.05)
 else:raise AssertionError('second reservation did not block')
 a.stdin.write('COMMIT;\n\\q\n');a.stdin.flush();ao,ae=a.communicate(timeout=10);bo,be=b.communicate(timeout=10);assert a.returncode==b.returncode==0,(ae,be);assert json.loads(ao)==json.loads(bo)
 check('concurrent same UUID one row',f"SELECT count(*)=1 FROM comprobantes_compras_gastos WHERE id='{race}'")
 sql(auth(reserve(id='00000000-0000-4000-8000-000000000022'),role='service_role'))
 check('different UUID multiple attachments',"SELECT count(*)=3 FROM comprobantes_compras_gastos")
 reject('reservation transaction rollback',auth(reserve(id='00000000-0000-4000-8000-000000000023')+';SELECT 1/0',role='service_role'))
 reject('ANULADO null motive rejected',f"UPDATE comprobantes_compras_gastos SET estado='ANULADO',anulado_at=clock_timestamp(),anulado_por='{actor}',motivo_anulacion=NULL WHERE id='{race}'")
 check('no row left by failed transaction',"SELECT NOT EXISTS(SELECT 1 FROM comprobantes_compras_gastos WHERE id='00000000-0000-4000-8000-000000000023')")
 print(f'PASS: {count} checks; local PostgreSQL only, no live Storage HTTP')
finally:
 if run([str(BIN/'pg_ctl'),'-D',str(DATA),'status']).returncode==0:run([str(BIN/'pg_ctl'),'-D',str(DATA),'-m','fast','-w','stop'])
