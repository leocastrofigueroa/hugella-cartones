# Lote histórico aprobado de Compras

140005 fue instalada manualmente en producción por el administrador, quien
verificó 2 compras, 3 obligaciones, 0 históricas y 0 cortes. Codex no se conectó
a producción ni ejecutó el lote. La migración
`202610140005_importar_lote_compras_historicas.sql` instala infraestructura y
un registro de control sin aplicar. No crea compras, obligaciones, cortes,
pagos, aplicaciones ni períodos. No sustituye 140002–140004.

## Identidad y datos del lote

Firma pública: `public.importar_lote_compras_historicas_admin() RETURNS jsonb`.
Sin argumentos. Los 60 registros completos, sus evidencias originales y las
referencias aprobadas están embebidos en una función privada del servidor.
El navegador no envía manifiesto, UUID de actor, JWT como argumento ni importes.

Manifiesto SHA-256:
`46848e7ef677543502040b0cb37c8021549dd41f4e4f417e6b7a883fe09c4efc`.

140004 SHA-256:
`24a78e37867518043cc542bc0519360aff979e6002f105ec5e6c2cb4ea960011`.

Las identidades de operaciones son UUIDv5 deterministas, derivados del hash del
manifiesto, dominio y HG/cuota. No son UUID inventados de compras, obligaciones,
proveedores, tarjetas ni períodos. Las entidades nuevas las generan las RPC;
las obligaciones de corte se resuelven por HG y número de cuota.

Se eligieron datos embebidos frente a un payload del cliente: este lote es único,
pequeño e inmutable, y no necesita canonicalización/hash de JSON del navegador.
La prueba compara las 60 filas embebidas con el manifiesto, campo por campo.

## Seguridad y transacción

La RPC exige `auth.uid()` no NULL y `es_admin_hugella()` verdadero. Conserva el
actor de la sesión real en todas las RPC anidadas. `SECURITY DEFINER` cambia
permisos SQL, no las claims autenticadas. No establece claims ni acepta actor.

Owner postgres, search_path vacío, EXECUTE concedido sólo a authenticated y
revocado expresamente a PUBLIC/anon/service_role. Helpers sin EXECUTE para
esos cuatro roles. Control con RLS y sin políticas ni acceso directo; una vez
aplicado queda inmutable, también frente a TRUNCATE por roles de aplicación.

PostgREST ejecuta la llamada en su única transacción. Se exige READ COMMITTED.
Orden: advisory lock del lote; 294 identidades ordenadas por hash; lock financiero
global; locks SHARE ROW EXCLUSIVE de las tablas en orden fijo; clasificación;
60 RPC de compra; constraints inmediatas y validación completa sin cortes;
54 RPC de corte; constraints inmediatas, auditoría final y preservación;
comprobante de éxito. No contiene COMMIT intermedio ni captura excepciones para
continuar. Un error aborta la llamada completa.

Los locks de tabla bloquean escrituras de Compras/referencias durante la carga.
No desactivan triggers, constraints ni RLS. Debe reservarse una ventana tranquila.
La instalación verifica los cuerpos de las funciones históricas/financieras,
ACL críticas y huella PG17 de columnas/constraints/índices/triggers/RLS/ACL.
La llamada vuelve a comparar el catálogo completo capturado al instalar.

## A, B y C

- A: control sin aplicar, baseline aprobado de 2 compras/3 obligaciones,
  proveedores/tarjetas/períodos exactos, técnica anulada y estructura económica de
  impresora válidas, cero historia/cortes/pagos/aplicaciones. Además, todas las
  filas deben coincidir con el snapshot tomado al instalar. Se ejecuta el lote.
- B: control aplicado, snapshot completo idéntico al comprobante y validación
  exacta de cada compra, evidencia, obligación, período, operación y corte.
  Devuelve `YA_APLICADO_CORRECTAMENTE`, sin repetir escrituras. Otro admin también
  puede verificarlo; el actor original del lote no se reemplaza.
- C: cualquier diferencia, incluso historia preexistente sin comprobante, produce
  `RAISE EXCEPTION` y requiere revisión manual. No adopta ni completa lotes.

B es deliberadamente estricto: nuevas compras, pagos, cambios documentales,
proveedores o períodos posteriores al lote también requieren revisión manual
ante un reintento tardío. No se degrada a “ya hay 60 HG, entonces éxito”.

El comprobante conserva baseline de instalación, antes/después y actor real.
La preservación compara todas las filas iniciales columna por columna y los
incrementos exactos por tabla. No modifica impresora ni técnica anulada.

## App temporal

Ruta sin enlace en Compras: `/admin/compras/importacion-historica`.
Deshabilitada por defecto. Tras agregar el preflight, usar la variable **sólo del servidor**
`HUGELLA_IMPORTACION_COMPRAS_HISTORICAS=verificar` para mostrar sólo VERIFICAR.
IMPORTAR requiere además el modo `habilitada` y una segunda variable
`HUGELLA_EJECUTAR_LOTE_HG=habilitada`; sin ambas su POST queda cerrado.
Ver `preflight-lote-hg.md`. No se habilitó ni desplegó durante este trabajo.

Página y endpoints verifican sesión y admin. VERIFICAR usa sólo la RPC STABLE
verificar_lote_hg_admin mediante GET PostgREST y muestra el resultado read-only. POST exige mismo origen y cuerpo vacío.
Usa `utils/supabase/server`, con cookies reales y publishable key; nunca el
cliente privilegiado. Hace una sola RPC de carga, además de la consulta de
administración. Muestra IMPORTADO_CORRECTAMENTE o YA_APLICADO_CORRECTAMENTE,
los controles pequeños y los errores C. Ante respuesta perdida, reintentar
verifica B sin volver a importar. No se debe lanzar 60 llamadas desde el cliente.

La variable controla la ruta, no es una autorización adicional de la RPC SQL.
Retirar la ruta y revocar EXECUTE del importador, mediante cambio revisado,
es el cierre posterior del mecanismo. Conservar el comprobante para auditoría.

## Pruebas y límites

`python3 scripts/test-lote-compras-historicas.py` crea PostgreSQL 17 aislado en
`/private/tmp`, sólo socket local y sin cargar .env. Prueba rechazo de instalación
incompatible, auth/ACL, A/B/C, concurrencia con espera observada, alteraciones de
referencias/baseline, fallos en compra 60, corte 54 y control final, rollback de
todas las tablas incluyendo el comprobante, y controles por cada HG.

Reporte: `scripts/fixtures/compras-historicas-lote-pruebas.json`.
Prueba de app offline: `node scripts/test-admin-lote-compras-historicas.mjs`.
Regresiones SQL: `scripts/test-regresion-compras-historicas.py` (las cuatro suites
instalan también 140005). Regresiones UI existentes sin cambios.

Controles: 60 compras, 57 MERCADERIA/3 GASTO, total 17186976.43; 281 cuotas fuente,
280 obligaciones monetarias + 1 documental cero; 54 cortes; 227 pendientes fuente
= 226 monetarios + 1 documental; saldo 14259630.21; 104 períodos asignados y 176
NULL; ningún pago o aplicación nuevo. Por tarjeta: Facu 19/98/34/64/2275912.87;
Leo 39 compras, 183 fuente, 182 monetarias, 20 cortes, 162 pendientes monetarios,
1 documental y saldo 11983717.34. Débito: 2 compras/228500, sin obligaciones.

Límites antes de instalar/ejecutar con autorización posterior:

- `auth.uid()` es fixture local; `es_admin_hugella()` consulta realmente una tabla
  admin_users fixture. Falta smoke test de sesión/JWT validado y PostgREST en un
  entorno autorizado. Ninguna prueba establece claims en código productivo.
- Los campos reales de técnica, anulación, ítems, impresora, financiación y
  obligaciones suministrados manualmente se validan exactamente y se reproducen
  en el fixture. La evidencia completa de tramo/inicio fue suministrada el
  2026-10-15 y coincide: la nueva RPC preflight verifica también esos campos.
  Timestamps de otras filas no suministrados quedan preservados por snapshots. Ver
  `auditoria-baseline-real-compras-140005.md`. No se consultó producción.
- Comprobar versión PG17, huellas, baseline real y timeout de PostgREST/hosting
  antes de habilitar la ruta. Un timeout no autoriza inferir rollback: reintentar
  mediante la misma RPC para distinguir B/C.
- La huella falla cerrada ante diferencias de catálogo. Si falla, revisar;
  no sustituir hashes ni relajar prechecks para permitir la carga.
