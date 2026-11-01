# Rendimiento del listado de resúmenes — verificación local

**Recomendación: PUBLICABLE para el alcance verificado.** Se resolvió el bloqueo de rendimiento del listado. No se ejecutó publicación alguna.

## Resultado antes/después

PostgreSQL 17.11 nativo, sin TCP y con socket Unix privado. Se reutilizó exclusivamente la base sintética del ensayo anterior, ampliada con fixtures de crédito arrastrado entre páginas y pago completo **antes de ambas mediciones**: 5.016 compras, 60.016 cuotas y 736 períodos. Los checksums de las 26 tablas públicas no cambiaron durante la comparación. Ningún dato, credencial ni conexión de producción.

Cinco ejecuciones por consulta, `EXPLAIN (ANALYZE, BUFFERS)`, como `authenticated` con administrador sintético; misma instancia, dataset y configuración. Tiempos de ejecución DB, sin HTTP ni renderizado:

| Consulta | Mediana | Máximo |
|---|---:|---:|
| Ampliada anterior, 60 resúmenes | 19484.578 ms | 20982.154 ms |
| Ampliada optimizada, 60 resúmenes | 81.492 ms | 81.829 ms |
| RPC compatible optimizada, 60 resúmenes | 81.494 ms | 81.960 ms |

Mejora de mediana: **239.1 veces**. Máximo optimizado inferior al presupuesto local de 2.000 ms. La referencia de 122 ms anterior a integrar devoluciones queda como dato histórico; el antes/después de esta tabla usa exactamente el mismo dataset y las mismas reglas financieras.

## Causa y cambio limitado

El listado previo obtenía el saldo por período y campo, y el ampliado volvía a consultarlo por cada fila. Eso repetía agregaciones y el recorrido de créditos históricos. El plan registraba 152.700 bloques temporales leídos y 153.000 escritos por listado; después registra 509/510. El plan interno confirma `CTE finanzas` con `Actual Loops = 1`.

Se agregó un helper privado por conjuntos en `202610260002`: materializa la página, agrupa obligaciones/cortes/cancelaciones y pagos, y reutiliza una única evaluación de la vista financiera. La vista recorre toda la historia antes de filtrar la página para conservar créditos entrantes. Las dos RPC de listado delegan al helper, manteniendo nombres, parámetros, defaults, firmas, campos, orden, autorización, validaciones y estados. El bucle final sólo serializa JSON y conserva el rechazo de inconsistencias; no recalcula finanzas.

No hay caché persistente, índices nuevos ni cambios en pagos, devoluciones, cancelaciones, cortes, vistas financieras o saldo individual. Se agregó al preflight el hash del listado anterior que ahora se reemplaza. La reconstrucción inversa de ese bloque y ese único guard reproduce el SHA-256 de la migración anterior: `0c5bf1eb7fafb029ec2aa7f3a0bf7df408cac48394b63b7d191979353cd58d1d`.

## Regresiones y compatibilidad

- **53 grupos SQL aprobados** en `test-devoluciones-finanzas.mjs`: siete etapas contrastan ambos listados con el saldo individual; incluyen expectativas sin descuento, créditos parciales/arrastrados, pagos, cancelaciones, históricos, documentos y offset.
- Comparación nativa de **736 períodos**, idénticos al saldo individual sin modificar. Estados cubiertos: CANCELADA, PAGADO, PAGO_PARCIAL, PENDIENTE, SALDO_A_FAVOR y SIN_OBLIGACIONES.
- JSON ampliado y filas de la RPC anterior idénticos antes/después; página vacía, límites/offsets inválidos, tarjeta inexistente, autorización y privacidad del helper verificados. El crédito de la página anterior sigue llegando a la siguiente.
- Todas las otras definiciones de funciones y todos los datos permanecieron idénticos. Las funciones de escritura/concurrencia del ensayo nativo anterior no cambiaron.
- **77 grupos React/API aprobados**: `test-admin-pagos-resumenes.mjs` (27), `test-admin-tarjetas.mjs` (30), `test-admin-devoluciones.mjs` (20).
- Compilación de los scripts Python y `git diff --check` aprobados. El PostgreSQL local quedó detenido.

Los oráculos enumeran tablas privadas como owner; las RPC y sus tiempos se verifican como `authenticated`. Dos lecturas del harness intentaron inicialmente enumerar tablas privadas como la aplicación: se corrigió el harness, sin ampliar permisos. Las mediciones se reanudaron sólo tras comprobar checksum de datos y definiciones SQL. No se interpretaron esos errores del harness como aprobación ni como fallos del producto.

## Evidencia y reproducción

- Script: `scripts/test-resumenes-rendimiento.py`.
- Definiciones lentas de referencia, sin datos: `scripts/fixtures/resumenes-listado-anterior.sql`.
- Resultados, planes, checksums y parámetros: `docs/resumenes-rendimiento-resultados.json`.
- SHA-256 de la migración verificada: `d3c6dadf469758eabda6acff4336e4a6c6475a2f23af118c88fa76719302ed43`.

```sh
# Si ya no existe el directorio temporal sintético del informe anterior, recrearlo:
python3 scripts/test-devoluciones-postgres.py
# Compara versión lenta vs optimizada en esa misma base sintética:
python3 scripts/test-resumenes-rendimiento.py
node scripts/test-devoluciones-finanzas.mjs
node scripts/test-admin-pagos-resumenes.mjs
node scripts/test-admin-tarjetas.mjs
node scripts/test-admin-devoluciones.mjs
```

No quedan riesgos bloqueantes detectados para esta corrección. Los resultados locales no certifican hardware productivo, latencia HTTP, escala ilimitada ni carga mixta sostenida. La revisión y publicación habituales siguen siendo acciones pendientes del operador. No se modificó la migración base aplicada, no se contactó Supabase, no se hizo push ni despliegue.
