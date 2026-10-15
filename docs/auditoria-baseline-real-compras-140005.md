# Comparación con baseline real suministrado

Fuente: datos pegados por el administrador, verificados manualmente por él.
No hubo conexión ni consulta de producción durante esta auditoría.

## Resultado

PASS para todos los campos reales suministrados, reproducidos en el test local.
Cierre 2026-10-15: el administrador suministró tramo/inicio completos y coinciden
con 140005. La sección de pendientes siguiente describe el estado anterior;
queda resuelta por `preflight-lote-hg.md`. No se alteró 140005.

| Bloque de 140005 | Antes | Corrección / cobertura actual |
| --- | --- | --- |
| Referencias | 10 proveedores activos, 2 tarjetas, 6 períodos con identidad y datos aprobados | Sin cambios: mismas referencias aprobadas |
| Conteos A | 2 compras, 3 obligaciones, 0 historia/cortes/evidencias/pagos/aplicaciones | Sin cambios; añade 2 ítems exactos, 1 financiación exclusivamente de impresora y 1 tramo total |
| Cabeceras técnica e impresora | Sólo IDs permitidos y fuente/id_origen NULL | Todos los campos suministrados: IDs, tipo, proveedor, fecha, moneda, comprobante, observaciones, created_at, actor, fuente, id_origen |
| Anulación técnica | Única anulación, parent correcto y vínculo con operación financiera | Además UUID de operación real, motivo, created_at y actor exactos; impresora sin anulación por unicidad global |
| Ítem técnico | No validaba identidad ni economía exactas | ID, parent, posición, descripción, cantidad 1, costo 343499, total 343499, modalidad DETALLADO, importe histórico NULL |
| Ítem impresora | Sólo suma total 343499 | Mismos campos exactos, con su propio ID real; sólo 2 ítems globales |
| Financiación | Impresora CONFIRMADA; técnica podía tener financiación inmediata | Fila única de impresora, con ambos timestamps y actor exactos; técnica sin financiación ni tramo |
| Obligaciones | Parent/tramo/tarjeta, números, importes, períodos y sólo ID de cuota 1 | Además UUID reales de cuotas 2 y 3; mantiene exactamente 3 obligaciones y cero aplicaciones |
| Tramo | UUID conocido, compra, importe, medio, tarjeta, cuotas, NORMAL | Conserva controles y explicita fecha_pago NULL y valor_cuota_historico NULL, derivados de CHECK y estrategia NORMAL; no fija posición/created_at desconocidos |
| Inicio explícito | Exige tramo conocido y primer período Leo orden 2 | Sin cambios. La fila completa no fue suministrada y requiere consulta manual |
| Snapshot instalación | Comparación exacta antes de importar | Sin cambios: detecta también alteraciones de campos no hardcodeados desde instalación |
| Preservación posterior | Contención JSON exacta de todas las filas anteriores y cantidades incrementales por tabla | Sin cambios: protege cabeceras, ítems, financiación, tramo/inicio, obligaciones, anulación, operaciones y referencias con todos sus campos |
| Estado B | Snapshot completo igual al comprobante más validación individual del lote | Sin cambios; no reimporta ni adopta parciales |

No se modificaron permisos, locks, lógica de importación, algoritmos financieros,
RPC existentes, 140002/140003/140004 ni el manifiesto.

## Diferencias de los fixtures anteriores

- Técnica: compra normal de prueba por 1.01, ítem “Decimal existente” con cantidad
  3 y costo .335, financiación inmediata EFECTIVO. El baseline real es 343499,
  cantidad 1 y ninguna financiación actual.
- Técnica: fecha 2026-09-01, sin comprobante/observaciones reales; created_at
  generado durante el test. Se sustituyeron por todos los valores suministrados.
- Impresora: fecha 2026-09-01, descripción “Fixture parcial”, ítem con ID generado,
  sin comprobante real y timestamps de compra/financiación generados.
- Cuotas 2/3: UUID sintéticos 00000000-0000-4000-8000-000000007001/7002.
- Anulación: UUID de operación derivado del fixture, motivo “PRUEBA TÉCNICA /
  FIXTURE LOCAL” y fecha generada. Ahora usa operación, motivo, timestamp y actor
  reales suministrados.
- Importes de las 3 cuotas, IDs conocidos de impresora/tramo/tarjeta/cuota 1,
  período de cuota 1 y NULL de 2/3 ya coincidían.

El nuevo fixture no modifica las suites anteriores: prepara estos hechos
localmente antes de probar la 140005 real. No desactiva defensas para construirlo.
Timestamps de ítems/obligaciones/tramo/inicio y otras operaciones no suministrados
siguen siendo valores de fixture, nunca evidencia real.

## Datos faltantes y alcance del GO

Para cerrar la coincidencia de TODA la estructura antes de aprobar la carga,
revisar manualmente `scripts/fixtures/consultar-tramo-impresora-baseline.sql`:

- Fila completa de tramos_pago_compras: especialmente posición y created_at;
  confirmar también todos los campos económicos y NORMAL/NULL tras 140004.
- Fila completa de inicios_tramos_tarjeta: primer_periodo_id, actor_id y created_at.

Los campos desconocidos no se hardcodean. Los snapshots los preservan exactamente.
La FK obliga al tramo a compartir compra/tarjeta/cantidad con sus obligaciones;
el CHECK de crédito exige fecha_pago NULL. NORMAL exige valor_cuota_historico NULL.

GO sólo para instalar infraestructura: la instalación no ejecuta el validador A
ni la importación. Captura el snapshot y deja 2 compras/3 obligaciones/0 HG/0 cortes.
Pendiente la aprobación definitiva de la llamada de carga hasta completar tramo/
inicio y la prueba autorizada de sesión real/PostgREST. No se habilitó la ruta.

Cierre de la consulta pendiente (2026-10-15): posición 1, fecha_pago NULL,
estrategia NORMAL, valor_cuota_historico NULL y created_at del tramo
2026-10-11 20:49:42.7306+00; inicio con actor conocido y created_at
2026-10-11 20:49:42.738671+00. Todos coinciden. La migración separada de
preflight verifica estos valores sin cambiar el SHA ni los controles de 140005.
