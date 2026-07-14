import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PersistenceConflictError, RunnerAttestationError, ScannerAttestationError } from "../storage/index.js";

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

function optionalVersion(url) {
  const value = url.searchParams.get("version");
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value)) throw new TypeError("version must be a positive integer");
  const version = Number(value);
  if (!Number.isSafeInteger(version)) throw new TypeError("version must be a positive integer");
  return version;
}

function repeatedEnumFilter(url, name) {
  return url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function optionalLimit(url) {
  const value = url.searchParams.get("limit");
  if (value === null) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("limit must be an integer between 1 and 500");
  return Number(value);
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
  if (error instanceof PersistenceConflictError) {
    return {
      status: 409,
      body: { error: { code: "PERSISTENCE_CONFLICT", message: error.message, requestId: id } },
    };
  }
  if (error instanceof RunnerAttestationError) {
    return {
      status: 401,
      body: { error: { code: "RUNNER_ATTESTATION_INVALID", message: error.message, requestId: id } },
    };
  }
  if (error instanceof ScannerAttestationError) {
    return {
      status: 401,
      body: { error: { code: "SCANNER_ATTESTATION_INVALID", message: error.message, requestId: id } },
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

      const governanceAppendMatch = /^\/v1\/projects\/([^/]+)\/(features|claim-scopes|claims|decisions)$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && governanceAppendMatch) {
        requireJson(request);
        const projectId = decodePathSegment(governanceAppendMatch[1]);
        const resource = governanceAppendMatch[2];
        const input = await readJson(request, maxBodyBytes);
        const operations = {
          features: "appendFeatureVersion",
          "claim-scopes": "appendClaimScope",
          claims: "appendClaim",
          decisions: "appendDecision",
        };
        const created = await application[operations[resource]](projectId, input);
        sendJson(response, 201, created, id);
        return;
      }

      const featureBaselineMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/baseline$/.exec(url.pathname);
      if (request.method === "GET" && featureBaselineMatch) {
        const projectId = decodePathSegment(featureBaselineMatch[1]);
        const featureId = decodePathSegment(featureBaselineMatch[2]);
        const baseline = await application.getFeatureBaseline(projectId, featureId);
        if (!baseline) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, baseline, id);
        return;
      }

      const testSpecCollectionMatch = /^\/v1\/projects\/([^/]+)\/test-specs$/.exec(url.pathname);
      if (request.method === "POST" && testSpecCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(testSpecCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const created = await application.appendTestSpec(projectId, input);
        sendJson(response, 201, created, id);
        return;
      }

      const candidateValidationMatch = /^\/v1\/projects\/([^/]+)\/test-specs\/validate$/.exec(url.pathname);
      if (request.method === "POST" && candidateValidationMatch) {
        requireJson(request);
        decodePathSegment(candidateValidationMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 200, application.validateTestSpec(input), id);
        return;
      }

      const storedTestSpecMatch = /^\/v1\/projects\/([^/]+)\/test-specs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && storedTestSpecMatch) {
        const projectId = decodePathSegment(storedTestSpecMatch[1]);
        const testSpecId = decodePathSegment(storedTestSpecMatch[2]);
        const testSpec = await application.getTestSpec(projectId, testSpecId, optionalVersion(url));
        if (!testSpec) throw new HttpError(404, "TEST_SPEC_NOT_FOUND", "TestSpec was not found");
        sendJson(response, 200, testSpec, id);
        return;
      }

      const storedValidationMatch = /^\/v1\/projects\/([^/]+)\/test-specs\/([^/]+)\/validate$/.exec(url.pathname);
      if (request.method === "POST" && storedValidationMatch) {
        const projectId = decodePathSegment(storedValidationMatch[1]);
        const testSpecId = decodePathSegment(storedValidationMatch[2]);
        const validation = await application.validateStoredTestSpec(
          projectId,
          testSpecId,
          optionalVersion(url),
        );
        if (!validation) throw new HttpError(404, "TEST_SPEC_NOT_FOUND", "TestSpec was not found");
        sendJson(response, 200, validation, id);
        return;
      }

      const executionCollectionMatch = /^\/v1\/projects\/([^/]+)\/test-executions$/.exec(url.pathname);
      if (request.method === "POST" && executionCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(executionCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const stored = await application.ingestExecutionEvidence(projectId, input);
        sendJson(response, 201, stored, id);
        return;
      }

      const executionEvidenceMatch =
        /^\/v1\/projects\/([^/]+)\/test-executions\/([^/]+)\/evidence$/.exec(url.pathname);
      if (request.method === "GET" && executionEvidenceMatch) {
        const projectId = decodePathSegment(executionEvidenceMatch[1]);
        const executionId = decodePathSegment(executionEvidenceMatch[2]);
        const bundle = await application.getExecutionEvidence(projectId, executionId);
        if (!bundle) throw new HttpError(404, "TEST_EXECUTION_NOT_FOUND", "TestExecution was not found");
        sendJson(response, 200, bundle, id);
        return;
      }

      const factScanCollectionMatch = /^\/v1\/projects\/([^/]+)\/fact-scans$/.exec(url.pathname);
      if (request.method === "POST" && factScanCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(factScanCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const stored = await application.ingestFactBundle(projectId, input);
        sendJson(response, 201, stored, id);
        return;
      }

      const factsCollectionMatch = /^\/v1\/projects\/([^/]+)\/facts$/.exec(url.pathname);
      if (request.method === "GET" && factsCollectionMatch) {
        const projectId = decodePathSegment(factsCollectionMatch[1]);
        const graph = await application.queryFacts(projectId, {
          snapshotManifestId: url.searchParams.get("snapshotManifestId"),
          types: repeatedEnumFilter(url, "type"),
          predicates: repeatedEnumFilter(url, "predicate"),
          query: url.searchParams.get("q"),
          limit: optionalLimit(url),
        });
        sendJson(response, 200, graph, id);
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
