# Verificación final HUGELLA — 1 de noviembre de 2026

> Informe histórico. El bloqueo fue corregido posteriormente; ver [rendimiento-resumenes.md](rendimiento-resumenes.md) para el resultado vigente y la comparación antes/después.

**Recomendación de este ensayo anterior: NO PUBLICABLE.** Bloqueo comprobado de rendimiento en el listado de resúmenes. No hubo fallos de integridad en las verificaciones ejecutadas.

## Entorno y alcance

PostgreSQL 17.11 nativo (Homebrew, ARM64), base nueva en directorio temporal privado y socket Unix; TCP deshabilitado. No se leyeron exportaciones de producción ni archivos `.env`; no se usaron credenciales ni se ejecutaron acciones remotas. El servidor quedó detenido al finalizar.

Carga de referencia: 5.000 compras, 60.000 cuotas, 12 tarjetas y 60 períodos mensuales por tarjeta, más fixtures específicas de historial y concurrencia. Volumen final: 105 pagos, 1 cortes, 60012 cuotas, 5012 compras, 731 periodos, 23 tarjetas, 254 esperadas, 105 aplicaciones, 1 documentales, 128 acreditaciones. Son supuestos sintéticos de stress, no una afirmación sobre el volumen productivo. Cobranzas/créditos ajenos a tarjetas se representaron con tablas y vistas vacías.

## Migración y concurrencia

- La migración `202610260002` se aplicó completa en 23.5 ms sobre el baseline financiero anterior y `202610260001`, sin quitar preflights, constraints ni triggers. Los conteos y hashes de filas de **26 tablas públicas preexistentes** quedaron idénticos. Incluye pagos, aplicaciones, auditoría, cortes, devoluciones, acreditaciones, cancelaciones y evidencia documental con filas sintéticas no vacías. También se verificó rollback ante un fallo deliberado y la conservación del detalle documental previo.
- **10 escenarios concurrentes**: cada uno usó dos procesos/conexiones PostgreSQL independientes y una tercera conexión observadora. Se registraron PIDs distintos, `wait_event_type=Lock` y los PIDs bloqueantes antes de liberar la primera transacción.
- Casos aprobados: mismo UUID; mismo UUID con distinto payload; pagos que juntos excederían el saldo; acreditaciones que juntas excederían lo esperado; cancelación frente a pago en ambos órdenes; devolución esperada frente a cancelación en ambos órdenes; acreditación frente a pago en ambos órdenes.
- Se comprobaron saldos finales, idempotencia, preservación de pagos reales, ausencia de dobles descuentos, expectativas sin efecto monetario, conciliación de saldos por período/cuota y denegación de acceso directo a la vista interna. **38 verificaciones aprobadas.**

## Rendimiento de consultas reales

Mediciones `EXPLAIN (ANALYZE, BUFFERS)` como `authenticated`, con actor administrador sintético: cinco ejecuciones por consulta; baseline previo, tres. Son tiempos de ejecución DB, sin transferencia HTTP ni renderizado. Presupuestos locales de aceptación, no SLA productivo.

| Consulta | Mediana | Máximo | Presupuesto | Resultado |
|---|---:|---:|---:|---|
| baseline listado 60 resumenes | 122.3 ms | 122.3 ms | 2000 ms | APROBADO |
| saldo resumen | 74.1 ms | 75.4 ms | 500 ms | APROBADO |
| listado 60 resumenes | 19323.5 ms | 21103.4 ms | 2000 ms | NO APROBADO |
| detalle compra | 331.6 ms | 357.1 ms | 1000 ms | APROBADO |
| calendario completo | 297.6 ms | 300.6 ms | 3000 ms | APROBADO |
| proyeccion mensual | 190.4 ms | 192.1 ms | 2000 ms | APROBADO |
| panel financiero | 348.3 ms | 355.2 ms | 2000 ms | APROBADO |

## Riesgo bloqueante y siguiente paso

El listado de 60 resúmenes tarda **19.32 s de mediana y 21.10 s de máximo**, contra el presupuesto de 2 s. Como referencia, el listado previo a integrar devoluciones tardaba 122.26 ms con el mismo volumen: aproximadamente 158 veces menos. La comparación del baseline es de costo; sus reglas de saldo anteriores no incluían las devoluciones.

El plan del listado registra 152.700 bloques temporales leídos y 153.000 escritos incluso con lecturas compartidas servidas desde caché. La inspección SQL señala como foco la repetición del cálculo financiero por resumen en `listar_resumenes_tarjeta_admin` y la llamada adicional de `listar_resumenes_tarjeta_financieros_admin`; se debe evitar repetir el recorrido de períodos y las agregaciones por fila/campo. Esta causa es un diagnóstico por código y métricas, no una optimización ya implementada.

**Antes de publicar:** optimizar ese listado y sus cálculos compartidos; repetir este ensayo y las regresiones funcionales. No publicar la migración ni la interfaz actual mientras persista el bloqueo. Las pruebas realizadas no certifican tiempos del servidor productivo, cargas mixtas prolongadas ni la equivalencia de un esquema productivo que no se consultó. Ninguna de esas verificaciones se declara aprobada.

## Evidencia y reproducción

- Script: `scripts/test-devoluciones-postgres.py`. Requiere los binarios locales de PostgreSQL 17 en la ruta indicada. Ejecutar `python3 scripts/test-devoluciones-postgres.py`; sale con código 1 si hay un bloqueo de rendimiento, como en este ensayo.
- Datos de resultados, PIDs, errores esperados y hashes: `docs/devoluciones-postgres-resultados.json`. Los planes completos quedaron en el directorio temporal registrado allí.
- SHA-256 de la migración examinada: `0c5bf1eb7fafb029ec2aa7f3a0bf7df408cac48394b63b7d191979353cd58d1d`.
- No se modificó SQL ni código de la aplicación en esta etapa. Se añadieron el script, el informe y los resultados. No se hizo `git push`, despliegue ni migración en Supabase.
