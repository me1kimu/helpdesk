import { Router } from "express";
import { body, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { query } from "../db/pool.js";
import { comparePassword } from "../utils/password.js";
import {
  signAccessToken,
  createSession,
  revokeRefreshToken,
} from "../utils/tokens.js";
import config from "../config.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post(
  "/login",
  [body("email").isEmail(), body("password").isString().isLength({ min: 6 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ detail: "Datos inválidos", errors: errors.array() });
    }

    const { email, password } = req.body;
    const {
      rows,
    } = await query(
      `SELECT id, full_name, email, password_hash, role, is_active, failed_attempts, locked_until
       FROM users WHERE LOWER(email) = LOWER($1)`
    , [email]);

    if (!rows.length) {
      return res.status(401).json({ detail: "Credenciales inválidas" });
    }

    const user = rows[0];
    if (!user.is_active) {
      return res.status(403).json({ detail: "Cuenta deshabilitada" });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const diffMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        detail: `Cuenta bloqueada. Intenta en ${diffMinutes} minuto(s).`,
      });
    }

    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const updates = {
        failed_attempts: attempts,
        locked_until: null,
      };
      if (attempts >= config.password.maxAttempts) {
        updates.locked_until = new Date(Date.now() + config.password.lockMinutes * 60000);
      }
      await query(
        `UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
        [updates.failed_attempts, updates.locked_until, user.id]
      );
      return res.status(401).json({ detail: "Credenciales inválidas" });
    }

    await query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.full_name,
    });

    const { refreshToken, expiresAt } = await createSession(user.id, 7 * 24 * 60, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.slice(0, 250) || null,
    });

    return res.json({
      access: accessToken,
      refresh: refreshToken,
      refresh_expires_at: expiresAt,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  })
);

router.post(
  "/logout",
  [body("refresh").isString()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { refresh } = req.body;
    await revokeRefreshToken(refresh, "LOGOUT");
    res.json({ detail: "Sesión cerrada" });
  })
);

router.post(
  "/recover",
  [body("email").isEmail()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    const { rows } = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (!rows.length) {
      return res.status(202).json({ detail: "Si el correo existe, se enviará un enlace" });
    }
    const userId = rows[0].id;
    await query(
      `INSERT INTO password_reset_tokens (user_id, expires_at) VALUES ($1, NOW() + INTERVAL '1 hour')`,
      [userId]
    );
    res.status(202).json({ detail: "Se envió un enlace de recuperación si el correo es válido" });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    return res.json({
      id: req.user.id,
      full_name: req.user.fullName,
      email: req.user.email,
      role: req.user.role,
    });
  })
);

export default router;
