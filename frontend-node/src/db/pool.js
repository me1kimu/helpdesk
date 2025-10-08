import pg from "pg";
import config from "../config.js";
import logger from "../utils/logger.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.connectionString,
  ssl: config.db.ssl,
});

pool.on("error", (err) => {
  logger.error("Unexpected error on PostgreSQL client", err);
  process.exit(1);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (config.logLevel === "debug") {
    logger.debug(`SQL (${duration} ms): ${text} params=${JSON.stringify(params)}`);
  } else if (duration > 500) {
    logger.warn(`Slow query (${duration} ms): ${text}`);
  }
  return res;
}

export default pool;
