# Cómo deployar el proyecto

## Arquitectura
- **Frontend**: GitHub Pages (archivos estáticos en la raíz del repo)
- **Backend/API**: Google Apps Script Web App (archivos `.gs` en la carpeta `gas/`)
- **Base de datos**: Google Sheets (acceso via Service Account desde GAS)

---

## PASO 1 — Service Account de Google

Seguir las instrucciones de `SETUP_SERVICE_ACCOUNT.md` para:
1. Crear proyecto en Google Cloud
2. Habilitar Sheets API y Drive API
3. Crear Service Account y descargar el JSON de credenciales
4. Compartir todos los Sheets y la carpeta de Drive con el `client_email`

---

## PASO 2 — Google Apps Script (backend)

1. Ir a [script.google.com](https://script.google.com) → **Nuevo proyecto** → nombrar **"Troncales API"**

2. En **Configuración del proyecto** → activar **"Mostrar el archivo de manifiesto appsscript.json"**

3. Hacer clic en `appsscript.json` y reemplazar TODO el contenido con el del archivo `appsscript.json` de este repo

4. Crear cada archivo `.gs` de la carpeta `gas/`:
   - Clic en **"+"** → **Script** → pegar nombre y contenido
   - **Orden de creación** (importante):
     1. `Config`
     2. `ServiceAccount`
     3. `Auth`
     4. `Usuarios`
     5. `Drivin`
     6. `OtrosDatos`
     7. `Viajes`
     8. `Excel`
     9. `Scheduler`
     10. `Code` ← **este último**

5. En **Configuración del proyecto** → **Propiedades del script** → agregar:
   - **Nombre:** `SERVICE_ACCOUNT_JSON`
   - **Valor:** pegar el contenido completo del archivo JSON de la Service Account

6. **Implementar como Web App:**
   - Implementar → Nueva implementación → **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquiera**
   - Copiar la URL generada (ejemplo: `https://script.google.com/macros/s/AKfycb.../exec`)

---

## PASO 3 — Conectar frontend con el backend

Abrir `js/api.js` y reemplazar el placeholder con la URL real:

```javascript
// ANTES:
const GAS_URL = 'TU_URL_GAS_AQUI';

// DESPUÉS:
const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

---

## PASO 4 — GitHub Pages (frontend)

1. Crear un repositorio en GitHub (público o privado con GitHub Pro)
2. Subir todos los archivos del proyecto (raíz + `css/` + `js/` + `gas/`)
3. En el repositorio → **Settings** → **Pages**
   - Branch: `main` (o `master`)
   - Carpeta: `/ (root)`
   - Guardar
4. GitHub genera una URL tipo: `https://tuusuario.github.io/troncales-viajes`

Cada vez que hagas `git push`, el frontend se actualiza automáticamente.

---

## PASO 5 — Activar scheduler (una sola vez)

En el editor GAS, seleccionar la función `setupDailyTriggers` y hacer clic en **Ejecutar**.
Esto activa la sincronización automática diaria a las 3 AM.

---

## PASO 6 — Crear el primer usuario administrador

En el editor GAS, crear y ejecutar esta función una sola vez:

```javascript
function crearPrimerAdmin() {
  const salt = generateSalt_();
  const hash = hashPassword_('contraseña_inicial', salt);  // ← cambiar contraseña
  sheetsAppend_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab, [[
    'tu@email.com',     // ← cambiar
    'Nombre Apellido',  // ← cambiar
    hash,
    salt,
    'ADMIN_GENERAL',
    'TRUE',
    new Date().toISOString(),
    new Date().toISOString()
  ]]);
  console.log('Admin creado OK');
}
```

Luego **eliminar la función** del editor y acceder desde la URL de GitHub Pages.

---

## Actualizar el frontend después de cambios

```bash
git add .
git commit -m "descripcion del cambio"
git push
```
GitHub Pages se actualiza en ~1 minuto.

## Actualizar el backend (GAS) después de cambios

1. Modificar el archivo en el editor GAS
2. **Implementar** → **Gestionar implementaciones** → editar → **Nueva versión** → Implementar

> La URL de la Web App no cambia al crear nuevas versiones.
