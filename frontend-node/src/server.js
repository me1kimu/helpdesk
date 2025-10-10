import express from "express";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import fs from "fs";
import { fileURLToPath } from "url";

import config from "./config.js";
import authRouter from "./routes/auth.js";
import ticketsRouter from "./routes/tickets.js";
import reportsRouter from "./routes/reports.js";
import usersRouter from "./routes/users.js";
import ventasRouter from "./routes/ventas.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { startAssignmentQueueJob } from "./jobs/assignmentQueueJob.js";
import { startGateway, stopGateway } from "./bus/gateway.js";
import logger from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("trust proxy", true);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
const morganFormat = config.env === "production" ? "combined" : "combined";
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  })
);

const publicPath = path.join(__dirname, "..", "public");
const uploadsPath = config.uploadsDir;
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(express.static(publicPath));
app.use("/uploads", express.static(uploadsPath));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/users", usersRouter);
app.use("/ventas", ventasRouter);

app.get(["/", "/login"], (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/forgot-password", (req, res) => {
  res.sendFile(path.join(publicPath, "forgot-password.html"));
});

app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(publicPath, "reset-password.html"));
});

app.get(["/dashboard", "/tickets"], (req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});

app.get("/trabajadores", (req, res) => {
  res.sendFile(path.join(publicPath, "trabajadores.html"));
});

app.get("/logout", (req, res) => {
  res.sendFile(path.join(publicPath, "logout.html"));
});

app.get("/inventario", (req, res) => {
  res.sendFile(path.join(publicPath, "inventario.html"));
});

app.get("/pos", (req, res) => {
  res.sendFile(path.join(publicPath, "pos.html"));
});

app.get("/historial-ventas", (req, res) => {
  res.sendFile(path.join(publicPath, "historial-ventas.html"));
});

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info(`Helpdesk app listening on http://localhost:${config.port}`);
  startGateway();
});

startAssignmentQueueJob();

process.on("SIGTERM", () => {
  logger.warn("Received SIGTERM. Shutting down server...");
  stopGateway();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.warn("Received SIGINT. Shutting down server...");
  stopGateway();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});
