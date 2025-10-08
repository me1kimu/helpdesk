import logger from "../utils/logger.js";

export function notFound(req, res, next) {
  if (res.headersSent) return next();
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ detail: "Recurso no encontrado" });
}

export function errorHandler(err, req, res, next) {
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  const status = err.statusCode || 500;
  res.status(status).json({
    detail: err.message || "Error interno del servidor",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
}
