import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requestId(request) {
  const candidate = request.headers["x-request-id"];
  return typeof candidate === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function sendJson(response, status, body, id) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-request-id": id,
  });
  response.end(payload);
}

function readJson(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        tooLarge = true;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes`));
        return;
      }
      if (chunks.length === 0) {
        reject(new HttpError(400, "INVALID_JSON", "Request body must contain JSON"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "INVALID_JSON", "Request body is not valid JSON"));
      }
    });
  });
}

function requireJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "INVALID_PATH", "Path contains invalid percent encoding");
  }
}

function errorResponse(error, id) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, requestId: id, details: error.details } },
    };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: error.message, requestId: id } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "An internal error occurred", requestId: id } },
  };
}

export function createTraceabilityHttpHandler({ application, maxBodyBytes = 1024 * 1024 }) {
  if (!application) throw new TypeError("application is required");

  return async function traceabilityHttpHandler(request, response) {
    const id = requestId(request);
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" }, id);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/trace-chains/evaluate") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 200, application.evaluate(input), id);
        return;
      }

      const persistMatch = /^\/v1\/projects\/([^/]+)\/trace-chains$/.exec(url.pathname);
      if (request.method === "POST" && persistMatch) {
        requireJson(request);
        const projectId = decodePathSegment(persistMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const result = await application.evaluateAndPersist(projectId, input);
        sendJson(response, 201, result, id);
        return;
      }

      const currentMatch = /^\/v1\/projects\/([^/]+)\/trace-chains\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && currentMatch) {
        const projectId = decodePathSegment(currentMatch[1]);
        const chainId = decodePathSegment(currentMatch[2]);
        const chain = await application.getCurrentTraceChain(projectId, chainId);
        if (!chain) throw new HttpError(404, "TRACE_CHAIN_NOT_FOUND", "Trace chain was not found");
        sendJson(response, 200, chain, id);
        return;
      }

      throw new HttpError(404, "ROUTE_NOT_FOUND", "Route was not found");
    } catch (error) {
      const failure = errorResponse(error, id);
      sendJson(response, failure.status, failure.body, id);
    }
  };
}

export function createTraceabilityHttpServer(options) {
  return createServer(createTraceabilityHttpHandler(options));
}
