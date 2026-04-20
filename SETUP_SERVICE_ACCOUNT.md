# Configuración de Service Account de Google

## Por qué se necesita
Los Google Sheets del proyecto son privados. Para que la aplicación pueda
leerlos y escribirlos de forma automática (sin que el usuario haga login
cada vez), se usa una "Service Account" — básicamente una cuenta de robot
de Google con permisos específicos.

## Pasos

### 1. Crear el proyecto en Google Cloud
1. Ir a https://console.cloud.google.com
2. Arriba a la izquierda: selector de proyecto > "Nuevo proyecto"
3. Nombre: "Troncales Viajes" > Crear

### 2. Habilitar las APIs necesarias
Con el proyecto seleccionado:
1. Menú > APIs y servicios > Biblioteca
2. Buscar "Google Sheets API" > Habilitar
3. Buscar "Google Drive API" > Habilitar

### 3. Crear la Service Account
1. Menú > IAM y administración > Cuentas de servicio
2. "+ Crear cuenta de servicio"
3. Nombre: "troncales-sa"
4. Descripción: "Service Account para Troncales Viajes"
5. Clic en "Crear y continuar"
6. Rol: "Editor" (o saltear este paso)
7. Finalizar

### 4. Generar la clave JSON
1. Hacer clic en la cuenta recién creada
2. Pestaña "Claves" > "Agregar clave" > "Crear clave nueva"
3. Tipo: JSON > Crear
4. Se descarga un archivo .json — GUARDARLO en un lugar seguro

### 5. Compartir los Sheets con la Service Account
El archivo JSON tiene un campo "client_email" — algo como:
troncales-sa@troncales-viajes.iam.gserviceaccount.com

Compartir CADA UNO de estos Sheets con ese email (como Editor):
- Sheet Usuarios:     https://docs.google.com/spreadsheets/d/1zFI1Ozpm7W5OiH2T5N2Ymt-W364ska4zuOR8h2UJ2OA
- Sheet Direcciones:  https://docs.google.com/spreadsheets/d/1Q-ji7YQQObdQYcK9rmubKVQjNwWO5in_ugRqRYEsjkg
- Sheet Tripulantes:  https://docs.google.com/spreadsheets/d/1DnRjvrnA7UiwM2ka9Zv8YZMMuCG9LMFo3MOmbxNT8yI
- Sheet Flota:        https://docs.google.com/spreadsheets/d/1Q1xtZTADwzsY4femRfkc7xnqMXGTI4E98NbPQGOT4x0
- Sheet Otros Datos:  https://docs.google.com/spreadsheets/d/18EIK9gLn3lsDGX6GOgquBR8uJbxS_gwAs_D1YzAVT68
- Sheet Viajes:       https://docs.google.com/spreadsheets/d/1OcT1tcFT-TKbiXKrenhOBSgMBVp9WxKICwg5zmf2CkU
- Sheet Socios:       https://docs.google.com/spreadsheets/d/16BUV942_8DIrW741NvxrCSYc7xUKAm0Wi-_3Rb-u3LQ

Para compartir cada Sheet:
Abrir el Sheet > Compartir > pegar el client_email > Rol: Editor > Enviar

### 6. Compartir el folder de Drive
- Folder archivos: https://drive.google.com/drive/folders/1pSa_oU7jgxGGWTF85914y8RIxnRQGlKo
Abrir el folder > clic derecho > Compartir > pegar el client_email > Rol: Editor

### 7. Cargar el JSON en GAS
1. Abrir el archivo JSON descargado con el Bloc de notas
2. Seleccionar TODO el contenido (Ctrl+A) y copiarlo
3. En el editor GAS: Configuración del proyecto > Propiedades del script
4. Nombre: SERVICE_ACCOUNT_JSON / Valor: pegar el JSON copiado
5. Guardar

¡Listo! La aplicación ya puede acceder a los Sheets automáticamente.
