import { Router } from "express";
import { body, validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { query, pool } from "../db/pool.js";
import { comparePassword, hashPassword } from "../utils/password.js";
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
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    const expiresAt = new Date(Date.now() + config.passwordReset.expiresMinutes * 60000);
    const { rows: tokenRows } = await query(
      `INSERT INTO password_reset_tokens (user_id, expires_at, request_ip)
       VALUES ($1, $2, $3)
       RETURNING token, expires_at`,
      [userId, expiresAt, req.ip || null]
    );

    const payload = {
      detail: "Se envió un enlace de recuperación si el correo es válido",
      expires_at: tokenRows[0]?.expires_at || expiresAt,
    };

    if (config.passwordReset.revealToken && tokenRows[0]) {
      payload.token = tokenRows[0].token;
      payload.reset_url = `/reset-password?token=${tokenRows[0].token}`;
    }

    res.status(202).json(payload);
  })
);

router.post(
  "/reset",
  [
    body("token").isUUID(),
    body("password").isString().isLength({ min: 8, max: 128 }),
    body("confirmPassword").optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password, confirmPassword } = req.body;
    if (confirmPassword !== undefined && confirmPassword !== password) {
      return res.status(400).json({ detail: "Las contraseñas no coinciden" });
    }

    const client = await pool.connect();
    let transactionActive = false;
    try {
      await client.query("BEGIN");
      transactionActive = true;
      const { rows } = await client.query(
        `SELECT prt.token, prt.user_id, prt.expires_at, prt.used_at, u.is_active
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.token = $1
         FOR UPDATE`,
        [token]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        transactionActive = false;
        return res.status(400).json({ detail: "El enlace no es válido" });
      }

      const resetRequest = rows[0];
      if (resetRequest.used_at) {
        await client.query("ROLLBACK");
        transactionActive = false;
        return res.status(400).json({ detail: "El enlace ya fue utilizado" });
      }

      if (new Date(resetRequest.expires_at) < new Date()) {
        await client.query("ROLLBACK");
        transactionActive = false;
        return res.status(400).json({ detail: "El enlace ha expirado" });
      }

      if (!resetRequest.is_active) {
        await client.query("ROLLBACK");
        transactionActive = false;
        return res.status(403).json({ detail: "La cuenta está deshabilitada" });
      }

      const newPasswordHash = await hashPassword(password);

      await client.query(
        `UPDATE users
         SET password_hash = $1,
             failed_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [newPasswordHash, resetRequest.user_id]
      );

      await client.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1`,
        [token]
      );

      await client.query(
        `UPDATE user_sessions
         SET revoked_at = NOW(), revoked_reason = $2
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [resetRequest.user_id, "PASSWORD_RESET"]
      );

      await client.query("COMMIT");
      transactionActive = false;
    } catch (err) {
      try {
        if (transactionActive) {
          await client.query("ROLLBACK");
        }
      } catch (rollbackErr) {
        // ignore rollback error and throw original
      }
      throw err;
    } finally {
      client.release();
    }

    res.json({ detail: "Contraseña actualizada. Ya puedes iniciar sesión." });
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
