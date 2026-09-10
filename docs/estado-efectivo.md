# Estado efectivo HUGELLA — propuesta local pendiente de revisión

No se ejecutó SQL remoto. No se modificaron autenticación, middleware, Apps Script,
variables de entorno ni el registro monetario. No aplicar el conjunto hasta revisar
las definiciones reales de producción y revisar la integración administrativa preparada en la migración 004.

## Regla oficial y fuente única

FECHA ENTREGA = fecha_inicio. La entrega cuenta como cuota 1 desde el comienzo de
ese día. Sábados cuentan; domingos no; no se excluyen feriados. La fecha comercial
se obtiene con statement_timestamp() AT TIME ZONE 'America/Argentina/Mendoza',
independientemente de la zona del servidor, sesión SQL o navegador.

Para inicio no futuro: N = fecha_evaluacion - fecha_inicio + 1.
D = día ISO de inicio (lunes=1 ... domingo=7).
Domingos en el intervalo inclusivo = floor((N + D - 1) / 7).
Exigibles = max(0, min(cantidad_cuotas, N - domingos)). Inicio futuro => 0.
La implementación es O(1), sin recorrer fechas ni depender de horas de 24h.
Los inicios válidos nunca son domingo. NULL se propaga (STRICT), no se inventa una
fecha ni un estado para datos incompletos; revisar nulos/planes inválidos antes de aplicar.

Estado, con prioridad exacta:
1. pagadas >= total => CANCELADO.
2. pagadas > exigibles => ADELANTADO.
3. pagadas = exigibles => AL DIA.
4. pagadas < exigibles => ATRASADO.

Las funciones reciben cuotas pagadas ya determinadas por la lógica monetaria.
No cuentan filas, no suman remanente nuevamente ni recalculan importes en React.

## Migraciones preparadas

1. 202609090001_estado_efectivo_helpers.sql: funciones puras de fecha, exigibles y
   estado. Sin acceso a tablas; EXECUTE limitado a anon/authenticated y propietario.
   CREATE deliberadamente falla si los nombres ya existen: inspeccionar, no sobrescribir.
2. 202609090002_creditos_estado_check.sql: conserva el nombre del CHECK histórico
   reconocido y permite los cuatro estados. Conserva datos, NULL/default y NOT NULL.
   No elimina restricciones desconocidas: falla si encuentra un tipo no text/varchar,
   múltiples CHECK, otro orden/expresión de valores u otra regla. Si no hay CHECK,
   añade uno. Los datos inválidos provocan rollback. Probar el DDL real previamente;
   el ALTER toma locks y debe planificarse según el tamaño de la tabla.
3. 202609090003_get_carton_estado_efectivo.sql: reemplaza la definición LOCAL conocida
   del cartón, conservando firma, JSON, SECURITY DEFINER y search_path vacío.
   CREATE OR REPLACE conserva dueño/grants. Comparar con definición remota ANTES
   de aplicar para no sobrescribir cambios que no estén versionados.

No se actualiza creditos.estado: sigue existiendo para compatibilidad con Sheets.
Su CHECK acepta ADELANTADO, pero la lectura web calcula su estado efectivo.

## get_carton_publico

Se factoriza sin alterar la expresión existente:
least(cantidad_cuotas, coalesce(sum(greatest(coalesce(cuotas_aplicadas,0),0))::integer,0)).
Ese único total alimenta cuotas_pagadas, pendientes y estado. El estado se obtiene
con hugella_estado_credito(total, pagadas, hugella_cuotas_exigibles(inicio,total)).
Conserva los diez campos JSON públicos y los cuatro campos de cada pago. No añade
saldo, total pagado, token, teléfono, domicilio ni datos internos. No modifica RLS
ni concede SELECT/escrituras. La UI comparte solo el badge visual, nunca el cálculo.
La consulta del cartón usa cache:no-store para no reutilizar el resultado de otro día.

## buscar_creditos_admin — migración 004 local preparada

El usuario confirmó el contrato exacto, agregado monetario, autorización, búsqueda,
GROUP BY, orden y LIMIT 20. El cuerpo SQL íntegro aún no fue pegado/versionado.
La migración 202609090004_buscar_creditos_admin_estado_efectivo.sql obtiene el DDL
instalado mediante pg_get_functiondef y ejecuta su CREATE OR REPLACE FUNCTION,
modificando exclusivamente dos partes del cuerpo:

- cr.estado::text => hugella_estado_credito(total, agregado monetario confirmado,
  hugella_cuotas_exigibles(cr.fecha_inicio,total))::text.
- cr.estado en el GROUP BY => cr.fecha_inicio.

El agregado usado por el nuevo estado es exactamente:
least(cr.cantidad_cuotas,coalesce(sum(greatest(coalesce(pg.cuotas_aplicadas,0),0))::integer,0)).
No modifica las expresiones devueltas de cuotas_pagadas/cuotas_pendientes ni ninguna
otra parte del cuerpo original. No reconstruye auth.uid(), es_admin_hugella(),
filtros, búsqueda vacía, orden, LIMIT, search_path, opciones de función o grants.

La migración valida firma/RETURNS TABLE, nombre p_busqueda, SECURITY DEFINER y que
no sea IMMUTABLE; requiere un único patrón conocido de estado y GROUP BY. Falla
sin cambios si encuentra otro formato/orden/uso de cr.estado, funciones auxiliares
faltantes o la función ya migrada. No es un parser SQL genérico. Comparar el cuerpo
real antes de ejecutar y adaptar el patrón local si fuese necesario.

Después del CREATE OR REPLACE compara toda la fila pg_proc salvo prosrc (incluyendo
OID, contrato, propietario, ACL, opciones, volatilidad y search_path). Si hay cualquier
variación, lanza una excepción y el bloque DO revierte atómicamente. No contiene
GRANT, REVOKE ni DROP para esta RPC.

El test local usa una función de referencia explícitamente identificada como fixture,
no como copia exacta del cuerpo remoto. Verifica los 10 casos solicitados, la igualdad
de todos los campos salvo estado, los bytes originales salvo las dos sustituciones,
y la igualdad de metadatos/ACL antes y después. registrar_pago_admin sigue intacta.
Hasta aplicar las migraciones aprobadas, la RPC remota conserva el estado histórico.

## Paso del tiempo y pantallas abiertas

Cada nueva consulta calcula con la fecha comercial actual, aun sin pagos. No necesita
cron ni UPDATE diario. Una pantalla ya cargada es una instantánea: para cambiar sin
interacción requeriría reconsultar al cambio de día o recuperar foco, coordinado con
el bloqueo de pagos. Esa actualización visual automática no se agregó en esta etapa.
Sheets conserva su operación actual y puede seguir mostrando su estado operativo;
no se intenta reconciliar ni sobrescribir esa información aquí.

## Pruebas locales reproducibles

Herramientas de prueba aisladas, sin agregarlas al runtime/package-lock del proyecto:

```sh
npm install --prefix /tmp/hugella-local-checks @electric-sql/pglite playwright
HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-credit-state.mjs
HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-admin-state.mjs
HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-admin-responsive.mjs
npm run lint
npm run build
git diff --check
```

Responsive usa Chrome headless, HTML de los componentes reales y Tailwind real con
fixtures largos; HUGELLA_CHROME permite indicar el ejecutable. No inicia la app ni
usa cookies, sesiones o llamadas RPC. HUGELLA_BEFORE permite comparar un snapshot
anterior de app/admin/*.tsx. La captura se guarda en /private/tmp/hugella-admin-320.png.

PGlite ejecuta PostgreSQL real en memoria con tablas ficticias y roles locales.
Casos 11/12 prueban que la lectura respeta asignaciones monetarias ya registradas:
40 con cuotas_aplicadas=0/remanente=40 y luego 70 con cuotas_aplicadas=1/remanente=10
para una cuota de 100. NO prueba el motor real de registrar_pago_admin porque falta
su definición; no es evidencia de un test extremo a extremo de Sheets/idempotencia.

## Pasos pendientes antes de producción — NO ejecutados

1. Revisar esta solución y autorizar explícitamente la inspección remota de solo lectura.
2. Obtener con preflight-estado-efectivo.sql las definiciones reales, ACL, constraints,
   tipos y triggers; guardar versión de referencia segura sin datos personales.
3. Confirmar validez de fechas/planes y correspondencia del agregado monetario en las
   RPC reales. Revisar definición actual de get_carton_publico y del CHECK.
4. Revisar la migración 004 contra el cuerpo íntegro instalado y probar su patrón;
   ya está preparada sin reconstruir el cuerpo remoto. Ajustar localmente el patrón
   o el CHECK si difieren de las definiciones inspeccionadas, sin eliminar otras reglas.
5. Probar todo en una base local/staging aislada con contratos reales y fixtures:
   permisos, pagos parciales, remanentes, idempotencia PG-/ADM- y sincronización simulada.
6. Revisar diff final, backup/rollback y ventana de locks; pedir aprobación explícita
   antes de cualquier aplicación remota.
7. Solo después de aprobación, aplicar helpers, CHECK y ambas RPC de lectura como
   entrega coordinada, conservando grants/owners. No ejecutar pagos reales de prueba.
8. Verificar lecturas autorizadas, los cuatro estados y privacidad; publicar frontend
   mediante el flujo de despliegue aprobado. Apps Script queda intacto.

## Resultado responsive y límite del diagnóstico

En fixtures de los componentes reales, ni el snapshot previo de esta etapa ni el
resultado final reprodujeron scroll horizontal en Chrome y WebKit a 320, 360, 375,
390, 414, 640, 768, 1024 y 1280px. En 320px, scrollWidth=clientWidth=320.
Por tanto no se atribuye una causa exacta al incidente reportado sin reproducirlo.

Se reforzaron puntos de dimensionado verificables: el grid móvil implícito ahora
usa una columna minmax(0,1fr); las columnas fr de resultados tienen mínimo cero;
los controles nativos/fieldset están acotados dentro de un CSS Module del Admin;
el root admite contracción. No se oculta overflow ni se truncan datos relevantes.
La prueba incluye nombres/productos/códigos/email extensos, selección y formulario.
Son motores headless con viewports pequeños, no pruebas en dispositivos físicos ni
una sesión autenticada real. La causa específica del dispositivo reportado sigue
pendiente de una reproducción con sus datos/entorno.

Para repetir WebKit (descarga e instalación local de herramienta de pruebas):

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/hugella-local-checks/browsers /tmp/hugella-local-checks/node_modules/.bin/playwright install webkit
PLAYWRIGHT_BROWSERS_PATH=/tmp/hugella-local-checks/browsers HUGELLA_ENGINE=webkit HUGELLA_TEST_DEPS=/tmp/hugella-local-checks/node_modules node scripts/test-admin-responsive.mjs
```
