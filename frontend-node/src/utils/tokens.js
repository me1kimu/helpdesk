import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import config from "../config.js";
import { query } from "../db/pool.js";

export function signAccessToken(payload, options = {}) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    ...options,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export async function createSession(
  userId,
  refreshTtlMinutes = 7 * 24 * 60,
  { ip = null, userAgent = null } = {}
) {
  const refreshToken = uuid();
  const expiresAt = new Date(Date.now() + refreshTtlMinutes * 60 * 1000);
  await query(
    `INSERT INTO user_sessions (user_id, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, refreshToken, ip, userAgent, expiresAt]
  );
  return { refreshToken, expiresAt };
}

export async function revokeRefreshToken(token, reason = "LOGOUT") {
  await query(
    `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = $2 WHERE refresh_token = $1`,
    [token, reason]
  );
}

export async function exchangeRefreshToken(token) {
  const { rows } = await query(
    `SELECT * FROM user_sessions WHERE refresh_token = $1 AND revoked_at IS NULL`,
    [token]
  );
  if (!rows.length) return null;
  const session = rows[0];
  if (new Date(session.expires_at) < new Date()) {
    await revokeRefreshToken(token, "EXPIRED");
    return null;
  }
  const accessToken = signAccessToken({ sub: session.user_id });
  return { accessToken, session };
}
