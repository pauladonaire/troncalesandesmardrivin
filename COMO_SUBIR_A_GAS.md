# Cómo subir el proyecto a Google Apps Script

## Paso 1 — Crear el proyecto
1. Ir a https://script.google.com
2. Hacer clic en "Nuevo proyecto"
3. Cambiar el nombre del proyecto (arriba a la izquierda) a "Troncales Viajes"

## Paso 2 — Configurar appsscript.json
1. En el editor, hacer clic en el ícono de engranaje (Configuración del proyecto)
2. Activar la opción "Mostrar el archivo de manifiesto appsscript.json"
3. Volver al editor — ahora vas a ver el archivo appsscript.json en la lista
4. Hacer clic en appsscript.json y reemplazar TODO su contenido con el del archivo appsscript.json de este proyecto

## Paso 3 — Cargar las credenciales de la Service Account
1. Seguir las instrucciones de SETUP_SERVICE_ACCOUNT.md para obtener el JSON
2. En el editor GAS: Configuración del proyecto > Propiedades del script
3. Agregar propiedad:
   - Nombre: SERVICE_ACCOUNT_JSON
   - Valor: pegar el contenido COMPLETO del archivo JSON de la Service Account

## Paso 4 — Crear los archivos de Script (.gs)
En el editor GAS, por cada archivo .gs, hacer:
1. Clic en el "+" junto a "Archivos" > "Script"
2. Nombrar el archivo EXACTAMENTE como indica el comentario de cabecera
3. Borrar el contenido por defecto y pegar el contenido del archivo correspondiente

Orden de creación (importante):
1. Config.gs
2. ServiceAccount.gs
3. Auth.gs
4. Usuarios.gs
5. Drivin.gs
6. OtrosDatos.gs
7. Viajes.gs
8. Excel.gs
9. Scheduler.gs
10. Code.gs  ← este último

## Paso 5 — Crear los archivos HTML
Por cada archivo .html, hacer:
1. Clic en "+" > "HTML"
2. Nombrar EXACTAMENTE como indica el comentario de cabecera (sin la extensión .html)
3. Borrar contenido por defecto y pegar el contenido del archivo

Orden de creación:
1. global.css   (archivo HTML con nombre "global.css")
2. login.css
3. dashboard.css
4. viajes.css
5. admin.css
6. api.js
7. login.js
8. dashboard.js
9. viajes.js
10. admin.js
11. Index
12. Dashboard
13. Viajes
14. Admin

## Paso 6 — Activar el scheduler
1. En el editor GAS, abrir Scheduler.gs
2. Seleccionar la función "setupDailyTriggers" en el desplegable de funciones
3. Hacer clic en "Ejecutar"
4. Autorizar los permisos que pida
Esto activa la sincronización automática diaria a las 3 AM. Se hace UNA SOLA VEZ.

## Paso 7 — Deployar como Web App
1. En el editor GAS: Implementar > Nueva implementación
2. Tipo: Aplicación web
3. Descripción: "v1.0"
4. Ejecutar como: "Yo (tu-email@empresa.com)"
5. Quién tiene acceso: "Cualquier usuario del dominio" (tu Google Workspace)
6. Hacer clic en "Implementar"
7. Copiar la URL que aparece — esa es la URL de tu aplicación

## Paso 8 — Cada vez que hagas cambios
1. Modificar el archivo en el editor GAS
2. Implementar > Gestionar implementaciones > editar > Nueva versión > Implementar

## Paso 9 — Crear el primer usuario administrador
Dado que la aplicación requiere login, el primer usuario debe crearse directamente
en el Sheet UsuariosTroncales:

1. Abrir el Sheet: https://docs.google.com/spreadsheets/d/1zFI1Ozpm7W5OiH2T5N2Ymt-W364ska4zuOR8h2UJ2OA
2. Ir a la hoja "UsuariosTroncales"
3. Asegurarse de que la fila 1 (encabezados) sea:
   email | nombre_completo | password_hash | salt | rol | activo | fecha_creacion | fecha_modificacion
4. En el editor GAS, crear una función temporal para hashear la contraseña inicial:

```javascript
function crearPrimerAdmin() {
  var email    = 'tu@email.com';        // ← cambiar
  var password = 'contraseña_inicial';  // ← cambiar
  var nombre   = 'Nombre Apellido';     // ← cambiar
  
  var salt = generateSalt_();
  var hash = hashPassword_(password, salt);
  var now  = new Date().toISOString();
  
  sheetsAppend_(
    CONFIG.SHEETS.USUARIOS.id,
    CONFIG.SHEETS.USUARIOS.tab,
    [[email, nombre, hash, salt, 'ADMIN_GENERAL', 'TRUE', now, now]]
  );
  console.log('Admin creado OK');
}
```

5. Ejecutar la función `crearPrimerAdmin` desde el editor
6. Eliminar la función una vez creado el usuario
7. Desde la aplicación web, ingresar con esas credenciales
