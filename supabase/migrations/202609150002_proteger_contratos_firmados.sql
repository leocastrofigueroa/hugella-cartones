begin;

create or replace function public.proteger_contrato_firmado()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if old.estado = 'FIRMADO' then
        raise exception using
            errcode = '55000',
            message = 'Un contrato firmado no puede modificarse ni eliminarse.';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

drop trigger if exists proteger_contrato_firmado
on public.contratos;

create trigger proteger_contrato_firmado
before update or delete
on public.contratos
for each row
execute function public.proteger_contrato_firmado();

commit;