import net from "net";
import { URL } from "url";
import logger from "../utils/logger.js";
import config from "../config.js";

const HEADER_LENGTH = 5;
const { host, port, serviceName, reconnectDelayMs } = config.bus;

function buildFrame(address, payload) {
  const json = JSON.stringify(payload ?? {});
  const body = `${address}${json}`;
  const header = String(body.length).padStart(HEADER_LENGTH, "0");
  return Buffer.from(header + body, "utf8");
}

function encodeHandshakeMessage(name) {
  const body = `sinit${name}`;
  const header = String(body.length).padStart(HEADER_LENGTH, "0");
  return Buffer.from(header + body, "utf8");
}

function isJsonRequestMethod(method) {
  return method && !["GET", "HEAD"].includes(method.toUpperCase());
}

function normaliseHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    result[String(key).toLowerCase()] = String(value);
  }
  return result;
}

async function executeHttpCall(instruction) {
  const method = (instruction.method || "GET").toUpperCase();
  const baseUrl = `http://127.0.0.1:${config.port}`;
  const targetUrl = new URL(instruction.path || "/", baseUrl);

  const query = instruction.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null) {
          targetUrl.searchParams.append(key, String(entry));
        }
      });
      continue;
    }
    if (value === undefined || value === null) continue;
    targetUrl.searchParams.append(key, String(value));
  }

  const headers = normaliseHeaders(instruction.headers);
  const init = { method, headers: { ...headers } };

  if (instruction.body !== undefined && isJsonRequestMethod(method)) {
    if (!init.headers["content-type"]) {
      init.headers["content-type"] = "application/json";
    }
    init.body = typeof instruction.body === "string"
      ? instruction.body
      : JSON.stringify(instruction.body);
  }

  const response = await fetch(targetUrl, init);
  const contentType = response.headers.get("content-type") || "";
  let data = null;

  try {
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else if (contentType.startsWith("text/")) {
      data = await response.text();
    } else {
      const buffer = await response.arrayBuffer();
      data = Buffer.from(buffer).toString("base64");
    }
  } catch (err) {
    data = { parseError: err.message };
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    data,
  };
}

export class GatewayService {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.expected = null;
    this.handshakeCompleted = false;
    this.reconnectTimer = null;
  }

  start() {
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, reconnectDelayMs);
  }

  connect() {
    this.handshakeCompleted = false;
    this.buffer = Buffer.alloc(0);
    this.expected = null;

    const socket = net.createConnection({ host, port });
    this.socket = socket;

    socket.on("connect", () => {
      logger.info(`Bus gateway connected to ${host}:${port}`);
      socket.write(encodeHandshakeMessage(serviceName));
    });

    socket.on("data", (chunk) => this.handleData(chunk));

    socket.on("error", (err) => {
      logger.error(`Bus gateway socket error`, err);
    });

    socket.on("close", () => {
      logger.warn(`Bus gateway connection closed`);
      this.stop();
      this.scheduleReconnect();
    });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.expected === null) {
        if (this.buffer.length < HEADER_LENGTH) return;
        const header = this.buffer.slice(0, HEADER_LENGTH).toString("utf8");
        this.expected = Number.parseInt(header, 10);
        this.buffer = this.buffer.slice(HEADER_LENGTH);
      }

      if (Number.isNaN(this.expected)) {
        logger.error(`Invalid frame length received`);
        this.expected = null;
        continue;
      }

      if (this.buffer.length < this.expected) return;
      const message = this.buffer.slice(0, this.expected);
      this.buffer = this.buffer.slice(this.expected);
      this.expected = null;
      this.processMessage(message);
    }
  }

  async processMessage(messageBuffer) {
    const raw = messageBuffer.toString("utf8");

    if (!this.handshakeCompleted) {
      if (raw.slice(0, 5) === "sinit" && raw.slice(5, 7) === "OK") {
        this.handshakeCompleted = true;
        logger.info(`Bus gateway registered as ${serviceName}`);
      } else {
        logger.error(`Unexpected handshake response: ${raw}`);
      }
      return;
    }

    const replyAddr = raw.slice(0, 5);
    const payloadRaw = raw.slice(5);

    let payload;
    try {
      payload = JSON.parse(payloadRaw || "{}");
    } catch (err) {
      logger.error(`Failed to parse bus payload`, err);
      this.send(replyAddr, {
        ok: false,
        error: {
          message: "Invalid JSON payload",
        },
      });
      return;
    }

    try {
      const result = await executeHttpCall(payload);
      this.send(replyAddr, result);
    } catch (err) {
      logger.error(`Bus gateway request failed`, err);
      this.send(replyAddr, {
        ok: false,
        error: {
          message: err.message,
          name: err.name,
        },
      });
    }
  }

  send(address, payload) {
    if (!this.socket) return;
    try {
      const frame = buildFrame(address, payload);
      this.socket.write(frame);
    } catch (err) {
      logger.error(`Failed to send payload to bus`, err);
    }
  }
}

const gateway = new GatewayService();

export function startGateway() {
  gateway.start();
  return gateway;
}

export function stopGateway() {
  gateway.stop();
}
