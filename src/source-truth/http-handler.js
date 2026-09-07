import { randomUUID } from "node:crypto";
import { requireValue, SourceTruthError } from "./errors.js";
import { publicRun, sourceBody, sourceBytes, sourceFailure, sourceJson } from "./http-io.js";
import { SourceQueryService } from "./query-service.js";
import { SourceSnapshotReader } from "./admission-service.js";
import { SourceStagingService } from "./staging-service.js";

export function createSourceTruthHttpHandler({ services, authenticate, allowedOrigins = [] }) {
  const { repository, capture, publication, admission, renewal, delta, materials, upload, blobs, policy } = services;
  const queries = services.queries ?? new SourceQueryService(repository, materials);
  const inspection = services.inspection ?? new SourceSnapshotReader(repository, services.candidates);
  const staging = services.staging ?? new SourceStagingService(repository, blobs);
  return async (request, response, id = randomUUID()) => {
    const url = new URL(request.url, "http://localhost");
    const match = /^\/v1\/workspaces\/([^/]+)\/source-truth(?:\/(.*))?$/.exec(url.pathname);
    if (!match) return false;
    try {
      requireValue(!request.headers.origin || allowedOrigins.includes(request.headers.origin), "SOURCE_ORIGIN_FORBIDDEN", "该页面来源未获授权", { status: 403 });
      const actor = authenticate(request);
      const workspaceId = decodeURIComponent(match[1]);
      requireValue(workspaceId.length > 0 && workspaceId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(workspaceId), "SOURCE_INVALID_INPUT", "Workspace 定位符无效", { status: 400 });
      const route = match[2] ?? "";
      const action = request.method;
      const queryOnly = action === "GET" || (action === "POST" && ["admission", "backup-coverage"].includes(route));
      const access = await repository.authorize(actor, workspaceId, !queryOnly);
      if (!queryOnly && route.endsWith("/staging-release")) await services.ensureMaintenanceReady?.();
      else if (!queryOnly && !route.endsWith("/cancel")) await services.ensureReady?.();
      const json = (result, status = 200) => sourceJson(response, status, result, id);
      const page = { limit: Number(url.searchParams.get("limit") ?? 100), cursor: url.searchParams.get("cursor") };
      if (action === "GET" && route === "") {
        const draft = await repository.getDraft(actor, workspaceId);
        const active = await repository.withWorkspace(actor, workspaceId, false, (tx) => repository.activeRun(tx, workspaceId));
        let storage;
        try { storage = { ready: true, ...(await blobs.ready()) }; } catch (error) { storage = { ready: false, code: error.code ?? "SOURCE_STORAGE_UNAVAILABLE" }; }
        json({ actor, role: access.role, draft, activeRun: publicRun(active), versions: await repository.listBundles(actor, workspaceId), storage,
          backup: services.backup ? await services.backup.status(actor, workspaceId) : { status: "NOT_CONFIGURED" },
          policy: { id: policy.id, gitEnabled: Boolean(services.git), maxEntries: policy.maxEntries, maxFileBytes: policy.maxFileBytes, maxTotalBytes: policy.maxTotalBytes, maxChunkBytes: policy.maxChunkBytes, maxBatchEntries: policy.maxBatchEntries } });
      } else if (route === "draft" && action === "PUT") json(await capture.save(actor, workspaceId, await sourceBody(request)));
      else if (/^history\/(runs|bundles|receipts)$/.test(route) && action === "GET") json(await queries.history(actor, workspaceId, route.split("/")[1], page));
      else if (/^bundles\/[a-f0-9]{64}$/.test(route) && action === "GET") json(await queries.bundle(actor, workspaceId, route.split("/")[1]));
      else if (route === "runs" && action === "POST") {
        const run = await capture.start(actor, workspaceId, await sourceBody(request));
        services.dispatch?.(workspaceId, run.id);
        json(publicRun(run), 202);
      } else if (route === "admission" && action === "POST") json(await admission.qualify(actor, workspaceId, await sourceBody(request)));
      else if (route === "backup-coverage" && action === "POST") {
        const reference = await sourceBody(request);
        await inspection.records(actor, workspaceId, reference);
        json(services.backup ? await services.backup.coverage(actor, workspaceId, reference)
          : { status: "NOT_CONFIGURED", bundleId: reference.bundleId, receiptId: reference.receiptId });
      }
      else if (route === "delta" && action === "GET") json(await delta.compare(actor, workspaceId, { fromBundleId: url.searchParams.get("fromBundleId"), toBundleId: url.searchParams.get("toBundleId"), sourceId: url.searchParams.get("sourceId"), ...page }));
      else if (route === "renewal-confirmations" && action === "POST") json(await renewal.confirm(actor, workspaceId, await sourceBody(request)));
      else if (route === "renewal-status" && action === "GET") json(await renewal.latest(actor, workspaceId, { bundleId: url.searchParams.get("bundleId"), receiptId: url.searchParams.get("receiptId") }));
      else if (route === "renewals" && action === "POST") json(await renewal.issue(actor, workspaceId, await sourceBody(request)));
      else {
        const runMatch = /^runs\/([^/]+)(?:\/(.*))?$/.exec(route);
        const versionMatch = /^bundles\/([a-f0-9]{64})\/(inventory|gaps|file|gap-history|inventory-history|file-history|receipts)$/.exec(route);
        if (versionMatch && action === "GET") {
          const reference = { bundleId: versionMatch[1], receiptId: url.searchParams.get("receiptId") };
          if (versionMatch[2] === "inventory") json(await admission.inventory(actor, workspaceId, reference, page));
          else if (versionMatch[2] === "receipts") json(await queries.receipts(actor, workspaceId, reference.bundleId, page));
          else if (versionMatch[2] === "inventory-history") json(await inspection.inventory(actor, workspaceId, reference, page));
          else if (versionMatch[2] === "gaps") json(await admission.inheritedGaps(actor, workspaceId, reference, page));
          else if (versionMatch[2] === "gap-history") json(await queries.gaps(actor, workspaceId, { bundleId: reference.bundleId }, page));
          else await sourceBytes(response, (versionMatch[2] === "file-history" ? inspection : admission).readFile(actor, workspaceId, reference, { componentId: url.searchParams.get("componentId"), pathBytes: url.searchParams.get("pathBytes") }), id);
        } else if (runMatch) {
          const runId = decodeURIComponent(runMatch[1]);
          const tail = runMatch[2] ?? "";
          const run = await repository.getRun(actor, workspaceId, runId);
          requireValue(run, "SOURCE_NOT_FOUND", "任务不存在", { status: 404 });
          if (tail === "" && action === "GET") json(publicRun(run));
          else if (tail === "view" && action === "GET") json(await queries.run(actor, workspaceId, runId));
          else if (tail === "staging-release" && action === "GET") json(await staging.inspect(actor, workspaceId, runId));
          else if (tail === "staging-release" && action === "POST") json(await staging.release(actor, workspaceId, runId, await sourceBody(request)));
          else if (tail === "gaps" && action === "GET") json(await queries.gaps(actor, workspaceId, { runId }, page));
          else if (tail === "advance" && action === "POST") { await sourceBody(request); json(publicRun(await capture.advance(actor, workspaceId, runId))); }
          else if (tail === "reconcile-restore" && action === "POST") { await sourceBody(request); const resumed = await capture.reconcileRestore(actor, workspaceId, runId); services.dispatch?.(); json(publicRun(resumed)); }
          else if (tail === "cancel" && action === "POST") { await sourceBody(request); json(publicRun(await repository.cancel(actor, workspaceId, runId))); }
          else if (tail === "result" && action === "GET") json(await publication.result(actor, workspaceId, runId));
          else if (tail === "confirm" && action === "POST") json(await publication.confirm(actor, { workspaceId, runId }, await sourceBody(request)));
          else if (tail === "seal" && action === "POST") {
            const input = await sourceBody(request);
            const context = run.status === "SUCCEEDED" ? { workspaceId, runId, generation: run.generation } : (await capture.context(actor, workspaceId, runId)).context;
            const seal = () => publication.seal(actor, context, input);
            try { json(run.status === "SUCCEEDED" ? await seal() : await capture.withHeartbeat(context, seal)); }
            catch (error) {
              // A terminal commit can race the last heartbeat. The bound
              // publication service alone may recover that exact result.
              if (!(error instanceof SourceTruthError) || error.code !== "SOURCE_STALE_WORKER") throw error;
              json(await seal());
            }
          } else {
            const sourceMatch = /^sources\/([^/]+)\/(entries|close|chunks|checkpoint|finish-file|complete-file)$/.exec(tail);
            requireValue(sourceMatch, "SOURCE_ROUTE_NOT_FOUND", "来源操作不存在", { status: 404 });
            const sourceId = decodeURIComponent(sourceMatch[1]), operation = sourceMatch[2];
            const context = { workspaceId, runId, sourceId };
            if (operation === "entries" && action === "GET") json(await repository.withWorkspace(actor, workspaceId, false, (tx) => materials.entries(context, { after: page.cursor, limit: page.limit }, tx)));
            else if (operation === "checkpoint" && action === "GET") json(await upload.checkpoint(actor, context, url.searchParams.get("pathBytes")));
            else if (operation === "entries" && action === "POST") json(await capture.enumerateDirectory(actor, workspaceId, runId, sourceId, await sourceBody(request)));
            else if (operation === "close" && action === "POST") json(await capture.closeDirectory(actor, workspaceId, runId, sourceId, await sourceBody(request)));
            else if (operation === "finish-file" && action === "POST") json(await capture.finishFile(actor, workspaceId, runId, sourceId, (await sourceBody(request)).pathBytes));
            else if (operation === "complete-file" && action === "POST") {
              requireValue(request.headers["content-type"] === "application/octet-stream", "SOURCE_INVALID_CONTENT_TYPE", "完整文件必须为原始字节流", { status: 415 });
              json(await capture.uploadFile(actor, workspaceId, runId, sourceId, url.searchParams.get("pathBytes"), request.iterator({ destroyOnReturn: false })));
            } else if (operation === "chunks" && action === "POST") {
              requireValue(request.headers["content-type"] === "application/octet-stream", "SOURCE_INVALID_CONTENT_TYPE", "文件分片必须为原始字节流", { status: 415 });
              const input = Object.fromEntries(["pathBytes", "offset", "sizeBytes", "digest"].map((key) => [key, url.searchParams.get(key)]));
              requireValue(/^\d+$/.test(input.sizeBytes ?? "") && BigInt(input.sizeBytes) <= BigInt(policy.maxChunkBytes), "SOURCE_FILE_TOO_LARGE", "分片超过平台限制", { status: 413 });
              json(await capture.uploadChunk(actor, workspaceId, runId, sourceId, input, request.iterator({ destroyOnReturn: false })));
            } else throw new SourceTruthError("SOURCE_METHOD_NOT_ALLOWED", "此来源操作不支持该方法", { status: 405 });
          }
        } else throw new SourceTruthError("SOURCE_ROUTE_NOT_FOUND", "来源操作不存在", { status: 404 });
      }
    } catch (error) { request.resume(); sourceFailure(response, error, id); }
    return true;
  };
}
