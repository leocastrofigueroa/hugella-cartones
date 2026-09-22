function sincronizarTodosLosCreditosASupabase() {
  return conBloqueoRegistroCobros_(function () {
    // Retirar primero pagos anulados evita que una fila PG- vuelva a intentar
    // importarse antes de ser limpiada de Registro de cobros.
    procesarEventosRetirarSheets_();

    const props = PropertiesService.getScriptProperties();

    const supabaseUrl = props.getProperty('SUPABASE_URL');
    const publishableKey = props.getProperty('SUPABASE_PUBLISHABLE_KEY');
    const email = props.getProperty('SUPABASE_IMPORT_EMAIL');
    const password = props.getProperty('SUPABASE_IMPORT_PASSWORD');

    if (!supabaseUrl || !publishableKey || !email || !password) {
      throw new Error('Faltan propiedades de Supabase en Script Properties.');
    }

    const loginResponse = fetchConReintentos(
      supabaseUrl + '/auth/v1/token?grant_type=password',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: publishableKey
        },
        payload: JSON.stringify({
          email: email,
          password: password
        }),
        muteHttpExceptions: true
      }
    );

    if (loginResponse.getResponseCode() !== 200) {
      throw new Error(
        'Error al iniciar sesión en Supabase: ' +
        loginResponse.getContentText()
      );
    }

    const loginData = JSON.parse(loginResponse.getContentText());
    const accessToken = loginData.access_token;

    const headers = {
      apikey: publishableKey,
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mercaderia = ss.getSheetByName('Mercadería');
    const cobros = ss.getSheetByName('Registro de cobros');

    if (!mercaderia || !cobros) {
      throw new Error('No encuentro Mercadería o Registro de cobros.');
    }

    // =========================
    // CREDITOS
    // =========================

    const mercData = mercaderia.getDataRange().getValues();
    const headersMerc = mercData[0].map(h => String(h).trim());

    const idx = {
      codigo: headersMerc.indexOf('ID CREDITO'),
      cliente: headersMerc.indexOf('CLIENTE'),
      producto: headersMerc.indexOf('MERCADERIA'),
      telefono: headersMerc.indexOf('CONTACTO'),
      domicilio: headersMerc.indexOf('DOMICILIO'),
      importeCuota: headersMerc.indexOf('MONTO'),
      cantidadCuotas: headersMerc.indexOf('CUOTAS'),
      fechaInicio: headersMerc.indexOf('FECHA ENTREGA'),
      dni: headersMerc.indexOf('DNI')
    };

    const faltantes = Object.entries(idx)
      .filter(([_, value]) => value === -1)
      .map(([key]) => key);

    if (faltantes.length) {
      throw new Error(
        'Faltan columnas en Mercadería: ' + faltantes.join(', ')
      );
    }

    let creditosProcesados = 0;

    mercData.slice(1).forEach((row, index) => {
      const codigo = String(row[idx.codigo] || '').trim();

      if (!codigo) return;

      const dni = String(row[idx.dni] || '').trim();

      if (!dni) {
        Logger.log('Omitido ' + codigo + ': no tiene DNI.');
        return;
      }

      const fechaInicioValor = row[idx.fechaInicio];

      if (!(fechaInicioValor instanceof Date)) {
        Logger.log('Omitido ' + codigo + ': fecha de inicio inválida.');
        return;
      }

      const payloadCredito = {
        p_codigo: codigo,
        p_nombre: String(row[idx.cliente] || '').trim(),
        p_dni: dni,
        p_telefono: String(row[idx.telefono] || '').trim(),
        p_domicilio: String(row[idx.domicilio] || '').trim(),
        p_producto: String(row[idx.producto] || '').trim(),
        p_fecha_inicio: Utilities.formatDate(
          fechaInicioValor,
          Session.getScriptTimeZone(),
          'yyyy-MM-dd'
        ),
        p_cantidad_cuotas: Number(row[idx.cantidadCuotas]),
        p_importe_cuota: Number(row[idx.importeCuota])
      };

      const creditoResponse = fetchConReintentos(
        supabaseUrl + '/rest/v1/rpc/importar_credito_hugella',
        {
          method: 'post',
          headers: headers,
          payload: JSON.stringify(payloadCredito),
          muteHttpExceptions: true
        }
      );

      if (
        creditoResponse.getResponseCode() < 200 ||
        creditoResponse.getResponseCode() >= 300
      ) {
        throw new Error(
          'Error importando crédito ' +
          codigo +
          ' fila ' +
          (index + 2) +
          ': ' +
          creditoResponse.getContentText()
        );
      }

      creditosProcesados++;
    });

    // =========================
    // PAGOS
    // =========================

    const cobrosData = cobros.getDataRange().getValues();
    const headersCobros = cobrosData[0].map(h => String(h).trim());

    const idxCobros = {
      fecha: headersCobros.indexOf('Fecha'),
      codigo: headersCobros.indexOf('ID Crédito'),
      importe: headersCobros.indexOf('Importe cobrado'),
      medio: headersCobros.indexOf('Medios de pago'),
      observaciones: headersCobros.indexOf('Observaciones'),
      idPago: headersCobros.indexOf('ID PAGO')
    };

    const faltantesCobros = Object.entries(idxCobros)
      .filter(([key, value]) => value === -1 && key !== 'observaciones')
      .map(([key]) => key);

    if (faltantesCobros.length) {
      throw new Error(
        'Faltan columnas en Registro de cobros: ' +
        faltantesCobros.join(', ')
      );
    }

    // Buscar el número más alto ya utilizado en PG-XXXXXX
    let ultimoNumeroPago = 0;

    cobrosData.slice(1).forEach(row => {
      const idPago = String(row[idxCobros.idPago] || '').trim();
      const match = idPago.match(/^PG-(\d+)$/);

      if (match) {
        ultimoNumeroPago = Math.max(
          ultimoNumeroPago,
          Number(match[1])
        );
      }
    });

    let pagosProcesados = 0;
    let pagosOmitidos = 0;

    cobrosData.slice(1).forEach((row, index) => {
      const numeroFila = index + 2;
      const codigo = String(row[idxCobros.codigo] || '').trim();

      if (!codigo) return;

      const fechaPagoValor = row[idxCobros.fecha];
      const importe = Number(row[idxCobros.importe]);
      const medio = String(row[idxCobros.medio] || '').trim();

      if (!(fechaPagoValor instanceof Date) || !importe || !medio) {
        Logger.log(
          'Pago omitido fila ' + numeroFila + ': datos incompletos.'
        );
        pagosOmitidos++;
        return;
      }

      let idPago = String(row[idxCobros.idPago] || '').trim();
      // Los pagos ADM- nacieron en el Admin y ya existen en Supabase.
      // No deben volver a importarse desde Sheets.
      if (idPago.startsWith('ADM-')) {
        return;
      }

      if (!idPago) {
        ultimoNumeroPago++;

        idPago =
          'PG-' +
          String(ultimoNumeroPago).padStart(6, '0');

        cobros
          .getRange(numeroFila, idxCobros.idPago + 1)
          .setValue(idPago);
      }

      const observaciones =
        idxCobros.observaciones === -1
          ? ''
          : String(row[idxCobros.observaciones] || '').trim();

      const payloadPago = {
        p_codigo_credito: codigo,
        p_fecha_pago: Utilities.formatDate(
          fechaPagoValor,
          Session.getScriptTimeZone(),
          'yyyy-MM-dd'
        ),
        p_importe: importe,
        p_medio_pago: medio,
        p_observaciones: observaciones,
        p_referencia_importacion: 'SHEETS-' + idPago
      };

      const pagoResponse = fetchConReintentos(
        supabaseUrl + '/rest/v1/rpc/importar_pago_hugella',
        {
          method: 'post',
          headers: headers,
          payload: JSON.stringify(payloadPago),
          muteHttpExceptions: true
        }
      );

      if (
        pagoResponse.getResponseCode() < 200 ||
        pagoResponse.getResponseCode() >= 300
      ) {
        Logger.log(
          'Pago no importado ' +
          idPago +
          ' (' +
          codigo +
          '): ' +
          pagoResponse.getContentText()
        );
        pagosOmitidos++;
        return;
      }

      pagosProcesados++;
    });

    Logger.log(
      'Sincronización finalizada. Créditos procesados: ' +
      creditosProcesados +
      '. Pagos procesados: ' +
      pagosProcesados +
      '. Pagos omitidos: ' +
      pagosOmitidos +
      '.'
    );
  });
}

function migrarIdsPagosExistentes() {
  return conBloqueoRegistroCobros_(function () {
    const props = PropertiesService.getScriptProperties();

    const supabaseUrl = props.getProperty('SUPABASE_URL');
    const publishableKey = props.getProperty('SUPABASE_PUBLISHABLE_KEY');
    const email = props.getProperty('SUPABASE_IMPORT_EMAIL');
    const password = props.getProperty('SUPABASE_IMPORT_PASSWORD');

    if (!supabaseUrl || !publishableKey || !email || !password) {
      throw new Error('Faltan propiedades de Supabase en Script Properties.');
    }

    // Iniciar sesión con el usuario técnico
    const loginResponse = fetchConReintentos(
      supabaseUrl + '/auth/v1/token?grant_type=password',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: publishableKey
        },
        payload: JSON.stringify({
          email: email,
          password: password
        }),
        muteHttpExceptions: true
      }
    );

    if (loginResponse.getResponseCode() !== 200) {
      throw new Error(
        'Error al iniciar sesión en Supabase: ' +
        loginResponse.getContentText()
      );
    }

    const accessToken =
      JSON.parse(loginResponse.getContentText()).access_token;

    const headers = {
      apikey: publishableKey,
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cobros = ss.getSheetByName('Registro de cobros');

    if (!cobros) {
      throw new Error('No encuentro la hoja Registro de cobros.');
    }

    const data = cobros.getDataRange().getValues();
    const encabezados = data[0].map(h => String(h).trim());

    const idxCodigo = encabezados.indexOf('ID Crédito');
    const idxIdPago = encabezados.indexOf('ID PAGO');

    if (idxCodigo === -1 || idxIdPago === -1) {
      throw new Error(
        'No encuentro ID Crédito o ID PAGO en Registro de cobros.'
      );
    }

    // Primero averiguamos el mayor PG existente.
    let ultimoNumero = 0;

    data.slice(1).forEach(row => {
      const idPago = String(row[idxIdPago] || '').trim();
      const match = idPago.match(/^PG-(\d+)$/);

      if (match) {
        ultimoNumero = Math.max(
          ultimoNumero,
          Number(match[1])
        );
      }
    });

    let idsAsignados = 0;
    let referenciasMigradas = 0;
    let referenciasNoEncontradas = 0;

    data.slice(1).forEach((row, index) => {
      const numeroFila = index + 2;
      const codigo = String(row[idxCodigo] || '').trim();

      // Ignorar filas que no sean cobros.
      if (!codigo) {
        return;
      }

      let idPago = String(row[idxIdPago] || '').trim();

      // Si todavía no tiene ID permanente, asignarlo.
      if (!idPago) {
        ultimoNumero++;

        idPago =
          'PG-' +
          String(ultimoNumero).padStart(6, '0');

        cobros
          .getRange(numeroFila, idxIdPago + 1)
          .setValue(idPago);

        idsAsignados++;
      }

      const payload = {
        p_referencia_anterior:
          'SHEETS-REGISTRO-COBROS-FILA-' + numeroFila,

        p_referencia_nueva:
          'SHEETS-' + idPago
      };
      const response = fetchConReintentos(
        supabaseUrl +
          '/rest/v1/rpc/migrar_referencia_pago_hugella',
        {
          method: 'post',
          headers: headers,
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        }
      );

      if (
        response.getResponseCode() < 200 ||
        response.getResponseCode() >= 300
      ) {
        throw new Error(
          'Error migrando fila ' +
          numeroFila +
          ': ' +
          response.getContentText()
        );
      }

      const resultado = JSON.parse(response.getContentText());

      if (resultado) {
        referenciasMigradas++;
      } else {
        referenciasNoEncontradas++;
      }
    });

    Logger.log(
      'Migración terminada. ' +
      'IDs asignados: ' + idsAsignados +
      '. Referencias migradas: ' + referenciasMigradas +
      '. Referencias no encontradas: ' + referenciasNoEncontradas + '.'
    );
  });
}

function sincronizarPagosAdminHaciaSheets() {
  return conBloqueoRegistroCobros_(function () {
    const props = PropertiesService.getScriptProperties();

    const supabaseUrl = props.getProperty('SUPABASE_URL');
    const publishableKey = props.getProperty('SUPABASE_PUBLISHABLE_KEY');
    const email = props.getProperty('SUPABASE_IMPORT_EMAIL');
    const password = props.getProperty('SUPABASE_IMPORT_PASSWORD');

    if (!supabaseUrl || !publishableKey || !email || !password) {
      throw new Error('Faltan propiedades de Supabase en Script Properties.');
    }

    // =========================
    // LOGIN SUPABASE
    // =========================
    const loginResponse = fetchConReintentos(
      supabaseUrl + '/auth/v1/token?grant_type=password',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: publishableKey
        },
        payload: JSON.stringify({
          email: email,
          password: password
        }),
        muteHttpExceptions: true
      }
    );

    if (loginResponse.getResponseCode() !== 200) {
      throw new Error(
        'Error al iniciar sesión en Supabase: ' +
        loginResponse.getContentText()
      );
    }

    const accessToken =
      JSON.parse(loginResponse.getContentText()).access_token;

    const headers = {
      apikey: publishableKey,
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    };

    // =========================
    // BUSCAR PAGOS DEL ADMIN
    // =========================

    const pendientesResponse = fetchConReintentos(
      supabaseUrl +
        '/rest/v1/rpc/obtener_pagos_admin_pendientes_sheets',
      {
        method: 'post',
        headers: headers,
        payload: JSON.stringify({}),
        muteHttpExceptions: true
      }
    );

    if (
      pendientesResponse.getResponseCode() < 200 ||
      pendientesResponse.getResponseCode() >= 300
    ) {
      throw new Error(
        'Error obteniendo pagos pendientes: ' +
        pendientesResponse.getContentText()
      );
    }

    const pagos = JSON.parse(pendientesResponse.getContentText());

    if (!pagos.length) {
      Logger.log('No hay pagos del Admin pendientes de enviar a Sheets.');
      return;
    }

    // =========================
    // REGISTRO DE COBROS
    // =========================

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cobros = ss.getSheetByName('Registro de cobros');

    if (!cobros) {
      throw new Error('No encuentro la hoja Registro de cobros.');
    }

    const data = cobros.getDataRange().getValues();
    const encabezados = data[0].map(h => String(h).trim());

    const idx = {
      fecha: encabezados.indexOf('Fecha'),
      codigo: encabezados.indexOf('ID Crédito'),
      cliente: encabezados.indexOf('Cliente'),
      producto: encabezados.indexOf('Mercadería'),
      importe: encabezados.indexOf('Importe cobrado'),
      cuotas: encabezados.indexOf('Cuotas equivalentes'),
      medio: encabezados.indexOf('Medios de pago'),
      observaciones: encabezados.indexOf('Observaciones'),
      idPago: encabezados.indexOf('ID PAGO')
    };

    const faltantes = Object.entries(idx)
      .filter(([_, value]) => value === -1)
      .map(([key]) => key);

    if (faltantes.length) {
      throw new Error(
        'Faltan columnas en Registro de cobros: ' +
        faltantes.join(', ')
      );
    }

    // Validate the six manual columns before choosing or writing a row.
    const columnasManuales = Object.values(obtenerColumnasRetiro_(cobros))
      .map(columna => columna - 1);
    const filaLibre = (valores, formulas) => columnasManuales.every(
      columna => valores[columna] === '' && formulas[columna] === ''
    );

    // IDs que ya existen en Sheets para evitar duplicados.
    const idsExistentes = new Set(
      data.slice(1)
        .map(row => String(row[idx.idPago] || '').trim())
        .filter(Boolean)
    );

    let agregados = 0;

    pagos.forEach(pago => {
      // Usamos parte del UUID de Supabase como ID permanente.
      const idPago =
        'ADM-' +
        String(pago.pago_id)
          .replace(/-/g, '')
          .substring(0, 12)
          .toUpperCase();

      // Si ya está en Sheets, no volvemos a agregarlo.
      if (!idsExistentes.has(idPago)) {
        const maxFilas = cobros.getMaxRows();
        let nuevaFila = maxFilas + 1;
        if (maxFilas >= 2) {
          const rango = cobros.getRange(2, 1, maxFilas - 1, 9);
          const valores = rango.getValues();
          const formulas = rango.getFormulas();
          const libre = valores.findIndex((fila, indice) => filaLibre(fila, formulas[indice]));
          if (libre !== -1) nuevaFila = libre + 2;
        }

        // If every existing row contains manual data/formulas, append beyond
        // all of them, even when their Fecha cell is empty.
        if (nuevaFila > maxFilas) {
          cobros.insertRowAfter(maxFilas);
        }

        // Recheck immediately before writing; ScriptLock does not block humans.
        const destino = cobros.getRange(nuevaFila, 1, 1, 9);
        if (!filaLibre(destino.getValues()[0], destino.getFormulas()[0])) {
          throw new Error('La fila elegida dejó de estar libre. No se sobrescribió el pago.');
        }

        // Solo escribimos las columnas manuales.
        // C, D y F quedan libres para las ARRAYFORMULA de la hoja.
        cobros.getRange(nuevaFila, idx.fecha + 1)
          .setValue(new Date(pago.fecha_pago + 'T12:00:00'));

        cobros.getRange(nuevaFila, idx.codigo + 1)
          .setValue(pago.codigo_credito);

        cobros.getRange(nuevaFila, idx.importe + 1)
          .setValue(Number(pago.importe));

        cobros.getRange(nuevaFila, idx.medio + 1)
          .setValue(pago.medio_pago || '');

        cobros.getRange(nuevaFila, idx.observaciones + 1)
          .setValue(pago.observaciones || '');

        cobros.getRange(nuevaFila, idx.idPago + 1)
          .setValue(idPago);

        idsExistentes.add(idPago);
        agregados++;
      }

      // =========================
      // MARCAR COMO SINCRONIZADO
      // =========================

      const marcarResponse = fetchConReintentos(
        supabaseUrl +
          '/rest/v1/rpc/marcar_pago_sincronizado_sheets',
        {
          method: 'post',
          headers: headers,
          payload: JSON.stringify({
            p_pago_id: pago.pago_id
          }),
          muteHttpExceptions: true
        }
      );

      if (
        marcarResponse.getResponseCode() < 200 ||
        marcarResponse.getResponseCode() >= 300
      ) {
        throw new Error(
          'El pago fue escrito en Sheets pero no pudo marcarse ' +
          'como sincronizado en Supabase. Pago: ' +
          pago.pago_id +
          '. Error: ' +
          marcarResponse.getContentText()
        );
      }
    });

    // =========================
    // RECALCULAR MERCADERÍA
    // =========================

    if (agregados > 0) {
      SpreadsheetApp.flush();
      actualizarTodosLosCreditosDesdeCobros();
    }

    Logger.log(
      'Sincronización Admin → Sheets finalizada. ' +
      'Pagos pendientes encontrados: ' +
      pagos.length +
      '. Filas agregadas: ' +
      agregados +
      '.'
    );
  });
}

function fetchConReintentos(url, options, intentosMaximos = 5) {
  let ultimoError;

  for (let intento = 1; intento <= intentosMaximos; intento++) {
    try {
      const respuesta = UrlFetchApp.fetch(url, options);
      const codigo = respuesta.getResponseCode();

      const errorTemporal =
        codigo === 429 ||
        codigo === 500 ||
        codigo === 502 ||
        codigo === 503 ||
        codigo === 504;

      if (!errorTemporal) {
        return respuesta;
      }

      Logger.log(
        'Intento ' +
        intento +
        ' recibió HTTP ' +
        codigo +
        ' para ' +
        url
      );

      if (intento === intentosMaximos) {
        return respuesta;
      }

    } catch (error) {
      ultimoError = error;

      Logger.log(
        'Intento ' +
        intento +
        ' falló para ' +
        url +
        ': ' +
        error.message
      );

      if (intento === intentosMaximos) {
        throw ultimoError;
      }
    }

    // Espera progresiva: 2s, 4s, 8s, 16s...
    Utilities.sleep(
      2000 * Math.pow(2, intento - 1)
    );
  }

  if (ultimoError) {
    throw ultimoError;
  }
}

function recalcularCuotasPagasMercaderia() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const mercaderia = ss.getSheetByName('Mercadería');
  const cobros = ss.getSheetByName('Registro de cobros');

  if (!mercaderia || !cobros) {
    throw new Error(
      'No encuentro Mercadería o Registro de cobros.'
    );
  }

  // Asegurar que las ARRAYFORMULA de Registro de cobros
  // hayan terminado de calcular Cuotas equivalentes.
  SpreadsheetApp.flush();

  // =========================
  // LEER REGISTRO DE COBROS
  // =========================

  const datosCobros = cobros.getDataRange().getValues();

  if (datosCobros.length < 1) {
    return;
  }

  const encabezadosCobros =
    datosCobros[0].map(h => String(h).trim());

  const idxCodigoCobro =
    encabezadosCobros.indexOf('ID Crédito');

  const idxCuotasCobro =
    encabezadosCobros.indexOf('Cuotas equivalentes');

  if (
    idxCodigoCobro === -1 ||
    idxCuotasCobro === -1
  ) {
    throw new Error(
      'No encuentro ID Crédito o Cuotas equivalentes en Registro de cobros.'
    );
  }

  // Sumar todas las cuotas por crédito.
  const cuotasPorCredito = {};

  datosCobros.slice(1).forEach(fila => {
    const codigo =
      String(fila[idxCodigoCobro] || '').trim();

    const cuotas =
      Number(fila[idxCuotasCobro]) || 0;

    if (!codigo || cuotas <= 0) {
      return;
    }

    if (!cuotasPorCredito[codigo]) {
      cuotasPorCredito[codigo] = 0;
    }

    cuotasPorCredito[codigo] += cuotas;
  });

  // =========================
  // ACTUALIZAR MERCADERÍA
  // =========================

  const datosMercaderia =
    mercaderia.getDataRange().getValues();

  if (datosMercaderia.length < 2) {
    return;
  }

  const encabezadosMercaderia =
    datosMercaderia[0].map(h => String(h).trim());

  const idxCodigoMercaderia =
    encabezadosMercaderia.indexOf('ID CREDITO');

  const idxCuotasPagas =
    encabezadosMercaderia.indexOf('CUOTAS PAGAS');

  if (
    idxCodigoMercaderia === -1 ||
    idxCuotasPagas === -1
  ) {
    throw new Error(
      'No encuentro ID CREDITO o CUOTAS PAGAS en Mercadería.'
    );
  }

  const valoresCuotasPagas =
    datosMercaderia.slice(1).map(fila => {
      const codigo =
        String(fila[idxCodigoMercaderia] || '').trim();

      if (!codigo) {
        return [''];
      }

      return [
        Number(cuotasPorCredito[codigo] || 0)
      ];
    });

  mercaderia
    .getRange(
      2,
      idxCuotasPagas + 1,
      valoresCuotasPagas.length,
      1
    )
    .setValues(valoresCuotasPagas);

  SpreadsheetApp.flush();

  Logger.log(
    'CUOTAS PAGAS recalculadas correctamente en Mercadería.'
  );
}

function procesarEventosRetirarSheets() {
  return conBloqueoRegistroCobros_(procesarEventosRetirarSheets_);
}

function procesarEventosRetirarSheets_() {
  const conexion = obtenerConexionSupabase_();
  const eventos = llamarRpcSupabase_(
    conexion,
    'reservar_eventos_pagos_sheets',
    { p_limite: 20 }
  );

  if (!Array.isArray(eventos) || eventos.length === 0) {
    Logger.log('No hay eventos RETIRAR pendientes.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cobros = ss.getSheetByName('Registro de cobros');

  if (!cobros) {
    throw new Error('No encuentro la hoja Registro de cobros.');
  }

  const columnas = obtenerColumnasRetiro_(cobros);
  let confirmados = 0;
  let bloqueados = 0;
  let reintentos = 0;

  eventos.forEach(evento => {
    try {
      const resultado = procesarEventoRetirar_(
          conexion,
          cobros,
          columnas,
          evento
      );

      if (resultado === 'CONFIRMADO') confirmados++;
      if (resultado === 'BLOQUEADO') bloqueados++;
    } catch (error) {
      reintentos++;
      const detalle = limitarDetalleEventoRetirar_(
        'Error procesando RETIRAR ' +
        String(evento.evento_id) +
        ': ' +
        String(error && error.message ? error.message : error)
      );

      try {
        finalizarEventoRetirar_(
          conexion,
          evento,
          'REINTENTAR',
          detalle
        );
      } catch (errorFinalizacion) {
        Logger.log(
          detalle +
          '. Tampoco pudo registrarse REINTENTAR: ' +
          String(
            errorFinalizacion && errorFinalizacion.message
              ? errorFinalizacion.message
              : errorFinalizacion
          )
        );
      }
    }
  });

  Logger.log(
    'Eventos RETIRAR procesados. Confirmados: ' +
    confirmados +
    '. Bloqueados: ' +
    bloqueados +
    '. Reintentos: ' +
    reintentos +
    '.'
  );
}

function procesarEventoRetirar_(conexion, cobros, columnas, evento) {
  validarEventoRetirarReservado_(evento);

  const idPago = String(evento.id_pago_sheets);
  let filas = buscarFilasPorIdPago_(cobros, columnas.idPago, idPago);

  if (filas.length > 1) {
    finalizarEventoRetirar_(
      conexion,
      evento,
      'BLOQUEAR',
      limitarDetalleEventoRetirar_(
        'ID PAGO duplicado en Registro de cobros: ' +
        idPago +
        '. Filas: ' +
        filas.join(', ')
      )
    );
    return 'BLOQUEADO';
  }

  if (filas.length === 0) {
    if (!evento.retiro_preparado_at) {
      finalizarEventoRetirar_(
        conexion,
        evento,
        'BLOQUEAR',
        limitarDetalleEventoRetirar_(
          'No se encontró el ID PAGO ' +
          idPago +
          ' en Registro de cobros.'
        )
      );
      return 'BLOQUEADO';
    }

    SpreadsheetApp.flush();
    filas = buscarFilasPorIdPago_(cobros, columnas.idPago, idPago);

    if (filas.length > 1) {
      finalizarEventoRetirar_(
        conexion,
        evento,
        'BLOQUEAR',
        limitarDetalleEventoRetirar_(
          'El ID PAGO ' + idPago +
          ' reapareció duplicado durante el reintento. Filas: ' +
          filas.join(', ')
        )
      );
      return 'BLOQUEADO';
    }

    if (filas.length === 1) {
      throw new Error(
        'El ID PAGO ' + idPago +
        ' reapareció durante la comprobación del reintento.'
      );
    }

    recalcularCuotasPagasMercaderia();
    SpreadsheetApp.flush();
    finalizarEventoRetirar_(conexion, evento, 'CONFIRMAR', null);
    return 'CONFIRMADO';
  }

  llamarRpcSupabase_(
    conexion,
    'preparar_retiro_pago_sheets',
    {
      p_evento_id: evento.evento_id,
      p_reserva_token: evento.reserva_token
    }
  );

  limpiarColumnasManualesPago_(cobros, filas[0], columnas);
  SpreadsheetApp.flush();

  filas = buscarFilasPorIdPago_(cobros, columnas.idPago, idPago);

  if (filas.length > 1) {
    finalizarEventoRetirar_(
      conexion,
      evento,
      'BLOQUEAR',
      limitarDetalleEventoRetirar_(
        'El ID PAGO ' + idPago +
        ' aparece más de una vez después de retirar la fila. Filas: ' +
        filas.join(', ')
      )
    );
    return 'BLOQUEADO';
  }

  if (filas.length === 1) {
    throw new Error(
      'El ID PAGO ' + idPago +
      ' continúa presente en la fila ' + filas[0] +
      ' después de limpiar las columnas manuales.'
    );
  }

  recalcularCuotasPagasMercaderia();
  SpreadsheetApp.flush();
  finalizarEventoRetirar_(conexion, evento, 'CONFIRMAR', null);
  return 'CONFIRMADO';
}

function obtenerConexionSupabase_() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const publishableKey = props.getProperty('SUPABASE_PUBLISHABLE_KEY');
  const email = props.getProperty('SUPABASE_IMPORT_EMAIL');
  const password = props.getProperty('SUPABASE_IMPORT_PASSWORD');

  if (!supabaseUrl || !publishableKey || !email || !password) {
    throw new Error('Faltan propiedades de Supabase en Script Properties.');
  }

  const loginResponse = fetchConReintentos(
    supabaseUrl + '/auth/v1/token?grant_type=password',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: publishableKey
      },
      payload: JSON.stringify({
        email: email,
        password: password
      }),
      muteHttpExceptions: true
    }
  );

  if (loginResponse.getResponseCode() !== 200) {
    throw new Error(
      'Error al iniciar sesión en Supabase: ' +
      loginResponse.getContentText()
    );
  }

  const accessToken =
    JSON.parse(loginResponse.getContentText()).access_token;

  return {
    url: supabaseUrl,
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }
  };
}

function llamarRpcSupabase_(conexion, nombre, payload) {
  const response = fetchConReintentos(
    conexion.url + '/rest/v1/rpc/' + nombre,
    {
      method: 'post',
      headers: conexion.headers,
      payload: JSON.stringify(payload || {}),
      muteHttpExceptions: true
    }
  );

  const codigo = response.getResponseCode();

  if (codigo < 200 || codigo >= 300) {
    throw new Error(
      'RPC ' + nombre + ' devolvió HTTP ' + codigo + ': ' +
      response.getContentText()
    );
  }

  const contenido = response.getContentText();
  return contenido ? JSON.parse(contenido) : null;
}

function finalizarEventoRetirar_(conexion, evento, resultado, detalle) {
  llamarRpcSupabase_(
    conexion,
    'finalizar_evento_pago_sheets',
    {
      p_evento_id: evento.evento_id,
      p_reserva_token: evento.reserva_token,
      p_resultado: resultado,
      p_detalle: detalle
    }
  );
}

function validarEventoRetirarReservado_(evento) {
  if (
    !evento ||
    evento.tipo !== 'RETIRAR' ||
    !evento.evento_id ||
    !evento.pago_id ||
    !evento.id_pago_sheets ||
    !evento.reserva_token
  ) {
    throw new Error('Supabase devolvió un evento RETIRAR inválido.');
  }
}

function obtenerColumnasRetiro_(cobros) {
  const ultimaColumna = cobros.getLastColumn();

  if (ultimaColumna < 1) {
    throw new Error('Registro de cobros no tiene encabezados.');
  }

  const encabezados = cobros
    .getRange(1, 1, 1, ultimaColumna)
    .getValues()[0]
    .map(valor => String(valor).trim());

  const columnas = {
    fecha: encabezados.indexOf('Fecha') + 1,
    codigo: encabezados.indexOf('ID Crédito') + 1,
    importe: encabezados.indexOf('Importe cobrado') + 1,
    medio: encabezados.indexOf('Medios de pago') + 1,
    observaciones: encabezados.indexOf('Observaciones') + 1,
    idPago: encabezados.indexOf('ID PAGO') + 1
  };

  const faltantes = Object.keys(columnas)
    .filter(nombre => columnas[nombre] === 0);

  if (faltantes.length) {
    throw new Error(
      'Faltan columnas manuales en Registro de cobros: ' +
      faltantes.join(', ')
    );
  }

  const posicionesEsperadas = {
    fecha: 1,
    codigo: 2,
    importe: 5,
    medio: 7,
    observaciones: 8,
    idPago: 9
  };
  const posicionesIncompatibles = Object.keys(posicionesEsperadas)
    .filter(nombre => columnas[nombre] !== posicionesEsperadas[nombre]);

  if (posicionesIncompatibles.length) {
    throw new Error(
      'La estructura de Registro de cobros cambió. No se puede retirar ' +
      'sin garantizar que C, D y F permanezcan intactas.'
    );
  }

  return columnas;
}

function buscarFilasPorIdPago_(cobros, columnaIdPago, idPago) {
  const ultimaFila = cobros.getLastRow();

  if (ultimaFila < 2) {
    return [];
  }

  const valores = cobros
    .getRange(2, columnaIdPago, ultimaFila - 1, 1)
    .getDisplayValues();

  const filas = [];

  valores.forEach((fila, indice) => {
    if (String(fila[0]) === idPago) {
      filas.push(indice + 2);
    }
  });

  return filas;
}

function limpiarColumnasManualesPago_(cobros, fila, columnas) {
  cobros.getRangeList([
    cobros.getRange(fila, columnas.fecha).getA1Notation(),
    cobros.getRange(fila, columnas.codigo).getA1Notation(),
    cobros.getRange(fila, columnas.importe).getA1Notation(),
    cobros.getRange(fila, columnas.medio).getA1Notation(),
    cobros.getRange(fila, columnas.observaciones).getA1Notation(),
    cobros.getRange(fila, columnas.idPago).getA1Notation()
  ]).clearContent();
}

function limitarDetalleEventoRetirar_(detalle) {
  return String(detalle || '').substring(0, 2000);
}

function conBloqueoRegistroCobros_(accion) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    return accion();
  } finally {
    lock.releaseLock();
  }
}
