# Cierres DEVUELTO / RETIRADO — implementación local, sin desplegar

No se ejecutó ninguna migración en Supabase ni se modificaron datos de producción.
Los cambios previos de ordenamiento en `Supabase.gs` y
`scripts/test-apps-script-payment-row-reuse.mjs` son independientes: no se editaron
como parte de este trabajo. No se deben incluir al preparar la entrega de cierres.

## Modelo y límites

`cierres_creditos` contiene un registro inmutable por crédito: UUID de operación,
tipo, fecha efectiva, motivo, observaciones, actor autenticado y hora del servidor.
RLS habilitada sin acceso directo para anon/authenticated. Las RPC administrativas
verifican `auth.uid()` y `es_admin_hugella()`. No hay reapertura en esta etapa.
Los reintentos con el mismo UUID, actor y contenido devuelven el cierre existente;
un cierre diferente se rechaza. No hay borrado de créditos ni escrituras a pagos
al cerrar, ni eventos en `eventos_pagos_sheets`.

Se conserva `creditos.estado` como estado financiero derivado de los pagos, con
su CHECK actual. Puede seguir siendo ATRASADO internamente: **no es el estado
operativo de un crédito cerrado**. `buscar_creditos_admin` y
`recalcular_pagos_credito` dan prioridad al cierre y devuelven DEVUELTO/RETIRADO y
cero cuotas pendientes de cobro. El Admin muestra aparte las cuotas originales
no pagadas, sin transformarlas en cuotas pagadas. Las RPC originales se conservan
en copias internas `hugella_base_*`, sin EXECUTE para roles de aplicación; las
firmas, OID, owner y ACL de las RPC existentes permanecen iguales.

No consultar `creditos.estado` ni `cantidad_cuotas - cuotas_pagadas` aisladamente
para proyectar cobros: para un crédito con cierre la contribución operativa es
cero. No se modifica `hugella_estado_credito`, que sigue siendo el cálculo
puramente financiero. Los consumidores nuevos deben usar el cierre separado.
Las futuras migraciones del motor monetario/búsqueda deben revisar también las
copias internas: reemplazar solo el wrapper podría omitir el cierre.

La fecha es comercial y diaria (Mendoza). Se admiten cierres desde la entrega
hasta hoy, pero no antes de un pago válido ya existente. Un pago histórico cargado
tarde puede tener fecha anterior o igual al cierre; no se admite fecha posterior,
incluidas importaciones y cambios de fecha/crédito/estado del pago. Esto conserva
los cobros del mismo día; no intenta inferir una hora de pago que el sistema no
registra. CANCELADO por pago completo mantiene su significado y comportamiento
público anteriores mientras no se registre explícitamente un cierre de mercadería.
Si se cierra un crédito ya pagado, su dinero y cuotas pagadas también se conservan.

El crédito y sus pagos siguen disponibles en el Admin. Se filtran cierres antes
del ORDER/LIMIT de `acceder_creditos_cliente` y de la selección por token en
`get_carton_publico`: otro crédito del cliente no queda oculto por el límite.
El token cerrado produce la vista existente de cartón no disponible. La lista
pública revalida los tokens guardados al cargar y recuperar el foco; una lista
vacía indica que no hay créditos activos disponibles. No se exponen motivo,
observaciones ni actor en consultas públicas. Un fallo de revalidación no muestra
los datos guardados como si estuvieran vigentes.

## Google Sheets: fuentes y cambios preparados

Se añade `CierresCreditos.gs` al mismo proyecto Apps Script que `Supabase.gs`.
Reutiliza su autenticación, RPC y ScriptLock, sin editarlo. La RPC
`obtener_cierres_creditos_sheets` exporta un snapshot paginado (500 por página)
con ID, código, tipo y fecha. No usa el RETIRAR de pagos, no marca pagos y no usa
una cola nueva: repetir el snapshot es seguro y repara fórmulas operativas.

La hoja técnica nueva `Cierres de créditos` tiene A=ID CREDITO, B=TIPO CIERRE,
C=FECHA CIERRE. No incluye motivos privados. El script primero obtiene todas las
páginas y valida destinos e identidades. Si falta un crédito en Mercadería, hay
IDs duplicados, una respuesta inválida o falta la configuración, aborta. Un
snapshot que pierda o cambie cierres ya reflejados tampoco borra el espejo.
Las escrituras a Sheets no son transaccionales; si falla una escritura intermedia,
se debe reejecutar hasta completar. No hay una confirmación remota que impida el
reintento.

- **Mercadería T**: se instala la fórmula proporcionada por el usuario, precedida
  por la consulta al espejo: si el código tiene cierre, devuelve CANCELADO. La
  columna ID CREDITO se resuelve por encabezado, no se presupone su letra.
- **L, I, H, N, O, K, S y Q**: no se escriben. Se conserva el plan y el histórico.
  N sigue representando I-L y O sigue representando H*N; **O deja de ser una
  fuente válida de capital cobrable si se suma sin excluir cierres**.
- **Capital pendiente de Resumen/Dashboard**: SUMPRODUCT de O únicamente para
  códigos sin cierre y no vacíos.
- **Ganancia esperada**: SUMPRODUCT de K únicamente para códigos sin cierre y no
  vacíos. Conserva la definición original J-G para los demás créditos, incluidos
  los pagados completamente. No calcula una ganancia realizada sobre el dinero
  histórico ni una liquidación del bien recuperado.
- **Activos y atrasados**: COUNTIF de T con los mismos criterios aportados.
- Indicadores adicionales disponibles: `cuotas_pendientes` (N sin cierres),
  `cuotas_atrasadas` (máximo de S-L y cero, sin cierres), `importe_atrasado`
  (cuotas atrasadas por H, sin cierres). S puede continuar calculando el cronograma
  original, pero no debe alimentar mora activa de un cierre sin esta exclusión.
- **Recaudación estimada / proyección**: después de actualizar T se llama a
  `actualizarRecaudacionEstimada()` si está definida; su filtro de T excluye los
  cierres, según la verificación aportada por el usuario. Su código no está en el
  repositorio: queda pendiente contrastarlo en el Apps Script completo.
- **Calendario Financiero**: no se lee ni escribe; corresponde a obligaciones
  de HUGELLA, no a las cuotas de clientes.
- **Registro de cobros**: no se lee ni escribe por la sincronización de cierres.
  C/D/F y sus ARRAYFORMULA no se tocan. Los pagos previos siguen siendo recaudación
  histórica y no se excluyen de reportes de dinero efectivamente cobrado.

Las fórmulas generadas usan nombres en inglés y comas para la API de Apps Script.
Los indicadores usan rangos hasta la última fila leída; se actualizan en cada
sincronización. Si se agregan créditos/filas, debe ejecutarse el adaptador para
extender esos rangos y la fórmula T a las nuevas filas.

### Configuración necesaria, sin inventar direcciones

No están versionadas las posiciones de los indicadores en Resumen y Dashboard.
Configurar la Script Property `CIERRES_INDICADORES_SHEETS` como un array JSON de
objetos `{ "hoja": "Resumen", "celda": "<celda A1 real>",
"indicador": "capital_pendiente" }`.

Se requieren los cuatro indicadores `capital_pendiente`, `ganancia_esperada`,
`creditos_activos`, `creditos_atrasados` para **cada** hoja (`Resumen`, `Dashboard`).
Si Dashboard tiene más de una celda para un indicador, se pueden registrar varias.
Agregar también los tres indicadores opcionales si existen en el tablero.
No ejecutar con el marcador `<celda A1 real>`: identificar las celdas verdaderas
antes. El script rechaza direcciones inválidas, repetidas y otras hojas. No asigna
celdas arbitrarias ni modifica automáticamente hojas desconocidas.

### Instalación pendiente (ningún paso ejecutado)

1. La comparación completa de `public.anular_pago_admin(uuid,uuid,text)` ya está
   realizada contra el CSV real aportado por el usuario. El cuerpo real tiene dos
   espacios adicionales al inicio de cada línea no vacía, incluidos los espacios
   finales antes del delimitador; al retirarlos coincide exactamente con el cuerpo
   versionado. No hay diferencias de lógica. MD5 versionado:
   `1977ba3b23036996d80fa0518bc6d4f6`; MD5 real:
   `9d9fdcb08ff9ffc9010e35c3ce43f59f`. La guarda y el bloque de reemplazo ahora usan
   exactamente el cuerpo real, sin normalizar espacios ni aceptar fuentes distintas.
   La definición y sus metadatos se conservan en el fixture
   `supabase/tests/anular_pago_admin_real_20261001.json`, independiente del CSV
   temporal. Se verificaron firma/retorno, propietario postgres, EXECUTE solo para
   postgres/authenticated, PL/pgSQL, SECURITY DEFINER, VOLATILE y search_path vacío.
   El parche conserva todos los metadatos/ACL; en reintentos lee
   `coalesce(c.tipo, cr.estado::text)` mediante LEFT JOIN con cierres, sin recalcular
   ni escribir pagos o el estado financiero. Ya están disponibles
   las seis definiciones exportadas en `supabase_rpc_real.csv` y su copia JSON
   `supabase/tests/rpc_real_20261001.json`: `buscar_creditos_admin`,
   `recalcular_pagos_credito`, `acceder_creditos_cliente`, `get_carton_publico`,
   `es_admin_hugella` y `hugella_fecha_comercial`. El test carga esos cuerpos
   literalmente y comprueba sus metadatos/ACL. Los demás escritores de pagos se
   toman de las migraciones versionadas, no de un export de producción. Los dos
   CSV de diagnóstico están excluidos por `.gitignore` y no deben incluirse en
   commits. Queda ejecutar las pruebas SQL del parche con el cuerpo real; PGlite
   no está disponible y no se instalaron dependencias para esta revisión. Además,
   queda revisar el importador de créditos y los triggers instalados. La migración
   aborta y revierte ante firmas/formas inesperadas.
2. Probar la migración nueva en staging con las migraciones anteriores aprobadas.
   Verificar que nadie tenga una política/grant alternativo que exponga créditos
   o pagos directamente en la vista pública. No conceder acceso a los helpers
   internos ni a `cierres_creditos` para eludir las RPC.
3. Revisar la planilla y el Apps Script completo, particularmente
   `actualizarTodosLosCreditosDesdeCobros()`, sus triggers/onEdit y los destinos
   reales del Dashboard/Resumen. Respaldar las fórmulas. Completar la propiedad
   indicada y probar el adaptador sobre una copia de la planilla.
4. Integrar los puntos de entrada existentes con los wrappers preparados:
   `sincronizarPagosAdminYCierresHaciaSheets`,
   `sincronizarTodosLosCreditosYCierresASupabase` y
   `actualizarTodosLosCreditosConCierres`. El último requiere la función original
   que falta en este repositorio. Todo flujo externo que regenere T debe terminar
   aplicando cierres; no basta con un trigger antiguo que siga sobrescribiéndola.
   Programar además `sincronizarCierresCreditosHaciaSheets` para que un cierre nuevo
   llegue a Sheets aunque no se publique ningún pago. No se instalan triggers desde
   este código ni se presupone su frecuencia actual.
5. Revisar toda fórmula/proyección adicional que sume N/O/S/K sin considerar el
   espejo. La exclusión está implementada para los indicadores aportados; no se
   puede certificar una hoja/fórmula que no fue entregada. Las sumas de cobros reales
   deben seguir usando pagos, sin excluirlos por el cierre del crédito.
6. Solo en una futura instalación autorizada, aplicar la migración, desplegar el
   Admin/vista pública y copiar/configurar el Apps Script de forma coordinada.
   Verificar un cierre y su reflejo completo en una copia/staging antes de habilitar
   el formulario en producción. El registro auditable no debe borrarse como rollback:
   si hubiera un fallo de interfaz/sincronización, conservarlo y completar el reflejo.

## Verificación local

Con PGlite y jsdom instalados fuera del proyecto:

```sh
HUGELLA_TEST_DEPS=/private/tmp/hugella-local-checks/node_modules node scripts/test-credit-closure.mjs
HUGELLA_TEST_DEPS=/private/tmp/hugella-local-checks/node_modules node scripts/test-credit-closure-ui.mjs
node scripts/test-apps-script-credit-closure.mjs
```

La suite ejecuta PostgreSQL real en memoria: ambos cierres, auditoría inmutable, reintentos,
conflictos, dinero/plan preservados, recálculo, filtros públicos antes del límite,
cliente con otro crédito activo, lista vacía, pago completo, importación histórica,
rechazo de cobros posteriores, permisos y rollback de migración ante fuente
inesperada. La interfaz se ejecuta con React/jsdom y RPC mock; Sheets con un mock
que rechaza escrituras fuera de las hojas/columnas permitidas. Las pruebas de
Sheets inspeccionan las fórmulas generadas, no ejecutan el motor de Google Sheets.
La validación del resultado numérico y de todos los gráficos reales en una copia
sigue siendo un paso de instalación, no una prueba que se afirme ejecutada aquí.

La sobrecarga histórica de importación de cinco argumentos se prueba aislada
en una transacción local, retirando temporalmente la de seis argumentos y
revirtiendo después la transacción. Sus valores por defecto hacen ambigua una
llamada posicional de cinco argumentos cuando ambas están presentes. Esto no
cambia las firmas ni resuelve esa ambigüedad en producción.
