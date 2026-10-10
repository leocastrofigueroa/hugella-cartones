-- 11D.4: archivos privados; reserva/confirmación exclusivamente del servidor.
begin;
do $preflight$
begin
  if to_regclass('public.compras_gastos') is null
    or to_regprocedure('public.es_admin_hugella()') is null
    or to_regclass('storage.objects') is null then
    raise exception 'Prerequisitos de Compras/Storage ausentes';
  end if;
  -- Baseline verificado: sin policies Storage. Abortar frente a permisos inesperados.
  if exists(select 1 from pg_catalog.pg_policy where polrelid='storage.objects'::regclass)
    or not (select relrowsecurity from pg_catalog.pg_class where oid='storage.objects'::regclass)
    or exists(select 1 from pg_catalog.pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Storage RLS/policies incompatibles: requiere revisión';
  end if;
  if exists(select 1 from storage.buckets where id='compras-gastos-privados' or name='compras-gastos-privados') then
    raise exception 'Bucket de comprobantes ya existente: requiere revisión';
  end if;
end;
$preflight$;

create table public.comprobantes_compras_gastos (
  id uuid primary key,
  compra_gasto_id uuid not null references public.compras_gastos(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  bucket text not null check (bucket='compras-gastos-privados'),
  ruta text not null,
  nombre_original text not null check (length(nombre_original) between 1 and 180 and nombre_original=btrim(nombre_original) and nombre_original !~ '[[:cntrl:]/\\<>]'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  tamano_bytes bigint not null check (tamano_bytes between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  solicitud jsonb not null check (jsonb_typeof(solicitud)='object'),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','DISPONIBLE','ANULADO')),
  created_at timestamptz not null default clock_timestamp(),
  confirmado_at timestamptz,
  anulado_at timestamptz,
  anulado_por uuid references auth.users(id) on delete restrict,
  motivo_anulacion text,
  unique(bucket,ruta),
  check (ruta=compra_gasto_id::text || '/' || id::text || case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end),
  check ((estado='PENDIENTE' and confirmado_at is null and anulado_at is null and anulado_por is null and motivo_anulacion is null)
    or (estado='DISPONIBLE' and confirmado_at is not null and anulado_at is null and anulado_por is null and motivo_anulacion is null)
    or (estado='ANULADO' and anulado_at is not null and anulado_por is not null and motivo_anulacion is not null and length(btrim(motivo_anulacion)) between 1 and 500)),
  check (solicitud=jsonb_build_object('compra_gasto_id',compra_gasto_id,'nombre',nombre_original,'mime',mime_type,'tamano',tamano_bytes,'sha256',sha256)),
  check (confirmado_at is null or confirmado_at>=created_at),
  check (anulado_at is null or anulado_at>=created_at)
);
create index comprobantes_compras_gastos_compra_idx on public.comprobantes_compras_gastos(compra_gasto_id,created_at,id);
alter table public.comprobantes_compras_gastos owner to postgres;
alter table public.comprobantes_compras_gastos enable row level security;
revoke all on table public.comprobantes_compras_gastos from public,anon,authenticated,service_role;

create function public.proteger_comprobante_compra_gasto()
returns trigger language plpgsql set search_path='' as $fn$
begin
  if tg_op='DELETE' then raise exception 'El comprobante conserva su auditoría'; end if;
  if row(new.id,new.compra_gasto_id,new.actor_id,new.bucket,new.ruta,new.nombre_original,new.mime_type,new.tamano_bytes,new.sha256,new.solicitud,new.created_at)
    is distinct from row(old.id,old.compra_gasto_id,old.actor_id,old.bucket,old.ruta,old.nombre_original,old.mime_type,old.tamano_bytes,old.sha256,old.solicitud,old.created_at) then
    raise exception 'Identidad del comprobante inmutable';
  end if;
  if old.estado='ANULADO' or (old.estado='DISPONIBLE' and new.estado<>'ANULADO')
    or (old.estado='PENDIENTE' and new.estado not in ('DISPONIBLE','ANULADO'))
    or (old.confirmado_at is not null and new.confirmado_at is distinct from old.confirmado_at) then
    raise exception 'Transición de comprobante inválida';
  end if;
  return new;
end;
$fn$;
alter function public.proteger_comprobante_compra_gasto() owner to postgres;
revoke all on function public.proteger_comprobante_compra_gasto() from public,anon,authenticated,service_role;
create trigger comprobante_compra_gasto_inmutable before update or delete on public.comprobantes_compras_gastos
for each row execute function public.proteger_comprobante_compra_gasto();

-- actor proviene de la sesión verificada por API, nunca del cuerpo del navegador.
create function public.reservar_comprobante_compra_gasto_servidor(
  p_id uuid,p_compra_gasto_id uuid,p_actor_id uuid,p_nombre text,p_mime text,p_tamano bigint,p_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $rpc$
declare v_solicitud jsonb; v_row public.comprobantes_compras_gastos%rowtype; v_ruta text;
begin
  if p_id is null or p_compra_gasto_id is null or p_actor_id is null or p_nombre is null or p_mime is null or p_tamano is null or p_sha256 is null then
    raise exception 'Identidad de archivo obligatoria' using errcode='22023';
  end if;
  v_solicitud:=jsonb_build_object('compra_gasto_id',p_compra_gasto_id,'nombre',btrim(p_nombre),'mime',p_mime,'tamano',p_tamano,'sha256',p_sha256);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hugella:comprobante:'||p_id::text,0));
  select * into v_row from public.comprobantes_compras_gastos where id=p_id;
  if found then
    if v_row.actor_id<>p_actor_id or v_row.solicitud<>v_solicitud then
      raise exception 'UUID utilizado con otro actor o archivo' using errcode='22023';
    end if;
    if v_row.estado='ANULADO' then raise exception 'Comprobante anulado' using errcode='22023'; end if;
    return to_jsonb(v_row);
  end if;
  v_ruta:=p_compra_gasto_id::text||'/'||p_id::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'application/pdf' then '.pdf' else '' end;
  insert into public.comprobantes_compras_gastos(id,compra_gasto_id,actor_id,bucket,ruta,nombre_original,mime_type,tamano_bytes,sha256,solicitud)
  values(p_id,p_compra_gasto_id,p_actor_id,'compras-gastos-privados',v_ruta,btrim(p_nombre),p_mime,p_tamano,p_sha256,v_solicitud) returning * into v_row;
  return to_jsonb(v_row);
end;
$rpc$;

create function public.confirmar_comprobante_compra_gasto_servidor(p_id uuid,p_actor_id uuid,p_sha256 text,p_tamano bigint)
returns jsonb language plpgsql security definer set search_path='' as $rpc$
declare v_row public.comprobantes_compras_gastos%rowtype;
begin
  select * into v_row from public.comprobantes_compras_gastos where id=p_id for update;
  if not found or v_row.actor_id is distinct from p_actor_id or v_row.sha256 is distinct from p_sha256 or v_row.tamano_bytes is distinct from p_tamano then
    raise exception 'Identidad de confirmación incompatible' using errcode='22023';
  end if;
  if v_row.estado='ANULADO' then raise exception 'Comprobante anulado' using errcode='22023'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id=v_row.bucket and o.name=v_row.ruta) then
    raise exception 'Archivo todavía ausente' using errcode='22023';
  end if;
  -- Los bytes y el hash son verificados por el servidor antes de esta RPC privada.
  if v_row.estado='PENDIENTE' then
    update public.comprobantes_compras_gastos set estado='DISPONIBLE',confirmado_at=clock_timestamp() where id=p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$rpc$;

create function public.listar_comprobantes_compra_gasto_admin(p_compra_gasto_id uuid)
returns setof public.comprobantes_compras_gastos language plpgsql stable security definer set search_path='' as $rpc$
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.compras_gastos where id=p_compra_gasto_id) then raise exception 'Compra inexistente' using errcode='22023'; end if;
  return query select * from public.comprobantes_compras_gastos where compra_gasto_id=p_compra_gasto_id order by created_at,id;
end;
$rpc$;

create function public.obtener_comprobante_compra_gasto_admin(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $rpc$
declare v_row public.comprobantes_compras_gastos%rowtype;
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  select * into v_row from public.comprobantes_compras_gastos where id=p_id;
  if not found then raise exception 'Comprobante inexistente' using errcode='22023'; end if;
  return to_jsonb(v_row);
end;
$rpc$;

create function public.anular_comprobante_compra_gasto_admin(p_id uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path='' as $rpc$
declare v_row public.comprobantes_compras_gastos%rowtype; v_motivo text:=nullif(btrim(p_motivo),'');
begin
  if auth.uid() is null or public.es_admin_hugella() is not true then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_motivo is null or length(v_motivo)>500 then raise exception 'Motivo obligatorio (hasta 500 caracteres)' using errcode='22023'; end if;
  select * into v_row from public.comprobantes_compras_gastos where id=p_id for update;
  if not found then raise exception 'Comprobante inexistente' using errcode='22023'; end if;
  if v_row.estado='ANULADO' then
    if v_row.anulado_por<>auth.uid() or v_row.motivo_anulacion<>v_motivo then raise exception 'Anulación utilizada con otro actor o motivo' using errcode='22023'; end if;
    return to_jsonb(v_row);
  end if;
  update public.comprobantes_compras_gastos set estado='ANULADO',anulado_at=clock_timestamp(),anulado_por=auth.uid(),motivo_anulacion=v_motivo where id=p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$rpc$;

alter function public.reservar_comprobante_compra_gasto_servidor(uuid,uuid,uuid,text,text,bigint,text) owner to postgres;
alter function public.confirmar_comprobante_compra_gasto_servidor(uuid,uuid,text,bigint) owner to postgres;
alter function public.listar_comprobantes_compra_gasto_admin(uuid) owner to postgres;
alter function public.obtener_comprobante_compra_gasto_admin(uuid) owner to postgres;
alter function public.anular_comprobante_compra_gasto_admin(uuid,text) owner to postgres;
revoke all on function public.reservar_comprobante_compra_gasto_servidor(uuid,uuid,uuid,text,text,bigint,text),public.confirmar_comprobante_compra_gasto_servidor(uuid,uuid,text,bigint),public.listar_comprobantes_compra_gasto_admin(uuid),public.obtener_comprobante_compra_gasto_admin(uuid),public.anular_comprobante_compra_gasto_admin(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reservar_comprobante_compra_gasto_servidor(uuid,uuid,uuid,text,text,bigint,text),public.confirmar_comprobante_compra_gasto_servidor(uuid,uuid,text,bigint) to service_role;
grant execute on function public.listar_comprobantes_compra_gasto_admin(uuid),public.obtener_comprobante_compra_gasto_admin(uuid),public.anular_comprobante_compra_gasto_admin(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('compras-gastos-privados','compras-gastos-privados',false,3145728,array['image/jpeg','image/png','application/pdf']);
-- Ninguna policy: todos los accesos con JWT de usuarios quedan denegados.
-- Storage server-side usa el cliente privilegiado existente; contratos no se altera.
commit;
