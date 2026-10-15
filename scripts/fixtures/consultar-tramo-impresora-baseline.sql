-- SOLO LECTURA. Preparado para revisión manual; NO ejecutado contra producción.
-- Completa los campos no suministrados. No infiere ni crea ningún hecho.
begin read only;
select * from public.tramos_pago_compras
where id='362fba80-fa95-49ff-8514-22dbf1627c2d';
select * from public.inicios_tramos_tarjeta
where tramo_id='362fba80-fa95-49ff-8514-22dbf1627c2d';
rollback;
