# ManuMarket

Repositorio para el proyecto de punto de ventas y gestión de inventario de *ManuMarket*.

## Tecnologías usadas

- **Backend**: Django 5.2, Django REST Framework, django-cors-headers
- **Frontend**: Tailwind CSS
- **Entorno**: Python 3.12+, Node.js 18+

---

## Bus SOA (jrgiadach/soabus)

Para integrar el bus ESB se añadió un servicio "gateway" dentro del servidor Node. Este se registra en el bus con el nombre `gwapi` y reexpone cualquier endpoint HTTP del backend a través del bus.

### 1. Levantar el bus

```
docker compose -f docker-compose.bus.yml up -d
```

Por defecto expone el puerto 5000. Puedes ajustarlo con la variable `BUS_PORT`.

### 2. Variables de entorno relevantes

```
BUS_HOST=127.0.0.1
BUS_PORT=5000
BUS_SERVICE_NAME=gwapi
BUS_RECONNECT_DELAY_MS=5000
```

### 3. Flujo de trabajo

1. Inicia el servidor (`npm start` en `frontend-node/`).
2. El servidor abrirá una conexión con el bus y enviará `sinitgwapi` para registrarse.
3. Cualquier cliente puede enviar frames al bus con el prefijo `gwapi` y un JSON del tipo:

    ```json
    {
       "method": "GET",
       "path": "/health",
       "query": {},
       "body": null,
       "headers": {
          "authorization": "Bearer <token>"
       }
    }
    ```

4. El gateway ejecuta la petición HTTP contra el backend y devuelve el resultado en el frame de respuesta.

### 4. Cliente de ejemplo

Se añadió un script de utilidad para enviar peticiones rápidas al bus:

```
cd frontend-node
node scripts/sendBusRequest.js --method GET --path /health
```

Parámetros opcionales:

- `--service`: nombre del servicio registrado en el bus (por defecto `gwapi`).
- `--method`: verbo HTTP.
- `--path`: ruta absoluta del backend.
- `--query`: objeto JSON serializado, por ejemplo `--query '{"codigo":"ABC"}'`.
- `--body`: objeto JSON serializado para métodos con payload.

El script imprime la respuesta del bus, incluyendo el estado (`OK`/`NK`) y el JSON devuelto por el backend.

### 5. Formato de frames

El protocolo del bus utiliza un encabezado de 5 dígitos con el largo del payload seguido del contenido:

```
00023gwapi{"method":"GET","path":"/health"}
```

La respuesta incluye el identificador del remitente (5 caracteres), dos caracteres de estado (`OK` o `NK`) y el JSON resultante.

Ejemplo real usando `printf` y `nc`:

```
printf '00023gwapi{"method":"GET","path":"/health"}' | nc 127.0.0.1 5000
```

> Nota: asegúrate de escapar las comillas correctamente o utiliza el script incluido para evitar errores de formato.

## Ejecución (modo solo-frontend con API mock)

Recomendado para desarrollo rápido y sin dependencias de Django/Postgres.

1. Requisitos: Node.js 18+ (probado con Node 22)
2. Inicia el servidor del frontend (incluye API mock en memoria):

   ```bash
   cd frontend-node
   npm install
   npm run start # o npm run dev para recarga con nodemon
   ```

3. Abre el frontend: <http://localhost:3000/>

4. Credenciales de demo:

   - admin@helpdesk.local / admin123 (rol ADMIN)
   - trabajador@helpdesk.local / worker123 (rol EMPLOYEE)

Notas:
- Todas las páginas consumen endpoints same-origin, servidos por Express en `src/server.js`.
- Los datos se almacenan en memoria y se reinician en cada arranque.
- Endpoints disponibles: /ventas/user/login/, /ventas/user/me/, /ventas/productos/, /ventas/stocks/, /ventas/transacciones/, /ventas/historial-ventas/, /ventas/usuarios/, etc.
- Recuperación de contraseña: visita `/forgot-password`, solicita el enlace y usa `/reset-password?token=<codigo>` para definir una nueva clave. En desarrollo se muestra el token generado directamente en pantalla para facilitar las pruebas. Controla el comportamiento con:

   ```bash
   PASSWORD_RESET_EXPIRES_MINUTES=60
   PASSWORD_RESET_REVEAL_TOKEN=true # en producción cámbialo a false
   ```

### Pruebas automatizadas del bus

Se añadió una suite con [Vitest](https://vitest.dev/) para validar el gateway ESB:

```bash
cd frontend-node
npm test
```

Los tests mockean la conexión TCP y verifican el handshake y la respuesta a frames de instrucción.

## Ejecución completa con Docker (backend Django + Postgres)

Opcional. Mantener para referencia histórica. El frontend ya no requiere el backend para funcionar.

1. Activar entorno virtual (si deseas trabajar backend):

    ```bash
    python -m venv env
    source env/bin/activate # Windows: .\\env\\Scripts\\Activate.ps1
   # ManuMarket (Frontend-only)

   Este repositorio ha sido convertido a modo "solo-frontend" para facilitar el desarrollo y demostraciones sin dependencias externas.

   El frontend se sirve con Node/Express desde `frontend-node/src/server.js` e incluye un API mock en memoria que emula los endpoints necesarios para la UI.

   ## Requisitos

   - Node.js 18+ (probado con Node 22)
   - npm

   ## Ejecutar (modo rápido)

   ```bash
   cd frontend-node
   npm install
   npm run start
   # Abrir http://localhost:3000/
   ```

   ## Credenciales demo

   - admin / admin123 (ADMIN)
   - trabajador / worker123 (EMPLOYEE)

   ## Notas

   - Los datos del API mock son almacenados en memoria y se reinician al reiniciar el servidor.
   - Endpoints principales disponibles: `/ventas/user/login/`, `/ventas/user/me/`, `/ventas/productos/`, `/ventas/stocks/`, `/ventas/transacciones/`, `/ventas/historial-ventas/`, `/ventas/usuarios/`.
   - Si más tarde deseas volver a integrar un backend real, reintroduce la carpeta `backend/` con tu API y ajusta las rutas si es necesario.

   ---
