import net from "net";
import process from "process";
import config from "../src/config.js";

const HEADER_LENGTH = 5;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      i -= 1;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function encodeRequest(service, payload) {
  const json = JSON.stringify(payload);
  const body = `${service}${json}`;
  const header = String(body.length).padStart(HEADER_LENGTH, "0");
  return Buffer.from(header + body, "utf8");
}

function decodeResponse(buffer) {
  if (buffer.length < HEADER_LENGTH) throw new Error("Incomplete response header");
  const length = Number.parseInt(buffer.slice(0, HEADER_LENGTH).toString("utf8"), 10);
  const body = buffer.slice(HEADER_LENGTH, HEADER_LENGTH + length).toString("utf8");
  const address = body.slice(0, 5);
  const status = body.slice(5, 7);
  const payload = body.slice(7);
  let data = null;
  try {
    data = payload ? JSON.parse(payload) : null;
  } catch (error) {
    data = payload;
  }
  return { address, status, data };
}

async function main() {
  const args = parseArgs(process.argv);
  const service = (args.service || config.bus.serviceName).slice(0, 5);
  const method = (args.method || "GET").toUpperCase();
  const path = args.path || "/api/auth/me";

  let body = undefined;
  if (args.body) {
    try {
      body = JSON.parse(args.body);
    } catch (error) {
      throw new Error(`Invalid --body JSON: ${error.message}`);
    }
  }

  let query = undefined;
  if (args.query) {
    try {
      query = JSON.parse(args.query);
    } catch (error) {
      throw new Error(`Invalid --query JSON: ${error.message}`);
    }
  }

  const payload = {
    method,
    path,
    query,
    body,
  };

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.bus.host, port: config.bus.port });
    let responseBuffer = Buffer.alloc(0);
    let settled = false;

    function finishWith(buffer) {
      if (settled) return;
      settled = true;
      try {
        const decoded = decodeResponse(buffer);
        process.stdout.write(`${JSON.stringify(decoded, null, 2)}\n`);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    }

    socket.on("connect", () => {
      socket.write(encodeRequest(service, payload));
    });

    socket.on("data", (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      if (responseBuffer.length < HEADER_LENGTH) return;
      const length = Number.parseInt(responseBuffer.slice(0, HEADER_LENGTH).toString("utf8"), 10);
      if (Number.isNaN(length)) {
        reject(new Error("Invalid response length"));
        socket.end();
        settled = true;
        return;
      }
      if (responseBuffer.length >= HEADER_LENGTH + length) {
        finishWith(responseBuffer.slice(0, HEADER_LENGTH + length));
      }
    });

    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    socket.on("end", () => {
      if (!settled) {
        finishWith(responseBuffer);
      }
    });
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
