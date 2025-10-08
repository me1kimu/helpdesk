import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { query } from "../db/pool.js";
import { hashPassword } from "../utils/password.js";

const router = Router();
const ROLE_OPTIONS = ["ADMIN", "COORDINADOR", "USUARIO"];

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ detail: "Datos inválidos", errors: errors.array() });
    return true;
  }
  return false;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.use(authenticate);

router.get(
  "/",
  requireRoles("ADMIN", "COORDINADOR"),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at, updated_at
       FROM users
       ORDER BY full_name ASC`
    );
    res.json(rows.map(serializeUser));
  })
);

router.get(
  "/:id",
  requireRoles("ADMIN", "COORDINADOR"),
  param("id").isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;
    const userId = Number(req.params.id);
    const { rows } = await query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ detail: "Usuario no encontrado" });
    res.json(serializeUser(rows[0]));
  })
);

router.post(
  "/",
  requireRoles("ADMIN"),
  [
    body("full_name").isString().isLength({ min: 3, max: 120 }).trim(),
    body("email").isEmail().normalizeEmail(),
    body("role").optional().isIn(ROLE_OPTIONS),
    body("password").isString().isLength({ min: 8 }),
    body("is_active").optional().isBoolean().toBoolean(),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const fullName = req.body.full_name.trim();
    const email = req.body.email.toLowerCase();
    const role = req.body.role || "USUARIO";
    const isActive =
      typeof req.body.is_active === "boolean" ? req.body.is_active : true;

    const existing = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (existing.rows.length) {
      return res.status(409).json({ detail: "El correo ya se encuentra registrado" });
    }

    const passwordHash = await hashPassword(req.body.password);

    const { rows } = await query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, email, role, is_active, last_login_at, created_at, updated_at`,
      [fullName, email, passwordHash, role, isActive]
    );

    res.status(201).json(serializeUser(rows[0]));
  })
);

router.put(
  "/:id",
  requireRoles("ADMIN"),
  [
    param("id").isInt({ min: 1 }),
    body("full_name").optional().isString().isLength({ min: 3, max: 120 }).trim(),
    body("email").optional().isEmail().normalizeEmail(),
    body("role").optional().isIn(ROLE_OPTIONS),
    body("is_active").optional().isBoolean().toBoolean(),
    body("password").optional().isString().isLength({ min: 8 }),
  ],
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const userId = Number(req.params.id);
    const { rows: existingRows } = await query(
      `SELECT id, email FROM users WHERE id = $1`,
      [userId]
    );
    if (!existingRows.length) return res.status(404).json({ detail: "Usuario no encontrado" });

    const updates = [];
    const params = [];

    if (req.body.full_name) {
      updates.push(`full_name = $${updates.length + 1}`);
      params.push(req.body.full_name.trim());
    }

    if (req.body.email) {
      const email = req.body.email.toLowerCase();
      const { rows: conflict } = await query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2`,
        [email, userId]
      );
      if (conflict.length) {
        return res.status(409).json({ detail: "El correo ya se encuentra registrado" });
      }
      updates.push(`email = $${updates.length + 1}`);
      params.push(email);
    }

    if (req.body.role) {
      updates.push(`role = $${updates.length + 1}`);
      params.push(req.body.role);
    }

    if (typeof req.body.is_active === "boolean") {
      if (userId === req.user.id && req.body.is_active === false) {
        return res.status(400).json({ detail: "No puedes desactivar tu propia cuenta" });
      }
      updates.push(`is_active = $${updates.length + 1}`);
      params.push(req.body.is_active);
    }

    if (req.body.password) {
      const passwordHash = await hashPassword(req.body.password);
      updates.push(`password_hash = $${updates.length + 1}`);
      params.push(passwordHash);
    }

    if (!updates.length) {
      const { rows } = await query(
        `SELECT id, full_name, email, role, is_active, last_login_at, created_at, updated_at
         FROM users WHERE id = $1`,
        [userId]
      );
      return res.json(serializeUser(rows[0]));
    }

    updates.push(`updated_at = NOW()`);

    params.push(userId);
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);

    const { rows } = await query(
      `SELECT id, full_name, email, role, is_active, last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );

    res.json(serializeUser(rows[0]));
  })
);

router.delete(
  "/:id",
  requireRoles("ADMIN"),
  param("id").isInt({ min: 1 }),
  asyncHandler(async (req, res) => {
    if (handleValidation(req, res)) return;

    const userId = Number(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ detail: "No puedes desactivar tu propia cuenta" });
    }

    const { rows } = await query(
      `UPDATE users
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, email, role, is_active, last_login_at, created_at, updated_at`,
      [userId]
    );

    if (!rows.length) return res.status(404).json({ detail: "Usuario no encontrado" });

    res.json({ detail: "Usuario desactivado", user: serializeUser(rows[0]) });
  })
);

export default router;
