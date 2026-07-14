import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  PersistenceConflictError,
  ReviewAuthenticationError,
  ReviewAuthorizationError,
  RunnerAttestationError,
  ScannerAttestationError,
  SkillAttestationError,
} from "../storage/index.js";

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
  if (error instanceof SkillAttestationError) {
    return {
      status: 401,
      body: { error: { code: "SKILL_ATTESTATION_INVALID", message: error.message, requestId: id } },
    };
  }
  if (error instanceof ReviewAuthenticationError) {
    return {
      status: 401,
      body: { error: { code: "REVIEWER_AUTHENTICATION_REQUIRED", message: error.message, requestId: id } },
    };
  }
  if (error instanceof ReviewAuthorizationError) {
    return {
      status: 403,
      body: { error: { code: "REVIEWER_NOT_AUTHORIZED", message: error.message, requestId: id } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "An internal error occurred", requestId: id } },
  };
}

function normalizeCorsOrigins(value) {
  if (!Array.isArray(value)) throw new TypeError("corsAllowedOrigins must be an array");
  return new Set(value.map((origin, index) => {
    if (typeof origin !== "string" || origin.trim() === "" || origin === "*") {
      throw new TypeError(`corsAllowedOrigins[${index}] must be an explicit origin`);
    }
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) {
      throw new TypeError(`corsAllowedOrigins[${index}] must contain only scheme, host, and port`);
    }
    return origin;
  }));
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !allowedOrigins.has(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, x-request-id, x-traqen-api-token",
  );
  response.setHeader("access-control-expose-headers", "x-request-id");
  response.setHeader("vary", "Origin");
  return true;
}

function bearerAuthorized(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createTraceabilityHttpHandler({
  application,
  maxBodyBytes = 1024 * 1024,
  corsAllowedOrigins = [],
  apiBearerToken = null,
}) {
  if (!application) throw new TypeError("application is required");
  if (apiBearerToken !== null && (typeof apiBearerToken !== "string" || apiBearerToken === "")) {
    throw new TypeError("apiBearerToken must be null or a non-empty string");
  }
  const allowedOrigins = normalizeCorsOrigins(corsAllowedOrigins);

  return async function traceabilityHttpHandler(request, response) {
    const id = requestId(request);
    applyCors(request, response, allowedOrigins);
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "OPTIONS") {
        response.writeHead(204, { "cache-control": "no-store", "x-request-id": id });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" }, id);
        return;
      }

      if (apiBearerToken !== null) {
        const apiTokenHeader = request.headers["x-traqen-api-token"];
        const apiAuthorized =
          (typeof apiTokenHeader === "string" && bearerAuthorized(`Bearer ${apiTokenHeader}`, apiBearerToken)) ||
          bearerAuthorized(request.headers.authorization, apiBearerToken);
        if (!apiAuthorized) {
          throw new HttpError(401, "API_AUTHENTICATION_REQUIRED", "A valid API bearer token is required");
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/projects") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.createProject(input), id);
        return;
      }

      const projectMatch = /^\/v1\/projects\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && projectMatch) {
        const projectId = decodePathSegment(projectMatch[1]);
        const project = await application.getProject(projectId);
        if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        sendJson(response, 200, project, id);
        return;
      }

      const snapshotCollectionMatch = /^\/v1\/projects\/([^/]+)\/snapshots$/.exec(url.pathname);
      if (request.method === "POST" && snapshotCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(snapshotCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.registerSnapshot(projectId, input), id);
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
        const created = await application[operations[resource]](projectId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        });
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

      const featureTraceabilityMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/traceability$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && featureTraceabilityMatch) {
        const projectId = decodePathSegment(featureTraceabilityMatch[1]);
        const featureId = decodePathSegment(featureTraceabilityMatch[2]);
        const snapshotManifestId = url.searchParams.get("snapshotManifestId");
        if (!snapshotManifestId) throw new HttpError(400, "SNAPSHOT_REQUIRED", "snapshotManifestId is required");
        const traceability = await application.getFeatureTraceability(projectId, featureId, snapshotManifestId);
        if (!traceability) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, traceability, id);
        return;
      }

      const implementationReanalysisMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/claims\/([^/]+)\/implementation-reanalyses$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && implementationReanalysisMatch) {
        requireJson(request);
        const projectId = decodePathSegment(implementationReanalysisMatch[1]);
        const featureId = decodePathSegment(implementationReanalysisMatch[2]);
        const claimId = decodePathSegment(implementationReanalysisMatch[3]);
        const input = await readJson(request, maxBodyBytes);
        const analysis = await application.reanalyzeImplementation(projectId, featureId, claimId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        });
        sendJson(response, 201, analysis, id);
        return;
      }

      const featureRecomputeMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/trace-chains\/recompute$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && featureRecomputeMatch) {
        requireJson(request);
        const projectId = decodePathSegment(featureRecomputeMatch[1]);
        const featureId = decodePathSegment(featureRecomputeMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        const traceability = await application.recomputeFeatureTraceChains(
          projectId,
          featureId,
          input.snapshotManifestId,
        );
        if (!traceability) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 201, traceability, id);
        return;
      }

      const changeSetCollectionMatch = /^\/v1\/projects\/([^/]+)\/change-sets$/.exec(url.pathname);
      if (request.method === "POST" && changeSetCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(changeSetCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const changeImpact = await application.compareAndPersistSnapshots(projectId, input);
        sendJson(response, 201, changeImpact, id);
        return;
      }

      const changeImpactMatch = /^\/v1\/projects\/([^/]+)\/change-sets\/([^/]+)\/impact$/.exec(url.pathname);
      if (request.method === "GET" && changeImpactMatch) {
        const projectId = decodePathSegment(changeImpactMatch[1]);
        const changeSetId = decodePathSegment(changeImpactMatch[2]);
        const changeImpact = await application.getChangeImpact(projectId, changeSetId);
        if (!changeImpact) throw new HttpError(404, "CHANGE_SET_NOT_FOUND", "ChangeSet was not found");
        sendJson(response, 200, changeImpact, id);
        return;
      }

      const testSpecCollectionMatch = /^\/v1\/projects\/([^/]+)\/test-specs$/.exec(url.pathname);
      if (request.method === "POST" && testSpecCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(testSpecCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const created = await application.appendTestSpecDraft(projectId, input);
        sendJson(response, 201, created, id);
        return;
      }

      const generatedTestSpecMatch =
        /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/claims\/([^/]+)\/test-spec-drafts$/.exec(url.pathname);
      if (request.method === "POST" && generatedTestSpecMatch) {
        requireJson(request);
        const projectId = decodePathSegment(generatedTestSpecMatch[1]);
        const featureId = decodePathSegment(generatedTestSpecMatch[2]);
        const claimId = decodePathSegment(generatedTestSpecMatch[3]);
        const input = await readJson(request, maxBodyBytes);
        const generated = await application.generateTestSpecDraft(projectId, featureId, claimId, input);
        sendJson(response, 201, generated, id);
        return;
      }

      const testSpecApprovalMatch = /^\/v1\/projects\/([^/]+)\/test-specs\/([^/]+)\/approvals$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && testSpecApprovalMatch) {
        requireJson(request);
        const projectId = decodePathSegment(testSpecApprovalMatch[1]);
        const testSpecId = decodePathSegment(testSpecApprovalMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        const approved = await application.approveTestSpec(projectId, testSpecId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        });
        sendJson(response, 201, approved, id);
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

      if (url.pathname === "/v1/skills" && request.method === "POST") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        const registration = await application.registerReverseSkill(input);
        sendJson(response, 201, registration, id);
        return;
      }

      if (url.pathname === "/v1/skills" && request.method === "GET") {
        sendJson(response, 200, { skills: await application.listReverseSkills() }, id);
        return;
      }

      if (url.pathname === "/v1/reverse-runs" && request.method === "POST") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        const run = await application.executeReverseRun(input);
        sendJson(response, 201, run, id);
        return;
      }

      const reverseRunMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && reverseRunMatch) {
        const projectId = decodePathSegment(reverseRunMatch[1]);
        const runId = decodePathSegment(reverseRunMatch[2]);
        const run = await application.getReverseRun(projectId, runId);
        if (!run) throw new HttpError(404, "REVERSE_RUN_NOT_FOUND", "Reverse run was not found");
        sendJson(response, 200, run, id);
        return;
      }

      const reverseRunReviewsMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)\/reviews$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && reverseRunReviewsMatch) {
        const projectId = decodePathSegment(reverseRunReviewsMatch[1]);
        const runId = decodePathSegment(reverseRunReviewsMatch[2]);
        if (!(await application.getReverseRun(projectId, runId))) {
          throw new HttpError(404, "REVERSE_RUN_NOT_FOUND", "Reverse run was not found");
        }
        sendJson(response, 200, {
          reviews: await application.listReverseCandidateReviews(projectId, runId),
        }, id);
        return;
      }

      const candidateReviewMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)\/candidates\/([^/]+)\/reviews$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && candidateReviewMatch) {
        requireJson(request);
        const projectId = decodePathSegment(candidateReviewMatch[1]);
        const runId = decodePathSegment(candidateReviewMatch[2]);
        const candidateId = decodePathSegment(candidateReviewMatch[3]);
        const input = await readJson(request, maxBodyBytes);
        const reviewed = await application.reviewReverseCandidate(projectId, runId, candidateId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        });
        sendJson(response, 201, reviewed, id);
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
