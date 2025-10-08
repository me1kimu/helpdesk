import { query } from "../db/pool.js";

export async function enqueueTicketEvent({
  ticketId,
  eventType,
  payload,
  notificationTargets = [],
}) {
  const { rows } = await query(
    `INSERT INTO integration_events (ticket_id, event_type, payload)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [ticketId || null, eventType, payload ? JSON.stringify(payload) : '{}']
  );
  const eventId = rows[0]?.id;
  if (eventId && notificationTargets.length) {
    const values = notificationTargets.map((target, idx) => (
      `($1, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5}, $${idx * 5 + 6})`
    ));
    const params = notificationTargets.flatMap((t) => [
      t.channel,
      t.recipient,
      t.subject || null,
      t.message || null,
      t.scheduledAt || new Date(),
    ]);
    await query(
      `INSERT INTO notification_jobs (event_id, channel, recipient, subject, message, scheduled_at)
       VALUES ${values.join(", ")}`,
      [eventId, ...params]
    );
  }
  return eventId;
}
