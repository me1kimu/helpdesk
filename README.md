# ManuMarket

Repositorio para el proyecto de punto de ventas y gestión de inventario de *ManuMarket*.

## Tecnologías usadas

- **Backend**: Django 5.2, Django REST Framework, django-cors-headers
- **Frontend**: Tailwind CSS
- **Entorno**: Python 3.12+, Node.js 18+

---

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

   - admin / admin123 (rol ADMIN)
   - trabajador / worker123 (rol EMPLOYEE)

Notas:
- Todas las páginas consumen endpoints same-origin, servidos por Express en `src/server.js`.
- Los datos se almacenan en memoria y se reinician en cada arranque.
- Endpoints disponibles: /ventas/user/login/, /ventas/user/me/, /ventas/productos/, /ventas/stocks/, /ventas/transacciones/, /ventas/historial-ventas/, /ventas/usuarios/, etc.

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
