import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

dotenv.config();

const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  logLevel: (process.env.LOG_LEVEL || "warn").toLowerCase(),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  db: {
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || "postgres"}:${
        process.env.DB_PASSWORD || "helpdesk"
      }@${process.env.DB_HOST || "127.0.0.1"}:${
        process.env.DB_PORT || "5432"
      }/${process.env.DB_NAME || "helpdesk"}`,
    ssl:
      process.env.DB_SSL === "true"
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT === "true" }
        : false,
  },
  password: {
    maxAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  },
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"),
};

export default config;
