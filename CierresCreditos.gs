// Companion to Supabase.gs. Does not change payment publishing or payment RETIRAR.
// Install only after reviewing docs/cierres-creditos.md and configuring indicators.
function sincronizarPagosAdminYCierresHaciaSheets() {
  sincronizarPagosAdminHaciaSheets();
  sincronizarCierresCreditosHaciaSheets();
}

// Use this entry point for existing credit-import triggers, too.
function sincronizarTodosLosCreditosYCierresASupabase() {
  sincronizarTodosLosCreditosASupabase();
  sincronizarCierresCreditosHaciaSheets();
}

function actualizarTodosLosCreditosConCierres() {
  actualizarTodosLosCreditosDesdeCobros();
  sincronizarCierresCreditosHaciaSheets();
}

function sincronizarCierresCreditosHaciaSheets() {
  return conBloqueoRegistroCobros_(function () {
    const conexion = obtenerConexionSupabase_();
    const cierres = [];
    let despues = null;
    // Read the entire snapshot before writing; failures do not clear prior closures.
    while (true) {
      const lote = llamarRpcSupabase_(conexion, 'obtener_cierres_creditos_sheets', { p_despues: despues });
      if (!Array.isArray(lote)) throw new Error('Respuesta de cierres inválida.');
      if (!lote.length) break;
      const siguiente = lote[lote.length - 1].credito_id;
      if (!siguiente || (despues && siguiente <= despues)) throw new Error('Paginación de cierres inválida.');
      cierres.push.apply(cierres, lote);
      despues = siguiente;
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mercaderia = ss.getSheetByName('Mercadería');
    if (!mercaderia) throw new Error('No encuentro Mercadería.');
    const datos = mercaderia.getDataRange().getValues();
    const configuracion = JSON.parse(PropertiesService.getScriptProperties()
      .getProperty('CIERRES_INDICADORES_SHEETS') || 'null');
    const plan = prepararCierresCreditosSheets_(datos, cierres, configuracion);
    // Validate every destination before the first write. Never guess dashboard cells.
    plan.indicadores.forEach(indicador => {
      if (!ss.getSheetByName(indicador.hoja)) throw new Error('No encuentro ' + indicador.hoja);
    });
    let espejo = ss.getSheetByName('Cierres de créditos');
    if (!espejo) espejo = ss.insertSheet('Cierres de créditos');
    const encabezados = ['ID CREDITO', 'TIPO CIERRE', 'FECHA CIERRE'];
    if (espejo.getLastRow() > 0 && JSON.stringify(espejo.getRange(1, 1, 1, 3).getValues()[0]) !== JSON.stringify(encabezados)) {
      throw new Error('La hoja Cierres de créditos ya existe con otro contenido.');
    }
    // Closures are immutable and only grow. Never clear a larger mirror on a
    // unexpectedly smaller remote snapshot (wrong project or incomplete response).
    const anteriores = espejo.getLastRow() > 1
      ? espejo.getRange(2, 1, espejo.getLastRow() - 1, 3).getDisplayValues() : [];
    anteriores.forEach(fila => {
      if (fila[0] && !plan.espejo.some(cierre => cierre[0] === fila[0] && cierre[1] === fila[1] && cierre[2] === fila[2])) {
        throw new Error('El snapshot perdió o cambió un cierre ya sincronizado.');
      }
    });
    const valores = [encabezados].concat(plan.espejo);
    if (espejo.getMaxRows() < valores.length) espejo.insertRowsAfter(espejo.getMaxRows(), valores.length - espejo.getMaxRows());
    espejo.getRange(1, 1, valores.length, 3).setValues(valores);
    if (plan.estados.length) mercaderia.getRange(2, 20, plan.estados.length, 1).setFormulas(plan.estados.map(fila => fila.map(formula => formula.replace(/,/g, ';'))));
    plan.indicadores.forEach(indicador => ss.getSheetByName(indicador.hoja)
      .getRange(indicador.celda).setFormula(indicador.formula.replace(/,/g, ';')));
    SpreadsheetApp.flush();
    // Existing collection estimate already filters active values in T.
    if (typeof actualizarRecaudacionEstimada === 'function') actualizarRecaudacionEstimada();
  });
}

// Pure planning function: no Sheets/network access. L/N/O/K and payment rows are
// never written. Formula names use the English/comma Apps Script notation.
function prepararCierresCreditosSheets_(datos, cierres, configuracion) {
  if (!datos.length || String(datos[0][19]).trim() !== 'ESTADO') throw new Error('Falta ESTADO en T.');
  const indiceId = datos[0].findIndex(valor => String(valor).trim() === 'ID CREDITO');
  if (indiceId < 0) throw new Error('Falta ID CREDITO.');
  let columnaId = '';
  for (let n = indiceId + 1; n > 0; n = Math.floor((n - 1) / 26)) columnaId = String.fromCharCode(65 + (n - 1) % 26) + columnaId;
  const ids = datos.slice(1).map(fila => String(fila[indiceId] || '').trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('ID CREDITO duplicado en Mercadería.');
  const codigos = new Set();
  const espejo = cierres.map(cierre => {
    if (!['DEVUELTO', 'RETIRADO'].includes(cierre.tipo) || !/^\d{4}-\d{2}-\d{2}$/.test(cierre.fecha)
      || typeof cierre.codigo_credito !== 'string' || !cierre.codigo_credito.trim()
      || cierre.codigo_credito.startsWith('=') || codigos.has(cierre.codigo_credito)) throw new Error('Cierre inválido o duplicado.');
    if (!ids.includes(cierre.codigo_credito)) throw new Error('Crédito cerrado ausente en Mercadería: ' + cierre.codigo_credito);
    codigos.add(cierre.codigo_credito);
    return [cierre.codigo_credito, cierre.tipo, cierre.fecha];
  });
  const estados = datos.slice(1).map((_, indice) => {
    const fila = indice + 2;
    return [`=IF(${columnaId}${fila}="","",IF(COUNTIF('Cierres de créditos'!$A$2:$A,${columnaId}${fila})>0,"CANCELADO",IF(L${fila}>=I${fila},"CANCELADO",IF(L${fila}>S${fila},"ADELANTADO ("&(L${fila}-S${fila})&")",IF(L${fila}<S${fila},"ATRASADO ("&(S${fila}-L${fila})&")","AL DÍA")))))`];
  });
  // Keep original O/K amounts intact. Only exclude merchandise closures, not
  // CANCELADO-by-payment credits, from the existing economic sums.
  // Open ranges retain the existing ARRAYFORMULA behavior when new credits are
  // appended between sync runs. A snapshot-sized range silently omits them.
  const rango = columna => `'Mercadería'!${columna}2:${columna}`;
  const abierto = `(COUNTIF('Cierres de créditos'!A2:A,${rango(columnaId)})=0)`;
  const conId = `(${rango(columnaId)}<>"")`;
  const formulas = {
    capital_pendiente: `=ARRAYFORMULA(SUMPRODUCT(${rango('O')},${abierto},${conId}))`,
    ganancia_esperada: `=ARRAYFORMULA(SUMPRODUCT(${rango('K')},${abierto},${conId}))`,
    creditos_activos: `=COUNTIF(${rango('T')},"AL DÍA")+COUNTIF(${rango('T')},"ATRASADO*")+COUNTIF(${rango('T')},"ADELANTADO*")`,
    creditos_atrasados: `=COUNTIF(${rango('T')},"ATRASADO*")`,
    cuotas_pendientes: `=ARRAYFORMULA(SUMPRODUCT(${rango('N')},${abierto},${conId}))`,
    cuotas_atrasadas: `=ARRAYFORMULA(SUMPRODUCT((${rango('S')}>${rango('L')})*(${rango('S')}-${rango('L')}),${abierto},${conId}))`,
    importe_atrasado: `=ARRAYFORMULA(SUMPRODUCT((${rango('S')}>${rango('L')})*(${rango('S')}-${rango('L')}),${rango('H')},${abierto},${conId}))`
  };
  if (!Array.isArray(configuracion) || !configuracion.length) throw new Error('Configurar CIERRES_INDICADORES_SHEETS con las celdas reales de Resumen y Dashboard.');
  const destinos = new Set();
  const indicadores = configuracion.map(item => {
    if (!['Resumen', 'Dashboard'].includes(item.hoja) || !/^[A-Z]+[1-9]\d*$/.test(item.celda)
      || !Object.prototype.hasOwnProperty.call(formulas, item.indicador)
      || destinos.has(item.hoja + '!' + item.celda)) throw new Error('Destino/indicador inválido o duplicado.');
    destinos.add(item.hoja + '!' + item.celda);
    return { hoja: item.hoja, celda: item.celda, formula: formulas[item.indicador] };
  });
  for (const hoja of ['Resumen', 'Dashboard']) for (const indicador of ['capital_pendiente', 'ganancia_esperada', 'creditos_activos', 'creditos_atrasados']) {
    if (!configuracion.some(item => item.hoja === hoja && item.indicador === indicador)) throw new Error('Falta configurar ' + hoja + ': ' + indicador);
  }
  return { espejo: espejo, estados: estados, indicadores: indicadores };
}
