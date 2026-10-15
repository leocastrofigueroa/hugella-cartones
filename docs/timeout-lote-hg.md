# Plazo de ejecución del lote histórico HG

Estado: implementación y medición LOCAL. No se instaló 150002, no se conectó a
producción ni se ejecutó el importador productivo. Las ejecuciones en fixtures
locales son las solicitadas expresamente para medir el lote real completo.
No se cambiaron variables Vercel, no se habilitó IMPORTAR y no hubo commit/push.

## Auditoría del límite actual

140005 declara sólo `SET search_path=''`, sin statement_timeout. 150001 comprueba
precisamente ese proconfig y el cuerpo original. SECURITY DEFINER cambia permisos,
no vuelve ilimitada la sentencia ni adopta automáticamente la configuración de
sesión del propietario postgres. La llamada REST autenticada directa al importador
original queda bajo los 8s observados en producción, mientras no cambie otra
configuración de PostgREST. No se modificó ninguna de esas funciones.

No es correcto añadir set_config('statement_timeout','45s',true) dentro del cuerpo
como supuesto reinicio del contador. Tampoco el SET propio de una función,
invocada desde SQL con una sentencia cuyo timer ya arrancó, prolonga ese timer.
Las pruebas locales lo demuestran con una función SECURITY DEFINER que anuncia
2s pero cancela bajo una sentencia de 100ms.

PostgREST puede hoistar `statement_timeout` del proconfig de la RPC pedida,
aplicándolo a la transacción ANTES de iniciar la sentencia principal. Ese es
el mecanismo utilizado, condicionado a la versión/configuración del servidor.
No se confunde con el comportamiento de PostgreSQL al entrar en una función.

Fuentes primarias:

- https://docs.postgrest.org/en/stable/references/transactions.html#hoisted-function-settings
- https://docs.postgrest.org/en/stable/references/configuration.html#db-hoisted-tx-settings
- https://supabase.com/docs/guides/database/postgres/timeouts

## Medición reproducible

`python3 scripts/test-tiempo-lote-hg.py` crea PostgreSQL 17 temporal sólo con socket
privado. Diez copias nuevas del baseline, una transacción real A con SELECT+COMMIT
por copia; cinco mediciones B y rechazo C. Incluye las 60 importaciones, 280
obligaciones, 54 cortes, evidencia, asignaciones, validadores y postchecks de 140005.
La compilación de funciones de cada sesión está incluida. Se excluyen crear la
copia de DB y arrancar psql. Se registran por separado SELECT, cierre y wall time.
No carga .env ni credenciales remotas; no son estimaciones de loops en Python.

Reporte: `scripts/fixtures/tiempo-lote-hg.json`. La muestra medida en este equipo
Mac aarch64/PostgreSQL 17.11 dio mínimo 0.235499s, promedio 0.302943s, máximo
0.725497s, margen mínimo 7.274503s respecto de 8s. Son diez COMMIT reales locales,
no una predicción de CPU, carga, disco, locks, pool o gateway productivos.

8s NO es una garantía robusta para producción. Un lock retenido por otra operación
puede consumir ese margen sin que el lote esté procesando filas. Preparar una
ventana sin escrituras concurrentes sigue siendo necesario.

## Solución específica, sin alterar la huella

Nueva migración `202610150002_plazo_lote_hg.sql`, infraestructura solamente:

- `public.ejecutar_lote_hg_admin() RETURNS jsonb`: wrapper sin parámetros, VOLATILE,
  SECURITY DEFINER, search_path vacío y SET statement_timeout='45s'. Exige auth.uid,
  rol JWT authenticated y es_admin_hugella. Delega una vez en 140005, conservando
  actor, transacción, locks, A/B/C y todas las validaciones. No copia su lógica.
- `public.verificar_plazo_hg_admin() RETURNS jsonb`: STABLE/read-only, mismos controles
  y configuración de 45s. Primero hace el preflight original; si A/B es válido
  espera 9s y devuelve SUPERADA_9S, duración y timeout observado. C se devuelve sin
  esperar. No recibe duración arbitraria ni puede importar.

Ambas funciones sólo tienen EXECUTE para authenticated y propietario postgres;
PUBLIC, anon y service_role están revocados. Ningún permiso del helper privado
cambia. Los dos nombres quedan fuera del filtro de catálogo de 140005. Se verifica
igualdad del catálogo al instalar; no se actualiza el control/snapshot para
acomodarlas. No se cambia rol authenticated, base de datos ni otras compras.

La app llamará al NUEVO wrapper como RPC REST de nivel superior. Llamar directamente
a 140005 sigue teniendo el presupuesto original de 8s; un wrapper anidado debajo
de una RPC sin ese ajuste no serviría para hoistar 45s. No añadir ALTER FUNCTION
al importador original: alteraría la huella y el preflight 150001 lo rechazaría.

## Prueba real local de PostgREST

`python3 scripts/test-timeout-postgrest-hg.py` requiere un binario oficial local
(HG_POSTGREST_BIN; probado PostgREST 16.4 macOS aarch64). El binario se obtuvo de la
publicación oficial en github.com/PostgREST/postgrest, fuera del repo, en /tmp.
PostgreSQL usa socket privado, HTTP sólo 127.0.0.1. JWT firmados con un secreto
local efímero, nunca autenticación ni claves productivas.

Demostrado:

- Preflight original por HTTP autentica y observa 8s/read-only.
- SET dentro del cuerpo no evita cancelación a los 8s y revierte su escritura.
- GET de la nueva prueba supera 9s y observa 45s/read-only: hoisting real, no un
  cambio meramente cosmético de current_setting dentro de una función.
- Cancelación tardía local revierte 60 compras + 53 cortes + comprobante de lote.
- Tres lotes REST con rollback vuelven exactamente al baseline.
- COMMIT local completo, respuesta descartada, preflight B y reintento sin cambios.
- No-admin, anónimo y service_role rechazados. C falla cerrado.
- La instalación no cambia datos, control, catálogo ni los archivos aprobados.

Reporte: `scripts/fixtures/timeout-postgrest-hg.json`.

Esto acredita el mecanismo en PostgREST local con hoisting habilitado por defecto,
no su configuración productiva. Antes de habilitar carga falta una prueba futura
REAL de sólo lectura de 9s y confirmar los límites del despliegue.

## Tres límites distintos

1. PostgreSQL: original 8s; wrapper solicitado 45s si PostgREST lo aplica antes de
   la sentencia. Cancelación SQL produce rollback de la transacción.
2. PostgREST/gateway: puede haber espera de pool y límites HTTP independientes.
   Supabase documenta límite configurable de 60s para Dashboard/Client; no se
   inspeccionó el proyecto real. Aumentar SQL no elimina límites de transporte.
3. Vercel: se solicita `export const maxDuration = 60` sólo en ejecutar y
   verificar-plazo, sin configuración global. Su efectividad depende del plan y
   deployment real; no puede confirmarse localmente. 45s SQL deja margen solicitado
   de 15s para transporte, pero no garantiza la duración total ante colas externas.

No se modificó Vercel ni se desplegaron esas declaraciones. IMPORTAR conserva las
dos variables de servidor y continúa cerrado con modo verificar y segunda ausente.
El botón VERIFICAR normal sigue usando 150001, y seguirá mostrando 8s: es correcto.

La nueva ruta GET `/admin/compras/importacion-historica/verificar-plazo` se preparó
para una futura prueba manual de sólo lectura con la sesión real. No se llama
al abrir la página ni se ejecutó en producción. No acepta parámetros y requiere
modo verificar/habilitada; no puede llamar al importador. Solicita 60s al hosting.

9s demuestra superar 8s, no acredita por sí solo un presupuesto de 45s en todas
las capas. Confirmar duración efectiva del hosting >=60s y configuración/versión
PostgREST compatible. Si falla la prueba o los límites no son compatibles: NO-GO;
no ampliar timeouts globales ni debilitar validaciones para continuar.

## Recuperación y autorización pendiente

Ante respuesta perdida NO asumir rollback ni reintentar automáticamente. Esperar
la finalización de la ventana de ejecución y consultar el preflight original:

- B: YA_APLICADO_CORRECTAMENTE; no volver a cargar.
- C: STOP y revisión manual; no completar ni reparar.
- A: no hay lote confirmado visible; una ejecución anterior podría seguir en
  curso si se consulta demasiado pronto. Sólo reintento explícito tras resolver
  esa ventana; el lock y la idempotencia del importador evitan duplicados aun
  frente a una primera llamada que confirme mientras espera el reintento.

Un fallo de SQL confirmado (57014) revierte todo; un error HTTP/cliente no permite
inferir si hubo COMMIT. Un error del propio preflight tampoco acredita A.

GO para revisión de 150002 local. NO-GO para habilitar IMPORTAR todavía.
Próximo paso propuesto: revisar y aprobar la infraestructura específica de plazo;
instalación, deploy y probe real read-only requieren autorización posterior.
