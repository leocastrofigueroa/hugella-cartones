# Cancelaciones financieras y devoluciones de tarjetas

La migración `202610260001_devoluciones_tarjetas_base.sql` ya está aplicada y no se modificó en este trabajo. `202610260002_integrar_devoluciones_finanzas.sql` está pendiente: contiene vistas, RPC, permisos y un preflight que rechaza definiciones distintas del baseline revisado. No carga ni actualiza datos de negocio. No se ejecutó en Supabase.

## Uso administrativo

Desde el detalle de una compra con financiación confirmada:

- **Cancelar compra / cuotas futuras** registra fecha, motivo y actor. La selección explícita de cuotas es definitiva para esa cancelación. Sólo acepta cuotas de esa compra, sin pagos ni cortes, sin período o con cierre posterior a la fecha indicada. Sin seleccionar cuotas registra el hecho de cancelación, conservando toda la deuda. Las cuotas no seleccionadas continúan pendientes.
- **Registrar devolución esperada** reserva un importe de un tramo de tarjeta. No reduce ningún saldo. Puede registrarse aunque no se haya cancelado la compra completa.
- **Acreditar devolución recibida** registra únicamente lo que apareció efectivamente en el resumen elegido de esa tarjeta. Permite acreditaciones parciales, conserva referencia e historial y rechaza exceder lo esperado.

La suma de cuotas canceladas y devoluciones esperadas no puede superar el importe original del tramo. Esto evita devolver nuevamente la porción de compra que ya dejó de cobrarse. Las solicitudes de devolución existentes, incluso canceladas, conservan su reserva: no se habilitan correcciones automáticas de hechos históricos.

Una compra cancelada puede conservar cuotas pendientes. CANCELADA expresa el hecho de la compra; cada cuota muestra su propio estado. PAGADA y los saldos cerrados por crédito no convierten ese crédito en pago real. Los importes reales pagados y los cortes se muestran separados. Las compras documentales mantienen evidencia y saldo cero, sin acciones financieras.

## Cálculo y compatibilidad

1. La obligación parte del importe original menos cortes y aplicaciones de pagos reales. Anulaciones y cuotas canceladas tienen saldo operativo cero.
2. Sólo las **acreditaciones reales** generan crédito en su período. El excedente se arrastra a períodos posteriores de la misma tarjeta por orden registrado.
3. El crédito se distribuye de forma determinista entre obligaciones. Calendario y proyección consumen esta misma vista; no vuelven a restar devoluciones.
4. El pago se limita al saldo neto del resumen y se aplica a obligaciones brutas remanentes, conservando las aplicaciones reales. Aplicarlo a la distribución neta ya descontada y volver a descontar crédito duplicaría ajustes.

Se mantienen las firmas anteriores. El listado ampliado usa una nueva RPC y el parámetro optativo `financiero=1`; la consulta previa de resúmenes conserva su contrato. El detalle agrega `financiacion`. Las operaciones nuevas reutilizan autorización administrativa, lock global de escrituras e idempotencia por UUID, actor y solicitud. Ante resultado incierto, la interfaz congela la solicitud y permite reintentar exactamente el mismo UUID. Los errores definitivos permiten corregir los datos. La anulación técnica se rechaza si ya hay cancelaciones o devoluciones financieras.

## Verificación local

Sin archivos `.env`, credenciales ni datos productivos:

```sh
node scripts/test-devoluciones-finanzas.mjs
node scripts/test-admin-devoluciones.mjs
node scripts/test-admin-pagos-resumenes.mjs
node scripts/test-admin-compras.mjs
node scripts/test-admin-anulacion-compras.mjs
node scripts/test-admin-tarjetas.mjs
npx tsc --noEmit
```

Resultado local: 38 grupos SQL, 20 grupos nuevos de interfaz/API y 117 grupos de las suites existentes de compras, anulaciones, tarjetas y pagos aprobados. TypeScript, ESLint de los archivos afectados y `git diff --check` aprobados. El build Next.js completo pasó en una copia temporal sin `.env`, con configuración Supabase sintética de localhost; no usó credenciales ni contactó producción.

La suite SQL instala migraciones reales y ejecuta funciones, triggers, permisos, rollback, resúmenes, detalle, calendario y proyección en PGlite. Sólo omite fingerprints de catálogo dependientes del major de PostgreSQL en migraciones **anteriores**; el preflight de la migración nueva se ejecuta íntegro. La cobranza ajena a tarjetas se representa con tablas/vista vacías. La suite React/API ejecuta componentes y handlers reales con sesión, RPC y HTTP simulados.

Limitaciones: PGlite serializa conexiones; no sustituye una prueba de contención entre sesiones PostgreSQL independientes. Los escenarios de navegador son JSDOM, sin emisor bancario ni integración remota. Las referencias históricas fijas requeridas por CHECK se usan sólo como discriminadores de fixtures inventadas. No se leen exportaciones ni diagnósticos de producción.

## Verificación posterior del rendimiento

El bloqueo del listado de 60 resúmenes quedó resuelto con un cálculo compartido por conjuntos. El ensayo nativo con el mismo dataset bajó de 19.484,578 ms a 81,492 ms de mediana, sin cambios de importes ni estados en 736 períodos. Recomendación local vigente: PUBLICABLE. Evidencia y límites en [rendimiento-resumenes.md](rendimiento-resumenes.md).

## Publicación pendiente

1. Revisar exclusivamente los archivos de este cambio, separándolos de modificaciones locales preexistentes. No volver a aplicar `202610260001` ni incluir cargas históricas ajenas.
2. En un entorno aislado de PostgreSQL compatible, validar el baseline y ejecutar `202610260002` con datos sintéticos. Verificar además contención entre pago/acreditación/cancelación desde sesiones distintas y costo del recorrido de períodos con volumen representativo.
3. Si el preflight falla, detener la publicación y revisar la diferencia; no quitar la protección para forzar la instalación.
4. Aplicar la migración pendiente mediante el proceso habitual del operador y después desplegar Next.js. La aplicación nueva depende de las nuevas RPC y debe publicarse después del SQL.
5. Verificar el detalle, las tres acciones, resúmenes, calendario y proyección con fixtures. No usar compras reales como pruebas. Si hay que retirar la interfaz, conservar los hechos financieros y las vistas que los contabilizan; no revertir tablas ni pagos.

Este trabajo no ejecuta estos pasos de publicación, migraciones remotas ni `git push`.

## Archivos de este cambio

- `supabase/migrations/202610260002_integrar_devoluciones_finanzas.sql`
- `app/admin/compras/financial-actions.tsx` (nuevo)
- `app/admin/compras/purchases-view.tsx`
- `app/admin/compras/purchase-types.ts`
- `app/admin/compras/cards-view.tsx`
- `app/admin/calendario-financiero/page.tsx`
- `app/api/admin/compras/[id]/finanzas/route.ts` (nuevo)
- `app/api/admin/compras/handlers.ts`
- `scripts/test-devoluciones-finanzas.mjs` (nuevo)
- `scripts/test-admin-devoluciones.mjs` (nuevo)
- `docs/devoluciones-tarjetas.md` (nuevo)

La migración base y los archivos locales ajenos al trabajo se conservaron.
