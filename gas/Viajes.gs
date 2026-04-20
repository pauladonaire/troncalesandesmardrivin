// ============================================================
// ARCHIVO GAS: Viajes.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Viajes" y pegar este contenido
// ============================================================

/**
 * Retorna todos los datos maestros necesarios para el formulario de carga de viajes.
 * Incluye direcciones, tripulantes, flota activa, socios, rutas, arrastres y esquemas.
 */
function getDatosMaestros(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  try {
    // Leer todos los sheets necesarios
    const cfgDir = CONFIG.SHEETS.DIRECCIONES;
    const cfgTri = CONFIG.SHEETS.TRIPULANTES;
    const cfgFlo = CONFIG.SHEETS.FLOTA;
    const cfgSoc = CONFIG.SHEETS.SOCIOS;
    const cfgOtr = CONFIG.SHEETS.OTROS_DATOS;

    const rowsDirecciones  = sheetsRead_(cfgDir.id, cfgDir.tab);
    const rowsTripulantes  = sheetsRead_(cfgTri.id, cfgTri.tab);
    const rowsFlota        = sheetsRead_(cfgFlo.id, cfgFlo.tab);
    const rowsSocios       = sheetsRead_(cfgSoc.id, cfgSoc.tab);
    const rowsRutas        = sheetsRead_(cfgOtr.id, cfgOtr.tabs.RUTAS);
    const rowsArrastres    = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ARRASTRES);
    const rowsCostos       = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ESQUEMAS_COSTOS);
    const rowsIngresos     = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ESQUEMAS_INGRESOS);

    // Mapear direcciones
    const hDir = rowsDirecciones.length > 0 ? rowsDirecciones[0] : [];
    const direcciones = rowsDirecciones.slice(1).map(function(r) {
      return {
        id:        r[0] || '',
        code:      r[1] || '',
        name:      r[2] || '',
        address1:  r[3] || '',
        address2:  r[4] || '',
        city:      r[5] || '',
        state:     r[6] || '',
        country:   r[7] || '',
        postal_code: r[8] || '',
        lat:       r[9]  || '',
        lng:       r[10] || ''
      };
    });

    // Mapear tripulantes
    const tripulantes = rowsTripulantes.slice(1).map(function(r) {
      return {
        id:              r[0] || '',
        email:           r[1] || '',
        first_name:      r[2] || '',
        last_name:       r[3] || '',
        nombre_completo: r[4] || ((r[2] || '') + ' ' + (r[3] || '')).trim(),
        phone:           r[5] || '',
        is_active:       r[8] !== 'false' && r[8] !== 'FALSE'
      };
    });

    // Mapear flota (solo activos)
    const flota = rowsFlota.slice(1)
      .map(function(r) {
        return {
          id:            r[0] || '',
          code:          r[1] || '',
          name:          r[2] || '',
          plate:         r[3] || '',
          type:          r[4] || '',
          is_active:     r[7] === 'true' || r[7] === 'TRUE',
          employer_name: r[8] || '',
          tags:          r[9]  || '',
          cost_allocation_tags: r[10] || ''
        };
      })
      .filter(function(v) { return v.is_active; });

    // Mapear socios
    const socios = rowsSocios.slice(1).map(function(r) {
      return {
        id:      r[0] || '',
        code:    r[1] || '',
        name:    r[2] || '',
        type:    r[3] || '',
        address: r[4] || '',
        city:    r[5] || '',
        country: r[6] || ''
      };
    });

    // Mapear rutas maestras
    const hRut = rowsRutas.length > 0 ? rowsRutas[0] : [];
    const rutas = rowsRutas.slice(1).map(function(r) {
      var obj = {};
      hRut.forEach(function(h, i) { obj[h] = r[i] || ''; });
      return obj;
    });

    // Mapear arrastres
    const hArr = rowsArrastres.length > 0 ? rowsArrastres[0] : [];
    const arrastres = rowsArrastres.slice(1).map(function(r) {
      var obj = {};
      hArr.forEach(function(h, i) { obj[h] = r[i] || ''; });
      return obj;
    });

    return {
      direcciones:      direcciones,
      tripulantes:      tripulantes,
      flota:            flota,
      socios:           socios,
      rutas:            rutas,
      arrastres:        arrastres,
      esquemasCostos:   rowsCostos   || [],
      esquemasIngresos: rowsIngresos || []
    };
  } catch(e) {
    console.error('getDatosMaestros error: ' + e.message);
    throw new Error('Error al obtener datos maestros: ' + e.message);
  }
}
