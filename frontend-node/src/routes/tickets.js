import { Router } from "express";
import { body, param, query as queryValidator, validationResult } from "express-validator";
import multer from "multer";
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { query } from "../db/pool.js";
import config from "../config.js";
import { enqueueTicketEvent } from "../utils/events.js";

const router = Router();

// Ensure uploads directory exists
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    cb(null, safeName);
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const allowedStatuses = ["NUEVO", "EN_PROGRESO", "RESUELTO", "CERRADO"];
const allowedPriorities = ["BAJA", "MEDIA", "ALTA", "CRITICA"];

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ detail: "Datos inválidos", errors: errors.array() });
    return true;
  }
  return false;
}

function mapTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: {
      id: row.categoria_id,
      name: row.category_name,
    },
    priority: row.priority,
    status: row.status,
    requester: {
      id: row.requester_id,
      name: row.requester_name,
      email: row.requester_email,
    },
    assignee: row.assignee_id
      ? { id: row.assignee_id, name: row.assignee_name, email: row.assignee_email }
      : null,
    reopenCount: row.reopen_count,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    slaDueAt: row.sla_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    lastStateChange: row.last_state_change,
    location: row.location_lat
      ? {
          lat: Number(row.location_lat),
          lng: Number(row.location_lng),
          consent: row.location_consent,
          notes: row.location_notes,
        }
      : null,
    commentCount: Number(row.comment_count || 0),
    attachmentCount: Number(row.attachment_count || 0),
    metadata: row.metadata || {},
  };
}

async function fetchTicketById(id) {
  const { rows } = await query(
    `SELECT t.*, c.name AS category_name,
            req.full_name AS requester_name, req.email AS requester_email,
            ass.full_name AS assignee_name, ass.email AS assignee_email,
            (SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = t.id) AS comment_count,
            (SELECT COUNT(*) FROM ticket_attachments WHERE ticket_id = t.id) AS attachment_count
     FROM tickets t
     JOIN categories c ON c.id = t.categoria_id
     JOIN users req ON req.id = t.requester_id
     LEFT JOIN users ass ON ass.id = t.assignee_id
     WHERE t.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const ticket = mapTicketRow(rows[0]);

  const [commentsRes, attachmentsRes, historyRes] = await Promise.all([
    query(
      `SELECT tc.id, tc.body, tc.is_internal, tc.created_at, tc.updated_at,
              u.id AS author_id, u.full_name AS author_name, u.role AS author_role
       FROM ticket_comments tc
       LEFT JOIN users u ON u.id = tc.author_id
       WHERE tc.ticket_id = $1
       ORDER BY tc.created_at ASC`,
      [id]
    ),
    query(
      `SELECT id, filename, storage_path, mime_type, file_size, checksum, created_at
       FROM ticket_attachments WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [id]
    ),
    query(
      `SELECT th.id, th.from_status, th.to_status, th.from_priority, th.to_priority,
              th.from_assignee_id, th.to_assignee_id, th.comment, th.created_at,
              u.full_name AS author_name
       FROM ticket_history th
       LEFT JOIN users u ON u.id = th.author_id
       WHERE th.ticket_id = $1 ORDER BY th.created_at ASC`,
      [id]
    ),
  ]);

  return {
    ...ticket,
    comments: commentsRes.rows.map((row) => ({
      id: row.id,
      body: row.body,
      isInternal: row.is_internal,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: row.author_id
        ? { id: row.author_id, name: row.author_name, role: row.author_role }
        : null,
    })),
    attachments: attachmentsRes.rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      url: `/api/tickets/${id}/attachments/${row.id}/download`,
      mimeType: row.mime_type,
      size: row.file_size,
      checksum: row.checksum,
      uploadedAt: row.created_at,
    })),
    history: historyRes.rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromPriority: row.from_priority,
      toPriority: row.to_priority,
      fromAssigneeId: row.from_assignee_id,
      toAssigneeId: row.to_assignee_id,
      comment: row.comment,
      createdAt: row.created_at,
      authorName: row.author_name,
    })),
  };
}

router.use(authenticate);

router.get(
  "/",
  [
    queryValidator("status").optional().isIn(allowedStatuses),
    queryValidator("priority").optional().isIn(allowedPriorities),
    queryValidator("categoria_id").optional().isInt({ min: 1 }),
    queryValidator("assignee_id").optional().isInt({ min: 1 }),
    queryValidator("requester_id").optional().isInt({ min: 1 }),
    queryValidator("from").optional().isISO8601(),
    queryValidator("to").optional().isISO8601(),
    queryValidator("search").optional().isString(),
    queryValidator("page").optional().isInt({ min: 1 }),
    queryValidator("page_size").optional().isInt({ min: 1, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const {
      status,
      priority,
      categoria_id,
      assignee_id,
      requester_id,
      from,
      to,
      search,
    } = req.query;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.page_size || 20);

    const conditions = [];
    const params = [];

    if (req.user.role === "USUARIO") {
      params.push(req.user.id);
      conditions.push(`t.requester_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      conditions.push(`t.priority = $${params.length}`);
    }
    if (categoria_id) {
      params.push(Number(categoria_id));
      conditions.push(`t.categoria_id = $${params.length}`);
    }
    if (assignee_id) {
      params.push(Number(assignee_id));
      conditions.push(`t.assignee_id = $${params.length}`);
    }
    if (requester_id && req.user.role !== "USUARIO") {
      params.push(Number(requester_id));
      conditions.push(`t.requester_id = $${params.length}`);
    }
    if (from) {
      params.push(new Date(from));
      conditions.push(`t.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(new Date(to));
      conditions.push(`t.created_at <= $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const paginationParamsStart = params.length;
    params.push(pageSize);
    const limitParamIndex = params.length;
    params.push((page - 1) * pageSize);
    const offsetParamIndex = params.length;

    const sql = `SELECT t.*, c.name AS category_name,
                        req.full_name AS requester_name, req.email AS requester_email,
                        ass.full_name AS assignee_name, ass.email AS assignee_email,
                        (SELECT COUNT(*) FROM ticket_comments WHERE ticket_id = t.id) AS comment_count,
                        (SELECT COUNT(*) FROM ticket_attachments WHERE ticket_id = t.id) AS attachment_count
                 FROM tickets t
                 JOIN categories c ON c.id = t.categoria_id
                 JOIN users req ON req.id = t.requester_id
                 LEFT JOIN users ass ON ass.id = t.assignee_id
                 ${whereClause}
                 ORDER BY t.created_at DESC
                 LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`;

    const [listRes, countRes] = await Promise.all([
      query(sql, params),
      query(`SELECT COUNT(*) AS total FROM tickets t ${whereClause}`, params.slice(0, paginationParamsStart)),
    ]);

    res.json({
      page,
      pageSize,
      total: Number(countRes.rows[0]?.total || 0),
      tickets: listRes.rows.map(mapTicketRow),
    });
  })
);

router.post(
  "/",
  [
    body("title").isString().isLength({ min: 3, max: 120 }),
    body("description").isString().isLength({ min: 5 }),
    body("categoria_id").isInt({ min: 1 }),
    body("priority").optional().isIn(allowedPriorities),
    body("assignee_id").optional().isInt({ min: 1 }),
    body("metadata").optional(),
    body("location.lat").optional().isFloat({ min: -90, max: 90 }),
    body("location.lng").optional().isFloat({ min: -180, max: 180 }),
    body("location.consent").optional().isBoolean(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const {
      title,
      description,
      categoria_id,
      priority = "MEDIA",
      assignee_id,
      metadata = {},
      location,
    } = req.body;

    const assigneeId = assignee_id ? Number(assignee_id) : null;

    if (assigneeId && req.user.role === "USUARIO") {
      return res.status(403).json({ detail: "No autorizado para asignar tickets" });
    }

    const values = [
      title,
      description,
      Number(categoria_id),
      priority,
      req.user.id,
      assigneeId,
      JSON.stringify(metadata || {}),
    ];

    const locationLat = location?.lat ?? null;
    const locationLng = location?.lng ?? null;
    const locationConsent = location?.consent ?? null;
    const locationNotes = location?.notes ?? null;

    values.push(locationLat, locationLng, locationConsent, locationNotes);

    const insertSql = `INSERT INTO tickets (
        title, description, categoria_id, priority, requester_id, assignee_id, metadata,
        location_lat, location_lng, location_consent, location_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      RETURNING *`;

    const { rows } = await query(insertSql, values);
    const ticket = rows[0];

    await Promise.all([
      query(
        `INSERT INTO ticket_history (ticket_id, author_id, to_status, to_priority, to_assignee_id, comment)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ticket.id, req.user.id, ticket.status, ticket.priority, ticket.assignee_id, "Ticket creado"]
      ),
      query(
        `INSERT INTO ticket_followers (ticket_id, user_id, subscribed)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (ticket_id, user_id) DO UPDATE SET subscribed = TRUE`,
        [ticket.id, req.user.id]
      ),
      assigneeId
        ? query(
            `INSERT INTO ticket_followers (ticket_id, user_id, subscribed)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (ticket_id, user_id) DO UPDATE SET subscribed = TRUE`,
            [ticket.id, assigneeId]
          )
        : Promise.resolve(),
    ]);

    if (!assigneeId) {
      await query(
        `INSERT INTO ticket_assignment_queue (ticket_id) VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [ticket.id]
      );
    }

    await enqueueTicketEvent({
      ticketId: ticket.id,
      eventType: "TICKET_CREATED",
      payload: {
        ticket_id: ticket.id,
        title: ticket.title,
        requester_id: ticket.requester_id,
      },
    });

    const fullTicket = await fetchTicketById(ticket.id);
    res.status(201).json(fullTicket);
  })
);

router.get(
  "/:id",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const ticketId = Number(req.params.id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });
    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }
    res.json(ticket);
  })
);

router.put(
  "/:id",
  [
    param("id").isInt({ min: 1 }),
    body("title").optional().isString().isLength({ min: 3, max: 120 }),
    body("description").optional().isString().isLength({ min: 5 }),
    body("priority").optional().isIn(allowedPriorities),
    body("status").optional().isIn(allowedStatuses),
    body("assignee_id").optional({ nullable: true }).isInt({ min: 1 }),
    body("categoria_id").optional().isInt({ min: 1 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const ticketId = Number(req.params.id);
    const existing = await fetchTicketById(ticketId);
    if (!existing) return res.status(404).json({ detail: "Ticket no encontrado" });

    if (req.user.role === "USUARIO" && existing.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    const updates = [];
    const params = [];
    const changes = {};

    if (req.body.title && req.body.title !== existing.title) {
      updates.push(`title = $${updates.length + 1}`);
      params.push(req.body.title);
      changes.title = [existing.title, req.body.title];
    }
    if (req.body.description && req.body.description !== existing.description) {
      updates.push(`description = $${updates.length + 1}`);
      params.push(req.body.description);
    }
    if (req.body.priority && req.body.priority !== existing.priority) {
      updates.push(`priority = $${updates.length + 1}`);
      params.push(req.body.priority);
      changes.priority = [existing.priority, req.body.priority];
    }
    if (
      Object.prototype.hasOwnProperty.call(req.body, "assignee_id") &&
      (req.body.assignee_id || null) !== (existing.assignee?.id || null)
    ) {
      if (req.user.role === "USUARIO") {
        return res.status(403).json({ detail: "No autorizado para reasignar" });
      }
      updates.push(`assignee_id = $${updates.length + 1}`);
      params.push(req.body.assignee_id || null);
      changes.assignee = [existing.assignee?.id || null, req.body.assignee_id || null];
    }
    if (req.body.categoria_id && req.body.categoria_id !== existing.category.id) {
      updates.push(`categoria_id = $${updates.length + 1}`);
      params.push(req.body.categoria_id);
    }

    let newStatus = existing.status;
    if (req.body.status && req.body.status !== existing.status) {
      if (req.user.role === "USUARIO" && !["RESUELTO", "CERRADO"].includes(existing.status)) {
        return res.status(403).json({ detail: "No autorizado para cambiar estado" });
      }
      newStatus = req.body.status;
      updates.push(`status = $${updates.length + 1}`);
      params.push(newStatus);
      updates.push(`last_state_change = NOW()`);
      changes.status = [existing.status, newStatus];

      if (["RESUELTO", "CERRADO"].includes(newStatus)) {
        updates.push(`closed_at = COALESCE(closed_at, NOW())`);
      } else if (existing.closedAt && !["RESUELTO", "CERRADO"].includes(newStatus)) {
        updates.push(`closed_at = NULL`);
      }
    }

    if (!updates.length) {
      const fresh = await fetchTicketById(ticketId);
      return res.json(fresh);
    }

    params.push(ticketId);
    await query(`UPDATE tickets SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length}`, params);

    await query(
      `INSERT INTO ticket_history (ticket_id, author_id, from_status, to_status, from_priority, to_priority, from_assignee_id, to_assignee_id, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ticketId,
        req.user.id,
        changes.status ? changes.status[0] : null,
        changes.status ? changes.status[1] : null,
        changes.priority ? changes.priority[0] : null,
        changes.priority ? changes.priority[1] : null,
        changes.assignee ? changes.assignee[0] : null,
        changes.assignee ? changes.assignee[1] : null,
        "Actualización del ticket",
      ]
    );

    if (changes.assignee && changes.assignee[1]) {
      await query(
        `INSERT INTO ticket_followers (ticket_id, user_id, subscribed)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (ticket_id, user_id) DO UPDATE SET subscribed = TRUE`,
        [ticketId, changes.assignee[1]]
      );
    }

    if (changes.status) {
      await enqueueTicketEvent({
        ticketId,
        eventType: "TICKET_STATE_CHANGED",
        payload: { ticket_id: ticketId, from: changes.status[0], to: changes.status[1] },
      });
    } else {
      await enqueueTicketEvent({
        ticketId,
        eventType: "TICKET_UPDATED",
        payload: { ticket_id: ticketId, changes },
      });
    }

    const updated = await fetchTicketById(ticketId);
    res.json(updated);
  })
);

router.post(
  "/:id/comments",
  [
    param("id").isInt({ min: 1 }),
    body("body").isString().isLength({ min: 1 }),
    body("is_internal").optional().isBoolean(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const ticketId = Number(req.params.id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });
    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    const isInternal = req.body.is_internal || false;
    if (isInternal && req.user.role === "USUARIO") {
      return res.status(403).json({ detail: "No autorizado para comentarios internos" });
    }

    const { rows } = await query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at, updated_at`,
      [ticketId, req.user.id, req.body.body, isInternal]
    );
    const comment = rows[0];

    await query(
      `INSERT INTO ticket_history (ticket_id, author_id, comment)
       VALUES ($1, $2, $3)`,
      [ticketId, req.user.id, `Comentario agregado: ${req.body.body.slice(0, 200)}`]
    );

    await enqueueTicketEvent({
      ticketId,
      eventType: "TICKET_COMMENTED",
      payload: {
        ticket_id: ticketId,
        author_id: req.user.id,
        author_name: req.user.fullName,
        body: req.body.body,
        is_internal: isInternal,
      },
    });

    const updated = await fetchTicketById(ticketId);
    res.status(201).json({
      id: comment.id,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      ticket: updated,
    });
  })
);

router.post(
  "/:id/attachments",
  [param("id").isInt({ min: 1 })],
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    if (!req.file) return res.status(400).json({ detail: "Archivo requerido" });
    const ticketId = Number(req.params.id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });
    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    const { rows } = await query(
      `INSERT INTO ticket_attachments (ticket_id, uploader_id, filename, storage_path, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [ticketId, req.user.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
    );
    const attachment = rows[0];

    await enqueueTicketEvent({
      ticketId,
      eventType: "TICKET_ATTACHMENT_ADDED",
      payload: {
        ticket_id: ticketId,
        uploader_id: req.user.id,
        filename: req.file.originalname,
      },
    });

    res.status(201).json({
      id: attachment.id,
      filename: req.file.originalname,
      uploadedAt: attachment.created_at,
      url: `/api/tickets/${ticketId}/attachments/${attachment.id}/download`,
    });
  })
);

router.get(
  "/:ticketId/attachments/:attachmentId/download",
  [param("ticketId").isInt({ min: 1 }), param("attachmentId").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const ticketId = Number(req.params.ticketId);
    const attachmentId = Number(req.params.attachmentId);

    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });
    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    const { rows } = await query(
      `SELECT filename, storage_path, mime_type FROM ticket_attachments
       WHERE id = $1 AND ticket_id = $2`,
      [attachmentId, ticketId]
    );
    if (!rows.length) return res.status(404).json({ detail: "Adjunto no encontrado" });
    const file = rows[0];
    const fullPath = path.join(config.uploadsDir, file.storage_path);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ detail: "Archivo no disponible" });
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    fs.createReadStream(fullPath).pipe(res);
  })
);

router.post(
  "/:id/reopen",
  [param("id").isInt({ min: 1 })],
  asyncHandler(async (req, res) => {
    const ticketId = Number(req.params.id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });

    if (ticket.status !== "RESUELTO" && ticket.status !== "CERRADO") {
      return res.status(400).json({ detail: "Solo tickets resueltos o cerrados pueden reabrirse" });
    }

    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    const newStatus = ticket.assignee ? "EN_PROGRESO" : "NUEVO";

    await query(
      `UPDATE tickets
       SET status = $1, reopen_count = reopen_count + 1, last_state_change = NOW(), closed_at = NULL
       WHERE id = $2`,
      [newStatus, ticketId]
    );

    await query(
      `INSERT INTO ticket_history (ticket_id, author_id, from_status, to_status, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, req.user.id, ticket.status, newStatus, "Ticket reabierto"]
    );

    await enqueueTicketEvent({
      ticketId,
      eventType: "TICKET_REOPENED",
      payload: { ticket_id: ticketId, reopened_by: req.user.id },
    });

    const updated = await fetchTicketById(ticketId);
    res.json(updated);
  })
);

router.post(
  "/:id/cancel",
  [param("id").isInt({ min: 1 }), body("reason").optional().isString().isLength({ min: 3 })],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const ticketId = Number(req.params.id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });

    if (req.user.role === "USUARIO" && ticket.requester.id !== req.user.id) {
      return res.status(403).json({ detail: "No autorizado" });
    }

    if (["CERRADO"].includes(ticket.status) && !req.body.force) {
      return res.status(400).json({ detail: "Ticket ya cerrado" });
    }

    await query(
      `UPDATE tickets SET cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2, status = 'CERRADO', last_state_change = NOW()
       WHERE id = $3`,
      [req.user.id, req.body.reason || "Cancelado por solicitante", ticketId]
    );

    await query(
      `INSERT INTO ticket_history (ticket_id, author_id, from_status, to_status, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, req.user.id, ticket.status, "CERRADO", req.body.reason || "Cancelado por solicitante"]
    );

    await enqueueTicketEvent({
      ticketId,
      eventType: "TICKET_CANCELLED",
      payload: { ticket_id: ticketId, cancelled_by: req.user.id },
    });

    const updated = await fetchTicketById(ticketId);
    res.json(updated);
  })
);

router.post(
  "/:id/assign",
  [param("id").isInt({ min: 1 }), body("assignee_id").isInt({ min: 1 })],
  requireRoles("ADMIN", "COORDINADOR"),
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const ticketId = Number(req.params.id);
    const assigneeId = Number(req.body.assignee_id);
    const ticket = await fetchTicketById(ticketId);
    if (!ticket) return res.status(404).json({ detail: "Ticket no encontrado" });

    await query(
      `UPDATE tickets SET assignee_id = $1, status = CASE WHEN status = 'NUEVO' THEN 'EN_PROGRESO' ELSE status END, last_state_change = NOW()
       WHERE id = $2`,
      [assigneeId, ticketId]
    );

    await query(
      `INSERT INTO ticket_history (ticket_id, author_id, from_assignee_id, to_assignee_id, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [ticketId, req.user.id, ticket.assignee?.id || null, assigneeId, "Ticket asignado"]
    );

    await enqueueTicketEvent({
      ticketId,
      eventType: "TICKET_ASSIGNED",
      payload: { ticket_id: ticketId, assignee_id: assigneeId },
    });

    const updated = await fetchTicketById(ticketId);
    res.json(updated);
  })
);

export default router;
