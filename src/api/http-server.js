import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AnalysisModelConnectionError } from "../analysis/index.js";
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

function startNdjson(response, id) {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-content-type-options": "nosniff",
    "x-request-id": id,
  });
  response.flushHeaders?.();
}

function writeNdjson(response, value) {
  response.write(`${JSON.stringify(value)}\n`);
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

function boundedQueryInteger(url, name, fallback, maximum) {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
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
  if (error instanceof AnalysisModelConnectionError) {
    return {
      status: 502,
      body: { error: { code: "ANALYSIS_MODEL_UNAVAILABLE", message: error.message, requestId: id } },
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
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
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

      const projectMetricsMatch = /^\/v1\/projects\/([^/]+)\/metrics\/product-effectiveness$/.exec(url.pathname);
      if (request.method === "GET" && projectMetricsMatch) {
        const projectId = decodePathSegment(projectMetricsMatch[1]);
        const snapshotManifestId = url.searchParams.get("snapshotManifestId");
        if (!snapshotManifestId) throw new HttpError(400, "SNAPSHOT_REQUIRED", "snapshotManifestId is required");
        const metrics = await application.getProductEffectivenessMetrics(projectId, snapshotManifestId);
        if (!metrics) throw new HttpError(404, "SNAPSHOT_NOT_FOUND", "Snapshot Manifest was not found");
        sendJson(response, 200, metrics, id);
        return;
      }

      const platformMetricsMatch = /^\/v1\/projects\/([^/]+)\/metrics\/platform-operations$/.exec(url.pathname);
      if (request.method === "GET" && platformMetricsMatch) {
        const projectId = decodePathSegment(platformMetricsMatch[1]);
        const metrics = await application.getPlatformOperationsMetrics(projectId);
        if (!metrics) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project was not found");
        sendJson(response, 200, metrics, id);
        return;
      }

      const evidencePolicyCollectionMatch = /^\/v1\/projects\/([^/]+)\/evidence-retention-policies$/.exec(url.pathname);
      if (request.method === "POST" && evidencePolicyCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(evidencePolicyCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendEvidenceRetentionPolicy(projectId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
        return;
      }

      const evidenceLifecycleEventMatch = /^\/v1\/projects\/([^/]+)\/evidence\/([^/]+)\/lifecycle-events$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && evidenceLifecycleEventMatch) {
        requireJson(request);
        const projectId = decodePathSegment(evidenceLifecycleEventMatch[1]);
        const evidenceId = decodePathSegment(evidenceLifecycleEventMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendEvidenceLifecycleEvent(projectId, evidenceId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
        return;
      }

      const evidenceLifecycleMatch = /^\/v1\/projects\/([^/]+)\/evidence\/([^/]+)\/lifecycle$/.exec(url.pathname);
      if (request.method === "GET" && evidenceLifecycleMatch) {
        const projectId = decodePathSegment(evidenceLifecycleMatch[1]);
        const evidenceId = decodePathSegment(evidenceLifecycleMatch[2]);
        const policyId = url.searchParams.get("policyId");
        if (!policyId) throw new HttpError(400, "EVIDENCE_POLICY_REQUIRED", "policyId is required");
        const rawVersion = url.searchParams.get("policyVersion");
        const policyVersion = rawVersion === null ? null : boundedQueryInteger(url, "policyVersion", 1, 1_000_000);
        const lifecycle = await application.getEvidenceLifecycle(projectId, evidenceId, policyId, policyVersion);
        if (!lifecycle) throw new HttpError(404, "EVIDENCE_LIFECYCLE_NOT_FOUND", "Evidence or retention policy was not found");
        sendJson(response, 200, lifecycle, id);
        return;
      }

      const snapshotCollectionMatch = /^\/v1\/projects\/([^/]+)\/snapshots$/.exec(url.pathname);
      if (request.method === "GET" && snapshotCollectionMatch) {
        const projectId = decodePathSegment(snapshotCollectionMatch[1]);
        sendJson(response, 200, { snapshots: await application.listSnapshotManifests(projectId) }, id);
        return;
      }
      if (request.method === "POST" && snapshotCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(snapshotCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.registerSnapshot(projectId, input), id);
        return;
      }

      const decisionReviewCaseCollectionMatch = /^\/v1\/projects\/([^/]+)\/decision-review-cases$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && decisionReviewCaseCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(decisionReviewCaseCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.createDecisionReviewCase(projectId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
        return;
      }

      const decisionReviewCaseMatch = /^\/v1\/projects\/([^/]+)\/decision-review-cases\/([^/]+)$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && decisionReviewCaseMatch) {
        const projectId = decodePathSegment(decisionReviewCaseMatch[1]);
        const caseId = decodePathSegment(decisionReviewCaseMatch[2]);
        const reviewCase = await application.getDecisionReviewCase(projectId, caseId);
        if (!reviewCase) throw new HttpError(404, "DECISION_REVIEW_CASE_NOT_FOUND", "Decision review case was not found");
        sendJson(response, 200, reviewCase, id);
        return;
      }

      const decisionReviewEventMatch = /^\/v1\/projects\/([^/]+)\/decision-review-cases\/([^/]+)\/events$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && decisionReviewEventMatch) {
        requireJson(request);
        const projectId = decodePathSegment(decisionReviewEventMatch[1]);
        const caseId = decodePathSegment(decisionReviewEventMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendDecisionReviewEvent(projectId, caseId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
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
      const featureCollectionMatch = /^\/v1\/projects\/([^/]+)\/features$/.exec(url.pathname);
      if (request.method === "GET" && featureCollectionMatch) {
        const projectId = decodePathSegment(featureCollectionMatch[1]);
        sendJson(response, 200, { features: await application.listFeatures(projectId) }, id);
        return;
      }
      const featureLineageCollectionMatch = /^\/v1\/projects\/([^/]+)\/feature-lineages$/.exec(url.pathname);
      if (request.method === "GET" && featureLineageCollectionMatch) {
        const projectId = decodePathSegment(featureLineageCollectionMatch[1]);
        const featureId = url.searchParams.get("featureId");
        sendJson(response, 200, { lineages: await application.listFeatureLineages(projectId, featureId) }, id);
        return;
      }
      if (request.method === "POST" && featureLineageCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(featureLineageCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendFeatureLineage(projectId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
        return;
      }
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

      const featureDetailMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && featureDetailMatch) {
        const projectId = decodePathSegment(featureDetailMatch[1]);
        const featureId = decodePathSegment(featureDetailMatch[2]);
        const baseline = await application.getFeatureBaseline(projectId, featureId);
        if (!baseline) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, baseline, id);
        return;
      }

      const featureAliasCollectionMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/aliases$/.exec(url.pathname);
      if (request.method === "GET" && featureAliasCollectionMatch) {
        const projectId = decodePathSegment(featureAliasCollectionMatch[1]);
        const featureId = decodePathSegment(featureAliasCollectionMatch[2]);
        const aliases = await application.listFeatureAliases(projectId, featureId);
        if (!aliases) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, { aliases }, id);
        return;
      }
      if (request.method === "POST" && featureAliasCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(featureAliasCollectionMatch[1]);
        const featureId = decodePathSegment(featureAliasCollectionMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendFeatureAlias(projectId, featureId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
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

      const featureProcessModelMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/process-model$/.exec(
        url.pathname,
      );
      if (featureProcessModelMatch && request.method === "POST") {
        requireJson(request);
        const projectId = decodePathSegment(featureProcessModelMatch[1]);
        const featureId = decodePathSegment(featureProcessModelMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, await application.appendBusinessProcessModel(projectId, featureId, input, {
          authorization: request.headers.authorization ?? null,
          requestId: id,
        }), id);
        return;
      }
      if (featureProcessModelMatch && request.method === "GET") {
        const projectId = decodePathSegment(featureProcessModelMatch[1]);
        const featureId = decodePathSegment(featureProcessModelMatch[2]);
        const processModel = await application.getBusinessProcessModel(projectId, featureId);
        if (!processModel) throw new HttpError(404, "PROCESS_MODEL_NOT_FOUND", "Business process model was not found");
        sendJson(response, 200, processModel, id);
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

      const featureDerivedCollectionMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/(conflicts|trace-chains)$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && featureDerivedCollectionMatch) {
        const projectId = decodePathSegment(featureDerivedCollectionMatch[1]);
        const featureId = decodePathSegment(featureDerivedCollectionMatch[2]);
        const snapshotManifestId = url.searchParams.get("snapshotManifestId");
        const resource = featureDerivedCollectionMatch[3];
        const result = resource === "conflicts"
          ? await application.getFeatureConflicts(projectId, featureId, snapshotManifestId)
          : await application.getFeatureTraceChains(projectId, featureId, snapshotManifestId);
        if (!result) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, result, id);
        return;
      }

      const featureGraphMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/graph$/.exec(url.pathname);
      if (request.method === "GET" && featureGraphMatch) {
        const projectId = decodePathSegment(featureGraphMatch[1]);
        const featureId = decodePathSegment(featureGraphMatch[2]);
        const snapshotManifestId = url.searchParams.get("snapshotManifestId");
        if (!snapshotManifestId) throw new HttpError(400, "SNAPSHOT_REQUIRED", "snapshotManifestId is required");
        const graph = await application.getFeatureGraph(projectId, featureId, snapshotManifestId, {
          view: url.searchParams.get("view") ?? "traceability",
          depth: boundedQueryInteger(url, "depth", 1, 8),
          limit: boundedQueryInteger(url, "limit", 30, 100),
          nodeTypes: repeatedEnumFilter(url, "nodeType"),
          relations: repeatedEnumFilter(url, "relation"),
        });
        if (!graph) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, graph, id);
        return;
      }

      const featureGraphPathMatch = /^\/v1\/projects\/([^/]+)\/features\/([^/]+)\/graph\/paths\/query$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && featureGraphPathMatch) {
        requireJson(request);
        const projectId = decodePathSegment(featureGraphPathMatch[1]);
        const featureId = decodePathSegment(featureGraphPathMatch[2]);
        const input = await readJson(request, maxBodyBytes);
        const path = await application.queryFeatureGraphPath(projectId, featureId, input);
        if (!path) throw new HttpError(404, "FEATURE_NOT_FOUND", "Feature was not found");
        sendJson(response, 200, path, id);
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

      const continuousProtectionMatch =
        /^\/v1\/projects\/([^/]+)\/change-sets\/([^/]+)\/continuous-protection$/.exec(url.pathname);
      if (request.method === "GET" && continuousProtectionMatch) {
        const projectId = decodePathSegment(continuousProtectionMatch[1]);
        const changeSetId = decodePathSegment(continuousProtectionMatch[2]);
        const assessment = await application.getContinuousProtectionAssessment(projectId, changeSetId);
        if (!assessment) throw new HttpError(404, "CHANGE_SET_NOT_FOUND", "ChangeSet was not found");
        sendJson(response, 200, assessment, id);
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

      const workspaceObservationCollectionMatch =
        /^\/v1\/projects\/([^/]+)\/workspace-observations$/.exec(url.pathname);
      if (request.method === "POST" && workspaceObservationCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(workspaceObservationCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const receipt = await application.ingestWorkspaceObservations(projectId, input);
        sendJson(response, 201, receipt, id);
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

      if (url.pathname === "/v1/analysis-model-profiles" && request.method === "GET") {
        sendJson(response, 200, { profiles: application.listAnalysisModelProfiles() }, id);
        return;
      }

      if (url.pathname === "/v1/analysis-model-profiles" && request.method === "POST") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        sendJson(response, 201, application.configureAnalysisModelProfile(input), id);
        return;
      }

      const analysisModelVerifyMatch = /^\/v1\/analysis-model-profiles\/([^/]+)\/verify$/.exec(url.pathname);
      if (request.method === "POST" && analysisModelVerifyMatch) {
        const profileId = decodePathSegment(analysisModelVerifyMatch[1]);
        sendJson(response, 200, await application.verifyAnalysisModelProfile(profileId), id);
        return;
      }

      const analysisModelSelectMatch = /^\/v1\/analysis-model-profiles\/([^/]+)\/select$/.exec(url.pathname);
      if (request.method === "POST" && analysisModelSelectMatch) {
        const profileId = decodePathSegment(analysisModelSelectMatch[1]);
        sendJson(response, 200, application.selectAnalysisModelProfile(profileId), id);
        return;
      }

      const analysisModelDeleteMatch = /^\/v1\/analysis-model-profiles\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && analysisModelDeleteMatch) {
        const profileId = decodePathSegment(analysisModelDeleteMatch[1]);
        sendJson(response, 200, application.removeAnalysisModelProfile(profileId), id);
        return;
      }

      const workspaceModelAnalysisMatch = /^\/v1\/analysis-model-profiles\/([^/]+)\/workspace-enrichment$/.exec(url.pathname);
      if (request.method === "POST" && workspaceModelAnalysisMatch) {
        requireJson(request);
        const profileId = decodePathSegment(workspaceModelAnalysisMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const observable = String(request.headers.accept ?? "").toLowerCase().includes("application/x-ndjson");
        if (!observable) {
          const candidateBundle = await application.enrichWorkspaceCandidates(profileId, input);
          sendJson(response, 200, { profileId, candidateBundle }, id);
          return;
        }
        startNdjson(response, id);
        try {
          const candidateBundle = await application.enrichWorkspaceCandidates(profileId, input, {
            onTelemetry: (event) => writeNdjson(response, { kind: "telemetry", event }),
          });
          writeNdjson(response, { kind: "result", profileId, candidateBundle });
        } catch (error) {
          const failure = errorResponse(error, id);
          writeNdjson(response, { kind: "error", error: failure.body.error });
        }
        response.end();
        return;
      }

      const workspaceModelPlanMatch = /^\/v1\/analysis-model-profiles\/([^/]+)\/workspace-plan$/.exec(url.pathname);
      if (request.method === "POST" && workspaceModelPlanMatch) {
        requireJson(request);
        const profileId = decodePathSegment(workspaceModelPlanMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        const observable = String(request.headers.accept ?? "").toLowerCase().includes("application/x-ndjson");
        if (!observable) {
          sendJson(response, 200, { profileId, plan: await application.planWorkspaceAnalysis(profileId, input) }, id);
          return;
        }
        startNdjson(response, id);
        try {
          const plan = await application.planWorkspaceAnalysis(profileId, input, {
            onTelemetry: (event) => writeNdjson(response, { kind: "telemetry", event }),
          });
          writeNdjson(response, { kind: "result", profileId, plan });
        } catch (error) {
          const failure = errorResponse(error, id);
          writeNdjson(response, { kind: "error", error: failure.body.error });
        }
        response.end();
        return;
      }

      const analysisRunsCollectionMatch = /^\/v1\/projects\/([^/]+)\/analysis-runs$/.exec(url.pathname);
      if (request.method === "POST" && analysisRunsCollectionMatch) {
        requireJson(request);
        const projectId = decodePathSegment(analysisRunsCollectionMatch[1]);
        const input = await readJson(request, maxBodyBytes);
        if (input.projectId !== undefined && input.projectId !== projectId) {
          throw new HttpError(400, "PROJECT_MISMATCH", "Request projectId must match the route");
        }
        const requestInput = { ...input, projectId };
        const respondAsync = url.searchParams.get("async") !== "false";
        if (respondAsync) {
          sendJson(response, 202, await application.submitAnalysisRun(requestInput), id);
        } else {
          sendJson(response, 201, await application.executeAnalysisRun(requestInput), id);
        }
        return;
      }

      const analysisRunMatch = /^\/v1\/projects\/([^/]+)\/analysis-runs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && analysisRunMatch) {
        const projectId = decodePathSegment(analysisRunMatch[1]);
        const runId = decodePathSegment(analysisRunMatch[2]);
        const run = await application.getAnalysisRun(projectId, runId);
        if (!run) throw new HttpError(404, "ANALYSIS_RUN_NOT_FOUND", "Analysis run was not found");
        sendJson(response, 200, run, id);
        return;
      }

      const analysisPauseMatch = /^\/v1\/projects\/([^/]+)\/analysis-runs\/([^/]+)\/pause$/.exec(url.pathname);
      if (request.method === "POST" && analysisPauseMatch) {
        const projectId = decodePathSegment(analysisPauseMatch[1]);
        const runId = decodePathSegment(analysisPauseMatch[2]);
        const run = await application.pauseAnalysisRun(projectId, runId);
        if (!run) throw new HttpError(404, "ANALYSIS_RUN_NOT_FOUND", "Analysis run was not found");
        sendJson(response, 202, run, id);
        return;
      }

      const analysisResumeMatch = /^\/v1\/projects\/([^/]+)\/analysis-runs\/([^/]+)\/resume$/.exec(url.pathname);
      if (request.method === "POST" && analysisResumeMatch) {
        const projectId = decodePathSegment(analysisResumeMatch[1]);
        const runId = decodePathSegment(analysisResumeMatch[2]);
        const run = await application.resumeAnalysisRun(projectId, runId);
        if (!run) throw new HttpError(404, "ANALYSIS_RUN_NOT_FOUND", "Analysis run was not found");
        sendJson(response, 202, run, id);
        return;
      }

      const latestAnalysisMatch = /^\/v1\/projects\/([^/]+)\/analysis-results\/latest$/.exec(url.pathname);
      if (request.method === "GET" && latestAnalysisMatch) {
        const projectId = decodePathSegment(latestAnalysisMatch[1]);
        const result = await application.getLatestAnalysisResult(projectId);
        if (!result) throw new HttpError(404, "ANALYSIS_RESULT_NOT_FOUND", "No completed analysis result was found");
        sendJson(response, 200, result, id);
        return;
      }

      const analysisCandidateHistoryMatch = /^\/v1\/projects\/([^/]+)\/analysis-candidates\/([^/]+)\/history$/.exec(url.pathname);
      if (request.method === "GET" && analysisCandidateHistoryMatch) {
        const projectId = decodePathSegment(analysisCandidateHistoryMatch[1]);
        const candidateId = decodePathSegment(analysisCandidateHistoryMatch[2]);
        sendJson(response, 200, { history: await application.getAnalysisCandidateHistory(projectId, candidateId) }, id);
        return;
      }

      if (url.pathname === "/v1/reverse-runs" && request.method === "POST") {
        requireJson(request);
        const input = await readJson(request, maxBodyBytes);
        const respondAsync = url.searchParams.get("async") === "true" ||
          (typeof request.headers.prefer === "string" &&
            request.headers.prefer.split(",").some((value) => value.trim() === "respond-async"));
        if (respondAsync) {
          sendJson(response, 202, await application.submitReverseRun(input), id);
          return;
        }
        const run = await application.executeReverseRun(input);
        sendJson(response, 201, run, id);
        return;
      }

      const reverseRunMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && reverseRunMatch) {
        const projectId = decodePathSegment(reverseRunMatch[1]);
        const runId = decodePathSegment(reverseRunMatch[2]);
        const run = await application.getReverseRun(projectId, runId);
        const job = run ? null : await application.getReverseRunJobProjection(projectId, runId);
        if (!run && !job) throw new HttpError(404, "REVERSE_RUN_NOT_FOUND", "Reverse run was not found");
        sendJson(response, 200, run ?? job, id);
        return;
      }

      const reverseRunCancelMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && reverseRunCancelMatch) {
        const projectId = decodePathSegment(reverseRunCancelMatch[1]);
        const runId = decodePathSegment(reverseRunCancelMatch[2]);
        const job = await application.cancelReverseRun(projectId, runId);
        if (!job) throw new HttpError(404, "REVERSE_RUN_NOT_FOUND", "Reverse run job was not found");
        sendJson(response, 202, job, id);
        return;
      }

      const reverseRunResumeMatch = /^\/v1\/projects\/([^/]+)\/reverse-runs\/([^/]+)\/resume$/.exec(url.pathname);
      if (request.method === "POST" && reverseRunResumeMatch) {
        const projectId = decodePathSegment(reverseRunResumeMatch[1]);
        const runId = decodePathSegment(reverseRunResumeMatch[2]);
        const job = await application.resumeReverseRun(projectId, runId);
        if (!job) throw new HttpError(404, "REVERSE_RUN_NOT_FOUND", "Reverse run job was not found");
        sendJson(response, 202, job, id);
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
