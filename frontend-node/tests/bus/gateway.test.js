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
});
