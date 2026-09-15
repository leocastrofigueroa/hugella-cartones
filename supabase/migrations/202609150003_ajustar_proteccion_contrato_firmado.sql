begin;

create or replace function public.proteger_contrato_firmado()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    /*
     * Un contrato que alguna vez fue firmado nunca puede eliminarse.
     * Usamos firmado_at y no solamente estado='FIRMADO' para que
     * la protección continúe incluso si en el futuro pasa a
     * REVOCADO o ANULADO.
     */
    if tg_op = 'DELETE' then
        if old.firmado_at is not null then
            raise exception using
                errcode = '55000',
                message = 'Un contrato firmado no puede eliminarse.';
        end if;

        return old;
    end if;

    /*
     * Una vez firmado, todos los datos aceptados por el cliente
     * quedan congelados.
     *
     * Por ahora solamente permitimos:
     * - registrar el PDF final;
     * - actualizar updated_at.
     *
     * Los futuros flujos de revocación/anulación se habilitarán
     * explícitamente cuando estén implementados.
     */
    if old.firmado_at is not null then

        if (
            to_jsonb(new)
                - array['pdf_ruta', 'pdf_sha256', 'updated_at']
        ) is distinct from (
            to_jsonb(old)
                - array['pdf_ruta', 'pdf_sha256', 'updated_at']
        ) then
            raise exception using
                errcode = '55000',
                message = 'Los datos de un contrato firmado no pueden modificarse.';
        end if;

        /*
         * Ruta y hash del PDF deben registrarse juntos.
         */
        if (new.pdf_ruta is null) <> (new.pdf_sha256 is null) then
            raise exception using
                errcode = '55000',
                message = 'La ruta y el hash del PDF deben registrarse juntos.';
        end if;

        /*
         * Cuando el PDF final ya fue registrado, tampoco puede
         * reemplazarse ni eliminarse.
         */
        if old.pdf_ruta is not null or old.pdf_sha256 is not null then
            if new.pdf_ruta is distinct from old.pdf_ruta
               or new.pdf_sha256 is distinct from old.pdf_sha256 then
                raise exception using
                    errcode = '55000',
                    message = 'El PDF final de un contrato firmado no puede reemplazarse.';
            end if;
        end if;
    end if;

    return new;
end;
$$;

commit;