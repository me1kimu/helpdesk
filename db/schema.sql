-- Helpdesk schema implementing requirements from Informe 3 (Ingenieria de Software)
-- Database: PostgreSQL 14+

BEGIN;

-- Extensions -----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Enumerations ----------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('ADMIN', 'COORDINADOR', 'USUARIO');
CREATE TYPE ticket_priority AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');
CREATE TYPE ticket_state AS ENUM ('NUEVO', 'EN_PROGRESO', 'RESUELTO', 'CERRADO');
CREATE TYPE ticket_source AS ENUM ('WEB', 'API', 'EMAIL', 'CHATBOT');
CREATE TYPE ticket_event_type AS ENUM (
    'TICKET_CREATED',
    'TICKET_ASSIGNED',
    'TICKET_UPDATED',
    'TICKET_COMMENTED',
    'TICKET_ATTACHMENT_ADDED',
    'TICKET_STATE_CHANGED',
    'TICKET_REOPENED',
    'TICKET_CLOSED',
    'TICKET_CANCELLED'
);
CREATE TYPE notification_channel AS ENUM ('EMAIL', 'IN_APP');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');
CREATE TYPE audit_action AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE');

-- Utility functions ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Core master data -------------------------------------------------------------
CREATE TABLE users (
    id               BIGSERIAL PRIMARY KEY,
    full_name        VARCHAR(120) NOT NULL,
    email            VARCHAR(120) NOT NULL UNIQUE,
    password_hash    VARCHAR(255) NOT NULL,
    role             user_role NOT NULL DEFAULT 'USUARIO',
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at    TIMESTAMPTZ,
    failed_attempts  SMALLINT NOT NULL DEFAULT 0,
    locked_until     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_set_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE ticket_tags (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE
);

-- Tickets ----------------------------------------------------------------------
CREATE TABLE tickets (
    id                  BIGSERIAL PRIMARY KEY,
    title               VARCHAR(120) NOT NULL,
    description         TEXT NOT NULL,
    categoria_id        INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    priority            ticket_priority NOT NULL DEFAULT 'MEDIA',
    status              ticket_state NOT NULL DEFAULT 'NUEVO',
    requester_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assignee_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source              ticket_source NOT NULL DEFAULT 'WEB',
    reopen_count        INTEGER NOT NULL DEFAULT 0,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    sla_due_at          TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_state_change   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location_lat        NUMERIC(8,6),
    location_lng        NUMERIC(9,6),
    location_notes      VARCHAR(255),
    location_consent    BOOLEAN,
    metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
    CONSTRAINT chk_ticket_dates CHECK (closed_at IS NULL OR closed_at >= created_at)
);

CREATE INDEX idx_tickets_status_priority ON tickets (status, priority);
CREATE INDEX idx_tickets_category ON tickets (categoria_id);
CREATE INDEX idx_tickets_requester ON tickets (requester_id);
CREATE INDEX idx_tickets_assignee ON tickets (assignee_id);
CREATE INDEX idx_tickets_sla_due_at ON tickets (sla_due_at);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);
CREATE INDEX idx_tickets_location ON tickets USING GIST (ll_to_earth(location_lat, location_lng))
    WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

CREATE TRIGGER trg_tickets_set_timestamp
BEFORE UPDATE ON tickets
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

-- Ticket tagging ----------------------------------------------------------------
CREATE TABLE ticket_tag_map (
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES ticket_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, tag_id)
);

-- Ticket history and auditing ---------------------------------------------------
CREATE TABLE ticket_history (
    id                 BIGSERIAL PRIMARY KEY,
    ticket_id          BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    from_status        ticket_state,
    to_status          ticket_state,
    from_priority      ticket_priority,
    to_priority        ticket_priority,
    from_assignee_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    to_assignee_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    comment            TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_history_ticket_id ON ticket_history (ticket_id);
CREATE INDEX idx_ticket_history_created_at ON ticket_history (created_at);

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    entity_name  VARCHAR(80) NOT NULL,
    entity_id    BIGINT NOT NULL,
    action       audit_action NOT NULL,
    actor_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    change_set   JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log (entity_name, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);

-- Comments and attachments ------------------------------------------------------
CREATE TABLE ticket_comments (
    id           BIGSERIAL PRIMARY KEY,
    ticket_id    BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    body         TEXT NOT NULL,
    is_internal  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_ticket_comments_set_timestamp
BEFORE UPDATE ON ticket_comments
FOR EACH ROW
EXECUTE PROCEDURE set_timestamp();

CREATE INDEX idx_ticket_comments_ticket ON ticket_comments (ticket_id);

CREATE TABLE ticket_attachments (
    id             BIGSERIAL PRIMARY KEY,
    ticket_id      BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    uploader_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    filename       VARCHAR(120) NOT NULL,
    storage_path   VARCHAR(255) NOT NULL,
    mime_type      VARCHAR(100) NOT NULL,
    file_size      INTEGER,
    checksum       VARCHAR(64),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_attachments_ticket ON ticket_attachments (ticket_id);

-- SLA tracking ------------------------------------------------------------------
CREATE TABLE ticket_sla_breaches (
    id               BIGSERIAL PRIMARY KEY,
    ticket_id        BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    breached_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at  TIMESTAMPTZ,
    acknowledged_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    notes            TEXT
);

-- Auto-assignment support -------------------------------------------------------
CREATE TABLE coordinator_profiles (
    user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    max_concurrent INTEGER NOT NULL DEFAULT 5,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    skills         TEXT[],
    regions        TEXT[]
);

CREATE TABLE coordinator_load (
    user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    open_tickets   INTEGER NOT NULL DEFAULT 0,
    last_assigned  TIMESTAMPTZ
);

CREATE TABLE assignment_rules (
    id            SERIAL PRIMARY KEY,
    categoria_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    priority      ticket_priority,
    region        TEXT,
    weight        SMALLINT NOT NULL DEFAULT 1,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ticket_assignment_queue (
    id            BIGSERIAL PRIMARY KEY,
    ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts      SMALLINT NOT NULL DEFAULT 0,
    last_attempt  TIMESTAMPTZ
);

-- Notifications -----------------------------------------------------------------
CREATE TABLE integration_events (
    id            BIGSERIAL PRIMARY KEY,
    ticket_id     BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
    event_type    ticket_event_type NOT NULL,
    payload       JSONB NOT NULL,
    locked_by     VARCHAR(120),
    locked_at     TIMESTAMPTZ,
    available_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts      SMALLINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_events_available ON integration_events (available_at, attempts);
CREATE INDEX idx_integration_events_type ON integration_events (event_type);

CREATE TABLE notification_jobs (
    id               BIGSERIAL PRIMARY KEY,
    event_id         BIGINT REFERENCES integration_events(id) ON DELETE CASCADE,
    channel          notification_channel NOT NULL,
    recipient        VARCHAR(255) NOT NULL,
    subject          VARCHAR(160),
    message          TEXT NOT NULL,
    status           notification_status NOT NULL DEFAULT 'PENDING',
    error_message    TEXT,
    scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMPTZ,
    last_attempt_at  TIMESTAMPTZ,
    retry_count      SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_notification_jobs_status ON notification_jobs (status, scheduled_at);
CREATE INDEX idx_notification_jobs_recipient ON notification_jobs (recipient);

CREATE TABLE in_app_notifications (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         VARCHAR(120) NOT NULL,
    body          TEXT NOT NULL,
    is_read       BOOLEAN NOT NULL DEFAULT FALSE,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_id      BIGINT REFERENCES integration_events(id) ON DELETE SET NULL
);

CREATE INDEX idx_in_app_notifications_user ON in_app_notifications (user_id, is_read);

-- Sessions and security ---------------------------------------------------------
CREATE TABLE user_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token  VARCHAR(255) NOT NULL UNIQUE,
    ip_address     INET,
    user_agent     VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    revoked_reason TEXT
);

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id, expires_at);

CREATE TABLE password_reset_tokens (
    token        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    request_ip   INET
);

-- Comments subscriptions --------------------------------------------------------
CREATE TABLE ticket_followers (
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscribed  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticket_id, user_id)
);

-- Reporting snapshots -----------------------------------------------------------
CREATE TABLE ticket_daily_summary (
    summary_date       DATE NOT NULL,
    categoria_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    total_new          INTEGER NOT NULL DEFAULT 0,
    total_in_progress  INTEGER NOT NULL DEFAULT 0,
    total_resolved     INTEGER NOT NULL DEFAULT 0,
    total_closed       INTEGER NOT NULL DEFAULT 0,
    avg_resolution_minutes NUMERIC(10,2),
    reopen_rate        NUMERIC(5,2),
    PRIMARY KEY (summary_date, categoria_id)
);

-- Views ------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_ticket_backlog AS
SELECT
    t.id,
    t.title,
    t.priority,
    t.status,
    t.created_at,
    t.sla_due_at,
    EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 AS hours_open,
    u.full_name AS requester_name,
    a.full_name AS assignee_name,
    c.name AS category_name
FROM tickets t
JOIN users u ON u.id = t.requester_id
LEFT JOIN users a ON a.id = t.assignee_id
JOIN categories c ON c.id = t.categoria_id
WHERE t.status IN ('NUEVO', 'EN_PROGRESO');

CREATE OR REPLACE VIEW vw_ticket_resolution_metrics AS
SELECT
    c.name AS category_name,
    DATE_TRUNC('month', t.closed_at) AS month_bucket,
    COUNT(*) FILTER (WHERE t.status = 'RESUELTO') AS resolved_count,
    COUNT(*) FILTER (WHERE t.status = 'CERRADO') AS closed_count,
    AVG(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)) / 3600) AS avg_resolution_hours,
    SUM(CASE WHEN t.reopen_count > 0 THEN 1 ELSE 0 END)::NUMERIC / GREATEST(COUNT(*), 1) * 100 AS reopen_rate_percent
FROM tickets t
JOIN categories c ON c.id = t.categoria_id
WHERE t.closed_at IS NOT NULL
GROUP BY c.name, DATE_TRUNC('month', t.closed_at);

-- Seed data --------------------------------------------------------------------
INSERT INTO categories (name, description) VALUES
    ('Hardware', 'Incidencias relacionadas con equipos físicos'),
    ('Software', 'Problemas o requerimientos de aplicaciones internas'),
    ('Redes', 'Conectividad, VPN, firewall, etc.'),
    ('Soporte General', 'Consultas generales de soporte');

INSERT INTO users (full_name, email, password_hash, role)
VALUES
    ('Administrador Demo', 'admin@helpdesk.local', '$2b$12$examplehashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'ADMIN'),
    ('Coordinador Demo', 'coordinador@helpdesk.local', '$2b$12$examplehashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'COORDINADOR'),
    ('Usuario Demo', 'usuario@helpdesk.local', '$2b$12$examplehashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'USUARIO');

COMMIT;
