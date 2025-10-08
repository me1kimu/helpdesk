-- Migration 002: assignment helpers and notification conveniences
-- Applies on top of schema.sql base objects

BEGIN;

CREATE OR REPLACE FUNCTION fn_select_coordinator_for_ticket(p_ticket_id BIGINT)
RETURNS BIGINT AS $$
DECLARE
  v_ticket RECORD;
  v_candidate RECORD;
BEGIN
  SELECT t.id, t.categoria_id, t.priority, t.metadata
  INTO v_ticket
  FROM tickets t
  WHERE t.id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH ranked AS (
    SELECT
      cp.user_id,
      cp.max_concurrent,
      cp.skills,
      cp.regions,
      COALESCE(cl.open_tickets, 0) AS open_tickets,
      cl.last_assigned,
      COALESCE(ar.weight, 1) AS rule_weight,
      ROW_NUMBER() OVER (
        ORDER BY
          COALESCE(cl.open_tickets, 0) ASC,
          COALESCE(cl.last_assigned, '1970-01-01'::timestamptz) ASC,
          COALESCE(ar.weight, 1) DESC
      ) AS rank
    FROM coordinator_profiles cp
    LEFT JOIN coordinator_load cl ON cl.user_id = cp.user_id
    LEFT JOIN assignment_rules ar
      ON ar.active IS TRUE
      AND (ar.categoria_id IS NULL OR ar.categoria_id = v_ticket.categoria_id)
      AND (ar.priority IS NULL OR ar.priority = v_ticket.priority)
      AND (ar.region IS NULL OR (cp.regions && ARRAY[ar.region]))
    WHERE cp.active IS TRUE
      AND (cl.open_tickets IS NULL OR cl.open_tickets < cp.max_concurrent)
  )
  SELECT * INTO v_candidate
  FROM ranked
  WHERE rank = 1;

  RETURN v_candidate.user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_enforce_coordinator_load(p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO coordinator_load (user_id, open_tickets, last_assigned)
  VALUES (p_user_id, 0, NULL)
  ON CONFLICT (user_id)
  DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_increment_coordinator_load(p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  PERFORM fn_enforce_coordinator_load(p_user_id);
  UPDATE coordinator_load
  SET open_tickets = open_tickets + 1,
      last_assigned = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_decrement_coordinator_load(p_user_id BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE coordinator_load
  SET open_tickets = GREATEST(open_tickets - 1, 0)
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_assign_ticket_from_queue(p_ticket_id BIGINT, p_actor_id BIGINT DEFAULT NULL)
RETURNS BIGINT AS $$
DECLARE
  v_assignee BIGINT;
  v_previous BIGINT;
BEGIN
  SELECT assignee_id INTO v_previous FROM tickets WHERE id = p_ticket_id FOR UPDATE;

  v_assignee := fn_select_coordinator_for_ticket(p_ticket_id);
  IF v_assignee IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE tickets
  SET assignee_id = v_assignee,
      status = CASE WHEN status = 'NUEVO' THEN 'EN_PROGRESO' ELSE status END,
      last_state_change = NOW()
  WHERE id = p_ticket_id;

  INSERT INTO ticket_history (ticket_id, author_id, from_assignee_id, to_assignee_id, comment)
  VALUES (p_ticket_id, p_actor_id, v_previous, v_assignee, 'Asignación automática por sistema');

  DELETE FROM ticket_assignment_queue WHERE ticket_id = p_ticket_id;

  INSERT INTO integration_events (ticket_id, event_type, payload)
  VALUES (p_ticket_id, 'TICKET_ASSIGNED', jsonb_build_object('ticket_id', p_ticket_id, 'assignee_id', v_assignee));

  RETURN v_assignee;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_process_assignment_queue(p_limit INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
  v_ticket RECORD;
  v_assigned INTEGER := 0;
BEGIN
  FOR v_ticket IN
    SELECT * FROM ticket_assignment_queue ORDER BY enqueued_at ASC LIMIT p_limit
  LOOP
    IF fn_assign_ticket_from_queue(v_ticket.ticket_id, NULL) IS NOT NULL THEN
      v_assigned := v_assigned + 1;
    ELSE
      UPDATE ticket_assignment_queue
      SET attempts = attempts + 1, last_attempt = NOW()
      WHERE id = v_ticket.id;
    END IF;
  END LOOP;
  RETURN v_assigned;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_log_ticket_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO ticket_history (ticket_id, author_id, from_status, to_status, comment)
    VALUES (NEW.id, NULL, OLD.status, NEW.status, 'Cambio de estado por trigger');
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO ticket_history (ticket_id, author_id, from_assignee_id, to_assignee_id, comment)
    VALUES (NEW.id, NULL, OLD.assignee_id, NEW.assignee_id, 'Cambio de asignación por trigger');

    IF OLD.assignee_id IS NOT NULL THEN
      PERFORM fn_decrement_coordinator_load(OLD.assignee_id);
    END IF;
    IF NEW.assignee_id IS NOT NULL THEN
      PERFORM fn_increment_coordinator_load(NEW.assignee_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_state_audit ON tickets;
CREATE TRIGGER trg_ticket_state_audit
AFTER UPDATE ON tickets
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id)
EXECUTE PROCEDURE fn_log_ticket_state_transition();

CREATE OR REPLACE VIEW vw_notification_dispatch AS
SELECT
  nj.id,
  nj.event_id,
  nj.channel,
  nj.recipient,
  nj.subject,
  nj.message,
  nj.status,
  nj.retry_count,
  nj.scheduled_at,
  nj.sent_at,
  ie.event_type,
  ie.ticket_id,
  ie.payload
FROM notification_jobs nj
JOIN integration_events ie ON ie.id = nj.event_id
WHERE nj.status = 'PENDING';

COMMIT;
