# Sistema de Tickets (Helpdesk)

Este proyecto implementa un sistema de tickets de mesa de ayuda con una interfaz de línea de comandos.

## Uso

La aplicación se ejecuta utilizando Docker y Docker Compose.

1.  **Levantar los servicios:**

    El primer paso es iniciar el bus de servicios `soabus` en segundo plano.

    ```bash
    docker compose up -d soabus
    ```

2.  **Ejecutar la aplicación cliente:**

    Una vez que el bus de servicios está en ejecución, puedes iniciar la aplicación cliente de línea de comandos.

    ```bash
    docker compose run --rm app python -m Sistema_Ticket_Soa.main
    ```

3.  **Interactuar con la aplicación:**

    Después de ejecutar el comando anterior, la aplicación se iniciará en la terminal. Los pasos típicos son:
    - Iniciar sesión (Login).
    - Crear un nuevo ticket.
    - Completar la información del ticket.
    - Confirmar la creación.
