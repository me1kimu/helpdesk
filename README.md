## Uso principal: Ticketera CLI (terminal)

La forma recomendada de interactuar es el módulo `Sistema_Ticket_Soa`, desde la terminal sin depender del frontend.

### Ejecutar con Docker (preferido)

```bash
docker compose build app          # solo la primera vez o cuando cambie el código
docker compose up -d app          # crea el contenedor si no existe y lo deja disponible
docker compose exec -it app python -m Sistema_Ticket_Soa.main
```

- El servicio `app` ya incluye las dependencias Python y ejecuta `python -m Sistema_Ticket_Soa.main`.
- Si el contenedor `app` ya está creado/arriba, basta con repetir `docker compose exec -it app python -m Sistema_Ticket_Soa.main` para reingresar a la CLI sin recrearlo.
- Si también necesitas el bus ESB para integraciones, levanta `docker compose up -d soabus` en otra terminal antes de ejecutar la CLI.
- La base de datos SQLite `sistema_tickets.db` vive dentro del contenedor efímero; si deseas persistirla, añade un volumen en `docker-compose.yml` apuntando a `Sistema_Ticket_Soa/sistema_tickets.db`.
- Credenciales admin por defecto: admin & admin123

### Ejecutar en tu máquina (sin Docker)

```bash
cd /workspaces/helpdesk
python -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\activate
pip install -r requirements.txt
python -m Sistema_Ticket_Soa.main
```

### Flujo básico y credenciales iniciales

- Usuario técnico precargado: `tecnico 1 / tecnico1234`.
- Puedes registrar nuevos usuarios directamente desde el menú principal (opción 2) y luego autenticarlos para crear tickets, agregar comentarios y revisar historiales.
- Presiona `Ctrl+C` para salir de la CLI de forma segura; el bus asíncrono se detendrá automáticamente.

---

## Integración opcional con Bus SOA (jrgiadach/soabus)

Para integrar el bus ESB se añadió un servicio "gateway" dentro del servidor Node. Este se registra en el bus con el nombre `gwapi` y reexpone cualquier endpoint HTTP del backend a través del bus.

### 1. Levantar PostgreSQL con Docker

```bash
# Opción 1: Levantar PostgreSQL en un contenedor Docker (contraseña "helpdesk" para alinear con `.env`)
docker run -d \
   --name helpdesk-db \
   -e POSTGRES_PASSWORD=helpdesk \
   -p 5432:5432 \
   postgres:16

# Si ya tenías un contenedor previo con otra contraseña, elimínalo primero:
# docker rm -f helpdesk-db
```

### 1b. Ejecutar el schema SQL

```bash
# Crear la base de datos (dentro del contenedor `helpdesk-db`):
docker exec -it helpdesk-db psql -U postgres -c "CREATE DATABASE helpdesk;"

# Ejecutar el schema SQL (se envía el archivo desde el host al contenedor usando STDIN):
docker exec -i helpdesk-db psql -U postgres -d helpdesk < db/schema.sql

# Opcionalmente, aplica las migraciones adicionales:
docker exec -i helpdesk-db psql -U postgres -d helpdesk < db/migrations/002_assignment_and_notifications.sql
docker exec -i helpdesk-db psql -U postgres -d helpdesk < db/migrations/003_inventory_and_sales.sql

# Verificar que todo está correcto:
docker exec -it helpdesk-db psql -U postgres -d helpdesk -c "SELECT id, full_name, email, role FROM users ORDER BY id;"
```


### 2. Levantar el bus

```
docker compose -f docker-compose.bus.yml up -d
```

Por defecto expone el puerto 5000. Puedes ajustarlo con la variable `BUS_PORT`.

### 3. Variables de entorno relevantes

```
BUS_HOST=127.0.0.1
BUS_PORT=5000
BUS_SERVICE_NAME=gwapi
BUS_RECONNECT_DELAY_MS=5000
```

### 4. Flujo de trabajo

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

### 5. Cliente de ejemplo

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

### 6. Formato de frames

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

### 7. Tarea de asignación automática

El proceso cron que invoca `fn_process_assignment_queue` requiere una base de datos PostgreSQL disponible. Para evitar errores en entornos de desarrollo sin DB, el job se encuentra deshabilitado por defecto. Si cuentas con una instancia operativa puedes reactivarlo definiendo las siguientes variables en `frontend-node/.env` (o en tu entorno):

```bash
ASSIGNMENT_JOB_ENABLED=true
# Opcional: ajustar el cron y el tamaño del lote
ASSIGNMENT_JOB_SCHEDULE="*/1 * * * *"
ASSIGNMENT_JOB_BATCH_SIZE=20
```

Cuando está habilitado, el job usa la cadena de conexión configurada en `DATABASE_URL` (o los valores `DB_*`) y registrará advertencias si no puede conectarse.

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
    ```

2. (Contenido histórico del backend se mantiene fuera de este README).

## Modo gráfico opcional (Frontend Node + API mock)

Para quienes prefieren una interfaz web, el repositorio mantiene un frontend en Node/Express con datos en memoria. Úsalo solo después de haber revisado la ticketera CLI.

1. **Requisitos**: Node.js 18+ (probado con Node 22).
2. **Instalación y arranque**:

   ```bash
   cd frontend-node
   npm install
   npm run start   # o npm run dev para recarga con nodemon
   ```

3. **Acceso**: abre <http://localhost:3000/>.
4. **Credenciales demo**:
   - `admin@helpdesk.local / admin123` (rol ADMIN)
   - `trabajador@helpdesk.local / worker123` (rol EMPLOYEE)

Notas rápidas:
- Los endpoints viven en `src/server.js` y almacenan los datos en memoria, por lo que se reinician al reiniciar el servidor.
- Disponible REST mock: `/ventas/user/login/`, `/ventas/user/me/`, `/ventas/productos/`, `/ventas/stocks/`, `/ventas/transacciones/`, `/ventas/historial-ventas/`, `/ventas/usuarios/`, entre otros.
- Recuperación de contraseña de prueba configurable con `PASSWORD_RESET_EXPIRES_MINUTES` y `PASSWORD_RESET_REVEAL_TOKEN` en `frontend-node/.env`.
- La suite `npm test` (Vitest) valida el gateway ESB y se mantiene para diagnosticar integraciones con el bus.
