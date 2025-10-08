import { verifyAccessToken } from "../utils/tokens.js";
import { query } from "../db/pool.js";
import logger from "../utils/logger.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers["authorization"] || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ detail: "Token no proporcionado" });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const payload = verifyAccessToken(token);
    const userId = payload.sub || payload.userId;
    if (!userId) return res.status(401).json({ detail: "Token inválido" });

    const { rows } = await query(`SELECT id, full_name, email, role, is_active FROM users WHERE id = $1`, [
      userId,
    ]);
    if (!rows.length) return res.status(401).json({ detail: "Usuario no encontrado" });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ detail: "Cuenta deshabilitada" });

    req.user = {
      id: user.id,
      fullName: user.full_name,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      tokenPayload: payload,
    };

    next();
  } catch (err) {
    logger.error("Auth error", err);
    return res.status(401).json({ detail: "Token inválido" });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ detail: "No autenticado" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ detail: "No autorizado" });
    }
    next();
  };
}
