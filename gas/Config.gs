// ============================================================
// ARCHIVO GAS: Config.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Config" y pegar este contenido
// ============================================================

const CONFIG = {
  DRIVIN: {
    BASE_URL: 'https://external.driv.in/api/external/v2',
    API_KEY:  '19402340-536d-465b-8fd8-fb6d3e9f7417'
  },
  SHEETS: {
    USUARIOS:    { id: '1zFI1Ozpm7W5OiH2T5N2Ymt-W364ska4zuOR8h2UJ2OA', tab: 'UsuariosTroncales' },
    DIRECCIONES: { id: '1Q-ji7YQQObdQYcK9rmubKVQjNwWO5in_ugRqRYEsjkg', tab: 'DireccionesTroncales' },
    TRIPULANTES: { id: '1DnRjvrnA7UiwM2ka9Zv8YZMMuCG9LMFo3MOmbxNT8yI', tab: 'TripulantesTroncales' },
    FLOTA:       { id: '1Q1xtZTADwzsY4femRfkc7xnqMXGTI4E98NbPQGOT4x0', tab: 'FlotaTroncales' },
    OTROS_DATOS: {
      id: '18EIK9gLn3lsDGX6GOgquBR8uJbxS_gwAs_D1YzAVT68',
      tabs: {
        RUTAS:             'RutasMaestras',
        ARRASTRES:         'Arrastres',
        ESQUEMAS_COSTOS:   'Esquemas-Costos',
        ESQUEMAS_INGRESOS: 'Esquemas-Ingresos'
      }
    },
    VIAJES:  { id: '1OcT1tcFT-TKbiXKrenhOBSgMBVp9WxKICwg5zmf2CkU', tab: 'ViajesTotalesTroncales' },
    SOCIOS:  { id: '16BUV942_8DIrW741NvxrCSYc7xUKAm0Wi-_3Rb-u3LQ',  tab: 'SociosDeNegocioTroncales' }
  },
  DRIVE: {
    FOLDER_ID: '1pSa_oU7jgxGGWTF85914y8RIxnRQGlKo'
  },
  SESSION_DURATION_HOURS: 8
};
