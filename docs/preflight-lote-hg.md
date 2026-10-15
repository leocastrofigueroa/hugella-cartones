# Preflight autenticado del lote HG

Implementado y probado sólo localmente. No instalado en producción por Codex;
no se ejecutó el importador de lote, ni siquiera en los tests de este cambio.

## Baseline real cerrado

La fila completa del tramo suministrada manualmente coincide con 140005:
362fba80-fa95-49ff-8514-22dbf1627c2d, compra impresora 7171c5cb-90dc-4a41-a470-29b207bc2895,
posición 1, TARJETA_CREDITO, importe 343499, Visa Leo, 3 cuotas, fecha_pago NULL,
estrategia NORMAL y valor histórico NULL. El created_at real es
2026-10-11 20:49:42.7306+00. El inicio coincide con Leo orden 2, actor
34366896-c76c-4959-ac05-519274da9736 y created_at 2026-10-11 20:49:42.738671+00.

140005 no hardcodea posición/timestamp de tramo ni actor/timestamp de inicio:
los preserva mediante snapshot completo. El nuevo preflight verifica también
esos campos contra la evidencia real, sin modificar 140005. El baseline real
necesario está completo según la evidencia del administrador; la futura llamada
read-only comprobará su vigencia, sin sustituir una verificación de producción
que Codex no realizó.

SHA 140005 inmutable:
`d27d59c450da90b2c2f149b75dd259e50f362c67bd8175e96fdb51c593b992b9`.

## Infraestructura separada

`202610150001_preflight_lote_compras_historicas.sql` crea sólo
`public.verificar_lote_hg_admin() RETURNS jsonb`.

Nombre excluido de los filtros exactos del catálogo de 140005 (%compra%,
%tarjeta%, %historica%, es_admin_hugella). No crea tablas, no modifica funciones,
ACL/configuración anteriores, ni snapshots/control de 140005. Comprueba igualdad
de la huella antes y después de instalar. NOTIFY pgrst actualiza sólo caché de
esquema tras confirmar la instalación; no importa datos.

Función STABLE, SECURITY DEFINER, owner postgres y search_path vacío. EXECUTE
revocado a PUBLIC/anon/authenticated/service_role y concedido sólo a authenticated.
Exige auth.uid no NULL, auth.role() = authenticated y es_admin_hugella verdadero.
No recibe argumentos, actor, JWT ni payload; no configura claims ni timeouts.
La identidad proviene del JWT validado por PostgREST en la futura llamada real.

El cuerpo y los helpers de lectura reutilizados no contienen DML ni invocan el
importador de lote. No toman locks de escritura ni reservan el baseline. La app
solicita GET de PostgREST, que ejecuta la RPC STABLE en transacción READ ONLY.
La comprobación es informativa en ese momento: el importador conserva todos
sus controles y locks al ejecutarse en una acción posterior autorizada.

Comprueba catálogo, firma/cuerpo exactos y ACL del importador, baseline A de
140005, tramo/inicio completos y snapshot inicial. Para B compara snapshot final
y valida todos los datos/operaciones/cortes con el actor original. No repara,
adopta ni completa estados parciales. Los rechazos de autenticación son 42501;
las inconsistencias conocidas se devuelven como diagnóstico para el administrador.

Respuesta pequeña:

- estado_lote: LISTO_PARA_IMPORTAR / YA_APLICADO_CORRECTAMENTE / PARCIAL_O_INCONSISTENTE.
- actor_id, administrador, rol_jwt, solo_lectura y diagnostico.
- statement_timeout y transaction_read_only observados en la solicitud.

Estos datos se leen mediante current_setting; no se modifica la configuración.
El timeout observado es el del contexto de esta solicitud autenticada. Si cambia
la configuración después, debe verificarse de nuevo. No acredita el límite del
hosting ni el tiempo que tardará el importador. No prueba por sí solo que la
caché de PostgREST del importador esté resuelta: sí verifica su firma/ACL en BD;
el futuro GET exitoso acredita la resolución del preflight por PostgREST.

## App en dos etapas

Ruta: `/admin/compras/importacion-historica`, sin enlace permanente en Compras.

Configuración de servidor para un futuro despliegue de SÓLO VERIFICAR:

```text
HUGELLA_IMPORTACION_COMPRAS_HISTORICAS=verificar
```

Dejar `HUGELLA_EJECUTAR_LOTE_HG` sin definir. No se cambió ningún entorno real.
Mantener NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY existentes.
Nunca agregar service_role como sustituto de la sesión.

Página y endpoints usan cookies/sesión reales con utils/supabase/server.
VERIFICAR llama GET `/admin/compras/importacion-historica/verificar`, sin parámetros;
ese endpoint hace sólo `rpc('verificar_lote_hg_admin', undefined, {get:true})`.
El resultado no se cachea y la UI exige admin/JWT y transaction_read_only=on.
Muestra usuario/admin, estado, diagnóstico, timeout y que no modificó datos.

IMPORTAR permanece deshabilitado incluso con el valor antiguo `habilitada` en
la primera variable. Requiere AMBAS variables de servidor:

```text
HUGELLA_IMPORTACION_COMPRAS_HISTORICAS=habilitada
HUGELLA_EJECUTAR_LOTE_HG=habilitada
```

No se habilitaron. Estas variables cierran la ruta de la app; no revocan la
RPC SQL de 140005, que conserva su autorización administrativa original.
POST /ejecutar comprueba ambas antes de cualquier RPC, exige
mismo origen/cuerpo vacío y vuelve a validar sesión/admin. Cambiar props, DOM,
query o JSON del cliente no abre el endpoint. La UI además exige preflight LISTO
antes de habilitar su botón IMPORTAR. B/C nunca lo habilitan. Ante respuesta
incierta de una futura carga, VERIFICAR permite distinguir A/B/C sin importar.

## Timeout y hosting

El repo no define maxDuration, configuración Vercel/otro hosting, ni timeout/abort
propio para estas rutas. next.config.ts está vacío de esas opciones. La guía local
de Next permite maxDuration pero su aplicación depende del despliegue. El logo
vercel.svg no acredita proveedor ni plan. No puede conocerse el límite real del
hosting localmente y no se cambió ninguno.

No se modificó statement_timeout ni proconfig del importador; hacerlo directamente
cambiaría la huella de 140005. La futura ejecución 60+54+postchecks necesita aún
validar presupuesto efectivo y margen de timeout. Un timeout SQL aborta la
transacción; una respuesta perdida del cliente/hosting deja el COMMIT incierto.
No inferir rollback de un error de transporte: consultar VERIFICAR. La consulta
B estricta puede exigir revisión si hubo operaciones legítimas posteriores.

## Pruebas locales

`python3 scripts/test-preflight-hg.py`: PostgreSQL 17 aislado sin TCP, sin .env
remotas. Fixtures auth.uid/role y membership real en admin_users fixture.
Compara TODAS las tablas públicas y la huella/control antes/después de instalar,
y todas las tablas antes/después de cada preflight. A y B se prueban en
BEGIN READ ONLY. No se llama importar_lote_compras_historicas_admin.

B se prepara sólo como fixture local usando las RPC individuales históricas y
de corte, más el comprobante de fixture. Las pruebas del preflight no escriben
ese fixture. Un segundo PostgreSQL fixture siembra un timestamp de tramo
incorrecto antes de confirmar: el preflight detecta C sin desactivar defensas.

Reporte: `scripts/fixtures/preflight-hg-pruebas.json`.
App offline: `node scripts/test-admin-lote-compras-historicas.mjs` (importador sólo
mock; ningún servicio remoto). Las cuatro regresiones existentes instalan la
nueva migración y verifican compras normales sin llamar al importador de lote.

Próxima acción recomendada tras revisar/autorizar: instalar manualmente sólo
202610150001. El despliegue y la prueba autenticada real read-only son posteriores;
no se realizaron, ni se hizo commit/push.
