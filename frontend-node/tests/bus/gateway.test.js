import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const createConnectionMock = vi.fn();
let currentSocket = null;
let gateway = null;

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.ended = false;
    this.destroyed = false;
  }

  write(data) {
    this.writes.push(data.toString());
    return true;
  }

  end() {
    this.ended = true;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.emit("close");
  }
}

vi.mock("../../src/config.js", () => ({
  default: {
    port: 3000,
    logLevel: "debug",
    bus: {
      host: "127.0.0.1",
      port: 5000,
      serviceName: "gwapi",
      reconnectDelayMs: 50,
    },
  },
}));

const loggerMock = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  http: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../src/utils/logger.js", () => ({
  default: loggerMock,
}));

vi.mock("node:net", () => ({
  createConnection: (...args) => createConnectionMock(...args),
  default: {
    createConnection: (...args) => createConnectionMock(...args),
  },
}));

vi.mock("net", () => ({
  createConnection: (...args) => createConnectionMock(...args),
  default: {
    createConnection: (...args) => createConnectionMock(...args),
  },
}));

let GatewayService;

beforeEach(async () => {
  createConnectionMock.mockImplementation(() => {
    currentSocket = new FakeSocket();
    return currentSocket;
  });

  ({ GatewayService } = await import("../../src/bus/gateway.js"));
});

afterEach(() => {
  if (gateway) {
    gateway.stop();
    gateway = null;
  }
  vi.clearAllMocks();
  currentSocket = null;
});

describe("GatewayService", () => {
  it("envía el handshake al conectarse", () => {
    gateway = new GatewayService();
    gateway.start();

    expect(createConnectionMock).toHaveBeenCalledWith({ host: "127.0.0.1", port: 5000 });
    expect(currentSocket).not.toBeNull();

    currentSocket.emit("connect");

    expect(currentSocket.writes[0]).toBe("00010sinitgwapi");
  });

  it("responde con el resultado HTTP cuando recibe instrucciones", async () => {
    gateway = new GatewayService();
    gateway.start();
    currentSocket.emit("connect");

    const handshakeAck = Buffer.from("00007sinitOK", "utf8");
    currentSocket.emit("data", handshakeAck);
  await new Promise((resolve) => setTimeout(resolve, 0));

    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name === "content-type" ? "application/json" : null),
        entries: () => [["content-type", "application/json"]][Symbol.iterator](),
      },
      json: async () => ({ message: "ok" }),
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    global.fetch = fetchMock;

    const payload = JSON.stringify({ method: "GET", path: "/health" });
    const body = `ABCDE${payload}`;
    const header = String(body.length).padStart(5, "0");
    const frame = Buffer.from(header + body, "utf8");
    currentSocket.emit("data", frame);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const responseFrame = currentSocket.writes.at(-1);
    expect(responseFrame.startsWith("000")).toBe(true);
    const length = Number.parseInt(responseFrame.slice(0, 5), 10);
    expect(Number.isNaN(length)).toBe(false);
    const responseBody = responseFrame.slice(5);
    expect(responseBody.startsWith("ABCDE")).toBe(true);

    const responsePayload = JSON.parse(responseBody.slice(5));
    expect(responsePayload.ok).toBe(true);
    expect(responsePayload.status).toBe(200);
    expect(responsePayload.data).toEqual({ message: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("http://127.0.0.1:3000/health");

    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  });

  it("propaga solicitudes para crear tickets con cuerpo JSON y cabeceras", async () => {
    gateway = new GatewayService();
    gateway.start();
    currentSocket.emit("connect");

    const handshakeAck = Buffer.from("00007sinitOK", "utf8");
    currentSocket.emit("data", handshakeAck);
  await new Promise((resolve) => setTimeout(resolve, 0));

    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      headers: {
        get: (name) => (name === "content-type" ? "application/json" : null),
        entries: () => [["content-type", "application/json"]][Symbol.iterator](),
      },
      json: async () => ({ id: 42, title: "Nuevo ticket" }),
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    global.fetch = fetchMock;

    const address = "TK001";
    const payload = {
      method: "POST",
      path: "/api/tickets",
      headers: { Authorization: "Bearer token" },
      body: {
        title: "Nuevo ticket",
        description: "Descripcion",
        categoria_id: 2,
        priority: "ALTA",
      },
    };

    const instruction = JSON.stringify(payload);
    const body = `${address}${instruction}`;
    const frame = Buffer.from(`${String(body.length).padStart(5, "0")}${body}`, "utf8");
    currentSocket.emit("data", frame);

    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toBe("http://127.0.0.1:3000/api/tickets");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer token");
      expect(init.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual(payload.body);

      const responseFrame = currentSocket.writes.at(-1);
      expect(responseFrame.slice(5, 10)).toBe(address);
      const responsePayload = JSON.parse(responseFrame.slice(10));
      expect(responsePayload.ok).toBe(true);
      expect(responsePayload.status).toBe(201);
      expect(responsePayload.data).toEqual({ id: 42, title: "Nuevo ticket" });
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });

  it("serializa parámetros de consulta al listar tickets", async () => {
    gateway = new GatewayService();
    gateway.start();
    currentSocket.emit("connect");

    const handshakeAck = Buffer.from("00007sinitOK", "utf8");
    currentSocket.emit("data", handshakeAck);

    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name === "content-type" ? "application/json" : null),
        entries: () => [["content-type", "application/json"]][Symbol.iterator](),
      },
      json: async () => ({ tickets: [] }),
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    global.fetch = fetchMock;

    const address = "TKLST";
    const payload = {
      method: "GET",
      path: "/api/tickets",
      query: {
        status: "NUEVO",
        categoria_id: 3,
        priority: "ALTA",
      },
      headers: { Authorization: "Bearer token" },
    };

    const instruction = JSON.stringify(payload);
    const body = `${address}${instruction}`;
    const frame = Buffer.from(`${String(body.length).padStart(5, "0")}${body}`, "utf8");
    currentSocket.emit("data", frame);

    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0];
      const parsedUrl = new URL(url.toString());
      expect(parsedUrl.pathname).toBe("/api/tickets");
      expect(parsedUrl.searchParams.get("status")).toBe("NUEVO");
      expect(parsedUrl.searchParams.get("categoria_id")).toBe("3");
      expect(parsedUrl.searchParams.get("priority")).toBe("ALTA");
      expect(init.method).toBe("GET");
      expect(init.headers.authorization).toBe("Bearer token");
      expect(init.body).toBeUndefined();

      const responseFrame = currentSocket.writes.at(-1);
      expect(responseFrame.slice(5, 10)).toBe(address);
      const responsePayload = JSON.parse(responseFrame.slice(10));
      expect(responsePayload.ok).toBe(true);
      expect(responsePayload.status).toBe(200);
      expect(responsePayload.data).toEqual({ tickets: [] });
    } finally {
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });
});
