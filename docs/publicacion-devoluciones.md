# Publicación preparada: cancelaciones y devoluciones HUGELLA

Estado: **PUBLICABLE para el alcance validado localmente**. Este documento prepara acciones futuras del operador; no se ejecutó ninguna operación en Supabase, push ni despliegue.

## Contenido exacto del commit

21 archivos. La base `202610260001` estaba sólo como intent-to-add en Git y se incorpora sin modificar para registrar el historial y permitir reproducir las pruebas. Según lo confirmado por el usuario, ya está aplicada en producción: **no se vuelve a ejecutar**. La única migración pendiente es `202610260002`.

- `supabase/migrations/202610260001_devoluciones_tarjetas_base.sql`
- `supabase/migrations/202610260002_integrar_devoluciones_finanzas.sql`
- `app/admin/calendario-financiero/page.tsx`
- `app/admin/compras/cards-view.tsx`
- `app/admin/compras/purchase-types.ts`
- `app/admin/compras/purchases-view.tsx`
- `app/admin/compras/financial-actions.tsx`
- `app/api/admin/compras/handlers.ts`
- `app/api/admin/compras/[id]/finanzas/route.ts`
- `scripts/test-admin-devoluciones.mjs`
- `scripts/test-devoluciones-finanzas.mjs`
- `scripts/test-devoluciones-postgres.py`
- `scripts/test-resumenes-rendimiento.py`
- `scripts/fixtures/resumenes-listado-anterior.sql`
- `docs/devoluciones-tarjetas.md`
- `docs/devoluciones-postgres-resultados.json`
- `docs/rendimiento-resumenes.md`
- `docs/resumenes-rendimiento-resultados.json`
- `docs/verificacion-final-devoluciones.md`
- `docs/publicacion-devoluciones.md`
- `docs/devoluciones-publicacion-resultados.json`

No se incluyen `diagnostico-*`, exportaciones, `scripts/__pycache__`, fixtures de compras/Sheets ajenas, `supabase/.temp`, pruebas productivas ni las migraciones locales `202610090001`/`202610090002`. Los archivos ajenos permanecen en el working tree. El índice no tenía contenido staged previo; las dos migraciones tenían entradas intent-to-add vacías.

## Dependencias y verificaciones de esta preparación

- Next.js 16.3.4, React 19.2.8, Supabase SSR 0.12.7/JS 2.116.0; PGlite 0.5.8, JSDOM 30.1.2 y TypeScript 5.9.3 ya declarados e instalados. `npm ls --depth=0` correcto; no se modifica `package.json` ni el lockfile.
- Las tablas y helpers previos proceden de migraciones ya versionadas (`202610090003`/`004`, financiación `202610110001` a `006`, históricos `202610140002` a `004`, vistas y RPC financieras `202610160001`, `007`, `008`, `009`). No hay dependencia de las migraciones de Sheets excluidas. La carga histórica de `202610140001` no se ejecuta en las pruebas.
- **190 grupos de regresión aprobados en una copia limpia candidata**, formada por los archivos ya versionados más este manifiesto: 53 SQL, 20 devolución UI/API, 27 pagos de resúmenes, 30 tarjetas, 34 compras y 26 anulaciones.
- `next typegen`, `tsc --noEmit`, ESLint de los siete archivos de aplicación afectados y build Next.js completo aprobados. Un checkout limpio necesita `next typegen` antes de `tsc` para generar `PageProps`/`LayoutProps`; se corrigió ese orden en la validación, no el código de la aplicación.
- Copia sin `.env` y configuración de Supabase sintética `localhost`. No se usaron credenciales ni datos reales para las pruebas.
- Nueva base PostgreSQL 17.11 nativa, socket privado y TCP deshabilitado: **38 verificaciones aprobadas**, incluyendo preflight íntegro, instalación/rollback, hashes idénticos de 26 tablas, cortes, documentos y diez carreras entre sesiones con locks observados. El servidor quedó detenido.
- Todos los presupuestos financieros siguen aprobados. Listado de 60 resúmenes en la revalidación: mediana **85.848 ms**, máximo **258.372 ms** (presupuesto 2.000 ms). Evidencia nueva: `docs/devoluciones-publicacion-resultados.json`.
- La comparación previa del mismo dataset y seis estados sigue ligada al SHA vigente: 19.484,578 → 81,492 ms de mediana, 736 períodos idénticos. Ver `docs/rendimiento-resumenes.md` y `docs/resumenes-rendimiento-resultados.json`. Se conservan los informes anteriores como historial, no como bloqueos vigentes.

Huellas SHA-256:

- Base ya aplicada `001`: `4205897953ce666bc1cf7bc1fa79a883cfbbc659a8c231c33b0e441f6766007a`.
- Única pendiente `002`: `d3c6dadf469758eabda6acff4336e4a6c6475a2f23af118c88fa76719302ed43`.

El preflight se confirmó **localmente** sobre la estructura anterior recreada, no se consultó producción. Durante la futura aplicación volverá a validar las definiciones productivas y abortará ante drift. No quitar sus checks ni forzar el registro como aplicado si falla.

## Publicar más adelante, en este orden

Estas acciones remotas necesitan la autorización posterior del operador. La CLI Supabase no está instalada aquí; se verificó la sintaxis en su [referencia oficial](https://supabase.com/docs/reference/cli/global-flags) y el [procedimiento de historial](https://supabase.com/docs/guides/deployment/database-migrations). No se ejecutó ni siquiera un dry-run remoto.

1. Partir de un checkout/worktree **limpio del hash de commit entregado**. No ejecutar migraciones desde el working tree actual con archivos ajenos. Conservar también el artefacto de aplicación anterior, basado en `75594f86650e6b26fd00782516eaccb33cdbe63d`, para rollback de UI.
2. Verificar las dos huellas anteriores y confirmar un backup recuperable/PITR mediante el procedimiento del operador. No guardar datos ni credenciales productivos en Git. En el equipo de publicación, usar la versión aprobada de Supabase CLI y su configuración de acceso ya existente.
3. Enlazar al proyecto correcto y revisar el historial, **sin aplicar SQL de negocio todavía**:

```sh
supabase link --project-ref "$HUGELLA_PROJECT_REF"
supabase migration list
supabase db push --linked --dry-run
```

El historial remoto debe mostrar `202610260001` aplicada y `202610260002` pendiente. El dry-run debe listar **exclusivamente `202610260002`**. Si propone `001`, backfills, semillas u otra versión, detenerse. No usar `--include-all`, `--include-seed`, `--include-roles`, `db reset` ni borrar archivos para ocultar discrepancias.

Si y sólo si el operador confirma que `001` ya está completamente aplicada pero falta su registro de historial, puede corregir **sólo ese registro**, sin ejecutar otra vez su SQL:

```sh
supabase migration repair 202610260001 --status applied
supabase migration list
supabase db push --linked --dry-run
```

Esto registra historial; no prueba la equivalencia del esquema ni reemplaza el preflight. Cualquier otra discrepancia queda fuera de este cambio y requiere revisión propia.

4. Con autorización y dry-run exacto, aplicar únicamente la pendiente mediante el flujo de migraciones:

```sh
supabase db push --linked
supabase migration list
```

La migración incluye `BEGIN`/`COMMIT`, no cargas de datos. Exigir éxito y `002` aplicada antes de publicar la aplicación. Si hay un error de preflight, la transacción aborta: detenerse, conservar logs y revisar el drift. Si se corta la conexión y el resultado es incierto, consultar historial/definiciones antes de reintentar; no forzar `repair` como sustituto de confirmar el resultado.

5. Sólo después del SQL exitoso, construir y desplegar **ese mismo commit** por el pipeline habitual. En un checkout limpio:

```sh
npm ci
npx --no-install next typegen
npx --no-install tsc --noEmit
npm run build
```

La configuración del despliegue se toma del entorno ya administrado por el operador. Publicar el artefacto mediante el hosting existente; este repositorio no define aquí un comando de despliegue universal. No invertir el orden SQL → aplicación: las nuevas pantallas dependen de las nuevas RPC.

6. Verificar disponibilidad de rutas y protección de sesión. Las operaciones de pago/cancelación/devolución de prueba se hacen exclusivamente en un entorno aislado con fixtures, nunca sobre compras reales.

## Revertir de forma segura

### Si falla la aplicación de `002`

No publicar la UI nueva. La transacción SQL abortada conserva estructura/datos previos. No ejecutar un down, no tocar `001` y no marcar `002` como aplicada. Ante resultado de red incierto, verificar primero qué llegó a confirmarse, como se indicó arriba.

### Si `002` se confirmó y hay un problema de aplicación

Retirar la UI, **manteniendo la contabilización de devoluciones y los hechos auditados en la base**. Pausar nuevas operaciones administrativas durante el cambio mediante el procedimiento de acceso de la plataforma; no inventar ni asumir un feature flag inexistente. Resolver solicitudes en curso con sus UUID originales antes de habilitar de nuevo a los operadores.

Opción inmediata: desplegar el artefacto anterior `75594f86650e6b26fd00782516eaccb33cdbe63d` como rollback **sólo de aplicación**, sin ejecutar su SQL ni retroceder el historial remoto.

Para dejar además un commit de rollback de UI, ejecutar lo siguiente en un checkout limpio del commit de esta publicación. Conserva ambas migraciones y los informes en Git:

```sh
git switch -c rollback/devoluciones-ui
git --literal-pathspecs restore --source=75594f86650e6b26fd00782516eaccb33cdbe63d --staged --worktree -- \
  app/admin/calendario-financiero/page.tsx \
  app/admin/compras/cards-view.tsx \
  app/admin/compras/purchase-types.ts \
  app/admin/compras/purchases-view.tsx \
  app/api/admin/compras/handlers.ts
git --literal-pathspecs rm -- \
  app/admin/compras/financial-actions.tsx \
  'app/api/admin/compras/[id]/finanzas/route.ts'
git diff --cached --stat
git commit -m "Retirar interfaz de devoluciones conservando contabilidad y auditoría"
```

Revalidar tipos y build de ese rollback y desplegarlo por el pipeline habitual. La base permanece con `001` y `002`, las RPC conservan compatibilidad y sus saldos continúan descontando sólo acreditaciones efectivas. No hacer un `git revert` indiscriminado de este commit que retire las migraciones de la historia del repositorio.

### Si el problema es contable/SQL después de un commit exitoso

No hay un down genérico seguro: restaurar las vistas antiguas podría volver a contar deuda cancelada o ignorar créditos ya acreditados. Pausar las escrituras afectadas, conservar la base y auditoría, y preparar una **migración correctiva hacia adelante** con pruebas sintéticas. No eliminar hechos, revertir pagos, hacer `TRUNCATE`, restaurar un backup sobre escrituras posteriores ni marcar migraciones `reverted` para forzar su repetición. Los errores de datos requieren nuevas operaciones auditadas, no reescritura de historia.

## Riesgos pendientes

No hay bloqueos locales detectados. Falta la comprobación futura del historial/preflight **en producción** y la ejecución por el operador de las acciones anteriores; hoy están expresamente prohibidas. Las mediciones locales no certifican hardware productivo, latencia HTTP ni carga mixta sostenida.
