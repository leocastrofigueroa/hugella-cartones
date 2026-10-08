# Identidad protegida en actualizaciones desde Sheets

La llamada externa `SincronizacionCreditos.gs → sincronizarFilaCreditoSupabase_`
invoca directamente `actualizar_credito_desde_sheets`. El archivo Apps Script no está versionado aquí. El cuerpo literal de la RPC
aportado por el usuario está incluido en `scripts/test-sheets-credit-identity.mjs`
como fixture local: nunca aplicar ese original inseguro a producción. El importador
general conserva su comportamiento: un código existente devuelve su ID.

La migración `202610080001_proteger_identidad_credito_sheets.sql` sustituye
exclusivamente el bloque conocido de actualización de clientes por validaciones
bajo bloqueo del crédito y del cliente. Conserva el resto del cuerpo, incluyendo
autorización, validaciones previas, retorno, propietario y permisos. Comprueba
que la única actualización restante escribe los cuatro campos permitidos.

Reglas:

- DNI: quitar caracteres no numéricos; ambos valores deben ser no vacíos e iguales.
- Nombre: normalizar mayúsculas y espacios; ambos deben ser no vacíos e iguales.
- No escribir ningún campo del cliente ni cambiar `cliente_id`.
- Teléfono y domicilio siguen aceptados en los parámetros, pero se ignoran.
- Producto no vacío, fecha finita, cantidad e importe positivos y no nulos.
- Ante conflicto, excepción `22023` con código del crédito, sin escrituras.

## Verificación antes de aplicar

La migración es conservadora y no es un parser general de PL/pgSQL. Exige los
dos UPDATE con la forma documentada, rechaza otros escritores explícitos y
manejadores de excepciones. Si la definición difiere (incluso por comentarios
con palabras reservadas o expresiones equivalentes), aborta completamente.
No se debe relajar esta comprobación sin revisar el cuerpo real.

La migración fue ejecutada localmente contra ese cuerpo literal: conserva el
retorno JSON, SECURITY DEFINER, search_path=public, propietario y ACL. También
se prueban variantes de espacios, saltos de línea y mayúsculas de palabras SQL.
El cuerpo original no tiene comprobaciones auth.uid()/es_admin_hugella(): la
protección de acceso depende de los permisos EXECUTE y del contexto existente.
No se agregan ni eliminan permisos. Los grants reales de producción no fueron
consultados; la migración comprueba su igualdad antes/después al ejecutarse.

Revisar triggers vigentes antes del despliegue: la ausencia de triggers sobre
clientes y créditos fue confirmada por el usuario. La migración conserva cualquier
lógica original fuera del bloque sustituido; el fixture literal no contiene
funciones auxiliares de escritura.

Ejecutar:

```sh
node scripts/test-sheets-credit-identity.mjs
```

Incluye Mansilla/Guajardo, rechazo sin cambios, normalización, validaciones,
autorización, invariancia de metadatos/permisos y rechazo de cuerpos inesperados.
No se encontraron PostgreSQL nativo ni Docker en el entorno local.
PGlite no verifica carreras entre conexiones: probar en PostgreSQL con dos
sesiones una actualización simultánea del cliente/crédito y confirmar que
la segunda operación espera o falla, sin validar una identidad obsoleta.

Una segunda aplicación de la migración aborta deliberadamente. Usar el historial
normal de migraciones; no volver a ejecutar manualmente un archivo ya aplicado.

Apps Script ya propaga errores HTTP: no requiere cambios. Un error no revierte
otras llamadas de sincronización que ya hayan terminado. La RPC no altera pagos,
contratos, cierres, estado ni tokens; las consultas pueden reflejar legítimamente
los cambios permitidos del plan del crédito.
