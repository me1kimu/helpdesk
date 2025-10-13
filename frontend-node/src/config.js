import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

dotenv.config();

const env = process.env.NODE_ENV || "development";

const passwordResetRevealToken =
  process.env.PASSWORD_RESET_REVEAL_TOKEN === "true" ||
  (process.env.PASSWORD_RESET_REVEAL_TOKEN === undefined && env !== "production");

const config = {
  env,
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
  jobs: {
    assignmentQueue: {
      enabled: process.env.ASSIGNMENT_JOB_ENABLED === "true",
      schedule: process.env.ASSIGNMENT_JOB_SCHEDULE || "*/1 * * * *",
      batchSize: Number(process.env.ASSIGNMENT_JOB_BATCH_SIZE || 20),
    },
  },
  password: {
    maxAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  },
  passwordReset: {
    expiresMinutes: Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 60),
    revealToken: passwordResetRevealToken,
  },
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"),
  bus: {
    host: process.env.BUS_HOST || "127.0.0.1",
    port: Number(process.env.BUS_PORT || 5000),
    serviceName: (process.env.BUS_SERVICE_NAME || "gwapi").slice(0, 5).padEnd(5, "_"),
    reconnectDelayMs: Number(process.env.BUS_RECONNECT_DELAY_MS || 5000),
  },
};

export default config;
