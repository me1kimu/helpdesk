# Helpdesk Database Schema

The `schema.sql` file defines a PostgreSQL schema for the helpdesk platform described in `docs/Informe_3__Ingenieria_de_software_.pdf`. It covers the functional and non-functional requirements around authentication, ticket lifecycle management, reporting, notifications, and geolocation consent.

## Highlights

- **Core entities**: `users`, `categories`, `tickets`, `ticket_comments`, `ticket_attachments`.
- **Workflow tracking**: `ticket_history`, `ticket_sla_breaches`, `ticket_followers`, `ticket_daily_summary`.
- **Security**: login throttling fields, session storage, password reset tokens.
- **Notifications**: outbox pattern via `integration_events`, `notification_jobs`, and `in_app_notifications`.
- **Auto-asignacion support**: coordinator capacity (`coordinator_profiles`, `coordinator_load`), rules, and assignment queue.
- **Geolocation**: optional latitude/longitude with consent flag and spatial index (requires `cube` and `earthdistance` extensions).

## Usage

1. Ensure PostgreSQL 14+ is available.
2. Connect with a superuser role (extensions require elevated privileges).
3. Run the script:

   ```bash
   psql -U <user> -d <database> -f db/schema.sql
   ```

The script includes starter data for categories and demo users and can be re-run in a clean database thanks to the `BEGIN/COMMIT` block.

### Additional migrations

After the base schema you can apply incremental migrations stored in `db/migrations/`. For example, to load the auto-asignación helpers and notification views:

```bash
psql -U <user> -d <database> -f db/migrations/002_assignment_and_notifications.sql
```
