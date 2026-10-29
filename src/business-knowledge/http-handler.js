import { randomUUID } from "node:crypto";
import { identityContext } from "../auth/context.js";
import { AuthError } from "../auth/errors.js";
import { SourceTruthError } from "../source-truth/errors.js";
import { F003Error, requireF003 } from "./errors.js";
import { sourceBody } from "../source-truth/http-io.js";
import { queryBusinessGraph, traceBusinessGraph, businessSevenQuestions } from "./queries.js";

const json = (res, status, payload, requestId, workspaceId) => {
  const body = JSON.stringify({ schemaVersion: 1, workspaceId, requestId, ...payload });
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body),
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId }); res.end(body);
};
function exact(value, keys) {
  requireF003(Object.keys(value).every(k => keys.includes(k)), "F003_INPUT_INVALID", "请求包含未定义字段", { status: 422 }); return value;
}
function query(url, keys) {
  requireF003([...url.searchParams.keys()].every(k => keys.includes(k) && url.searchParams.getAll(k).length === 1), "F003_QUERY_INVALID", "查询包含未定义或重复字段", { status: 422 });
}
function flag(url, key) {
  const value = url.searchParams.get(key);
  requireF003(value === null || value === "true" || value === "false", "F003_QUERY_INVALID", "筛选条件必须为true或false", { status: 422 });
  return value === "true";
}

export function createF003HttpHandler({ services, authenticate, allowedOrigins = [] }) {
  const { investigations, worker, executor, publications, authorityBindings, workSessions, publishedReads } = services;
  if (!investigations || typeof authenticate !== "function") throw new TypeError("F003 requires investigation services and member authentication");
  return async (request, response, requestId = randomUUID()) => {
    const url = new URL(request.url, "http://localhost"), match = /^\/v1\/workspaces\/([^/]+)\/business-knowledge(?:\/(.*))?$/.exec(url.pathname);
    if (!match) return false;
    let workspaceId;
    try {
      requireF003(!request.headers.origin || allowedOrigins.includes(request.headers.origin), "F003_ORIGIN_FORBIDDEN", "该页面来源未获授权", { status: 403 });
      workspaceId = decodeURIComponent(match[1]);
      requireF003(workspaceId.length > 0 && workspaceId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(workspaceId), "F003_INPUT_INVALID", "Workspace定位符无效", { status: 422 });
      const actor = identityContext()?.sourceActor ?? authenticate(request), route = match[2] ?? "", method = request.method;
      const send = (payload, status = 200) => json(response, status, payload, requestId, workspaceId);
      if (method === "GET" && ["", "investigations"].includes(route)) {
        query(url, ["limit"]); send({ investigations: await investigations.list(actor, workspaceId, { limit: Number(url.searchParams.get("limit") ?? 100) }) });
      } else if (method === "GET" && route === "current") {
        query(url, []); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
        send(await publications.current(actor, workspaceId));
      } else if (method === "GET" && route === "versions") {
        query(url, ["limit"]); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
        send({ versions: await publications.versions(actor, workspaceId, { limit: Number(url.searchParams.get("limit") ?? 100) }) });
      } else if (method === 'GET' && /^versions\/[^/]+\/(graph|trace|seven-questions|materials)(?:\/[^/]+)?$/.test(route)) {
        requireF003(publishedReads,'F003_PUBLICATION_UNAVAILABLE','发布读取服务不可用',{status:503});
        const parts=route.split('/'),revisionId=decodeURIComponent(parts[1]),tail=parts[2];
        requireF003(parts.length===3 || (tail==='materials' && parts.length===4),'F003_ROUTE_NOT_FOUND','发布读取不存在',{status:404});
        if(tail==='graph') {
          query(url,['view','key','text','kind','includeUncertain','onlyHumanConfirmed']);
          send({graph:await publishedReads.graph(actor,workspaceId,revisionId,{view:url.searchParams.get('view')??'BUSINESS',
            key:url.searchParams.get('key'),text:url.searchParams.get('text')??'',kind:url.searchParams.get('kind'),
            includeUncertain:flag(url,'includeUncertain'),onlyHumanConfirmed:flag(url,'onlyHumanConfirmed')})});
        } else if(tail==='trace') {
          query(url,['key','materialId']);send({trace:await publishedReads.trace(actor,workspaceId,revisionId,
            {key:url.searchParams.get('key'),materialId:url.searchParams.get('materialId')})});
        } else if(tail==='seven-questions') {
          query(url,['key']);send({answer:await publishedReads.sevenQuestions(actor,workspaceId,revisionId,url.searchParams.get('key'))});
        } else if(parts.length===3) {query(url,[]);send(await publishedReads.materials(actor,workspaceId,revisionId));}
        else {
          query(url,[]);const material=await publishedReads.material(actor,workspaceId,revisionId,decodeURIComponent(parts[3]));
          response.writeHead(200,{'content-type':'application/octet-stream','content-length':material.bytes.length,
            'content-disposition':'attachment','cache-control':'no-store','x-content-type-options':'nosniff','x-request-id':requestId,
            'x-source-material-ref':material.sourceMaterial.id,'x-original-sha256':material.originalDigest,
            'x-graph-revision-id':material.graphRevisionId,'x-graph-digest':material.graphDigest,
            'x-source-bundle-id':material.sourceInput.sourceBundleSnapshotId,'x-source-receipt-id':material.sourceInput.receiptId});
          response.end(material.bytes);
        }
      } else if(method==='GET' && route==='work-sessions') {
        query(url,['limit','cursor','graphRevisionId','originSessionId']);
        send(await workSessions.list(actor,workspaceId,{limit:Number(url.searchParams.get('limit')??50),cursor:url.searchParams.get('cursor'),
          graphRevisionId:url.searchParams.get('graphRevisionId'),originSessionId:url.searchParams.get('originSessionId')}));
      } else if(method==='GET' && /^work-operations\/[^/]+$/.test(route)) {
        query(url,['kind','originSessionId','originGraphRevisionId','expectedRequestDigest']);
        send(await workSessions.operation(actor,workspaceId,decodeURIComponent(route.split('/')[1]),{kind:url.searchParams.get('kind'),
          originSessionId:url.searchParams.get('originSessionId'),originGraphRevisionId:url.searchParams.get('originGraphRevisionId'),
          expectedRequestDigest:url.searchParams.get('expectedRequestDigest')}));
      } else if (method === "POST" && /^versions\/[^/]+\/work-sessions$/.test(route)) {
        query(url,[]); requireF003(workSessions,"F003_WORK_UNAVAILABLE","工作会话不可用",{status:503});
        send(await workSessions.create(actor,workspaceId,decodeURIComponent(route.split('/')[1]),await sourceBody(request,65536)),201);
      } else if (method === "GET" && /^work-sessions\/[^/]+$/.test(route)) {
        query(url,['limit','cursor']); requireF003(workSessions,"F003_WORK_UNAVAILABLE","工作会话不可用",{status:503});
        send(await workSessions.get(actor,workspaceId,decodeURIComponent(route.split('/')[1]),{limit:Number(url.searchParams.get('limit')??50),cursor:url.searchParams.get('cursor')}));
      } else if(method === 'GET' && /^work-sessions\/[^/]+\/events$/.test(route)) {
        query(url,['afterVersion','limit']);send(await workSessions.events(actor,workspaceId,decodeURIComponent(route.split('/')[1]),
          {afterVersion:Number(url.searchParams.get('afterVersion')??0),limit:Number(url.searchParams.get('limit')??50)}));
      } else if (method === "POST" && /^work-sessions\/[^/]+\/questions$/.test(route)) {
        query(url,[]); const result=await workSessions.ask(actor,workspaceId,decodeURIComponent(route.split('/')[1]),await sourceBody(request,65536));
        if(!result.replayed) executor.enqueue(result.run);
        send(result,201);
      } else if (method === "GET" && /^work-sessions\/[^/]+\/questions\/[^/]+$/.test(route)) {
        query(url,[]); const parts=route.split('/');
        send(await workSessions.question(actor,workspaceId,decodeURIComponent(parts[1]),decodeURIComponent(parts[3])));
      } else if(method === 'POST' && /^work-sessions\/[^/]+\/questions\/[^/]+\/(cancel|pause|resume)$/.test(route)) {
        query(url,[]);const parts=route.split('/'), result=await workSessions.control(actor,workspaceId,decodeURIComponent(parts[1]),
          decodeURIComponent(parts[3]),parts[4].toUpperCase(),await sourceBody(request,65536));
        if(parts[4]==='resume') executor.enqueue(result.run); else worker.stop(workspaceId,result.run.id);
        send(result);
      } else if(method === 'POST' && /^work-sessions\/[^/]+\/(feedback|continuation-preview|continue|adopt-graph)$/.test(route)) {
        query(url,[]); const parts=route.split('/'), sessionId=decodeURIComponent(parts[1]), input=await sourceBody(request,65536);
        const operation={feedback:'feedback','continuation-preview':'continuationPreview',continue:'continue','adopt-graph':'adoptGraph'}[parts[2]];
        const result=await workSessions[operation](actor,workspaceId,sessionId,input);
        if(operation==='continue' && !result.replayed) executor.enqueue(result.run);
        send(result,operation==='continuationPreview'?200:201);
      } else if (/^versions\/[^/]+\/authority-bindings$/.test(route)) {
        requireF003(authorityBindings, "F003_AUTHORITY_UNAVAILABLE", "图谱权威映射服务不可用", { status: 503 });
        const revisionId = decodeURIComponent(route.split("/")[1]);
        if (method === "POST") {
          query(url, []); send(await authorityBindings.bind(actor, workspaceId, revisionId, await sourceBody(request, 65536)), 201);
        } else if (method === "GET") {
          query(url, ["objectKey", "bindingVersion"]); send(await authorityBindings.project(actor, workspaceId, revisionId, url.searchParams.get("objectKey"), {
            bindingVersion: url.searchParams.has("bindingVersion") ? Number(url.searchParams.get("bindingVersion")) : null }));
        } else throw new F003Error("F003_ROUTE_NOT_FOUND", "业务知识操作不存在", { status: 404 });
      } else if (method === "GET" && /^versions\/[^/]+$/.test(route)) {
        query(url, []); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
        send(await publications.version(actor, workspaceId, decodeURIComponent(route.slice(9))));
      } else if (method === "POST" && route === "investigations") {
        query(url, []);
        const investigation = await investigations.start(actor, workspaceId, await sourceBody(request, 65536));
        executor?.enqueue(investigation); send({ investigation }, 202);
      } else {
        const selected = /^investigations\/([^/]+)(?:\/(.*))?$/.exec(route);
        requireF003(selected, "F003_ROUTE_NOT_FOUND", "业务知识操作不存在", { status: 404 });
        const id = decodeURIComponent(selected[1]), tail = selected[2] ?? "";
        if (method === "GET" && tail === "") { query(url, []); send({ investigation: await investigations.get(actor, workspaceId, id) }); }
        else if (method === "GET" && tail === "publication-readiness") {
          query(url, []); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
          send({ readiness: await publications.readiness(actor, workspaceId, id) });
        } else if (method === "POST" && tail === "import-publication-evidence") {
          query(url, []); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
          exact(await sourceBody(request, 65536), []);
          send(await publications.importEvidence(actor, workspaceId, id));
        } else if (method === "POST" && tail === "publish") {
          query(url, []); requireF003(publications, "F003_PUBLICATION_UNAVAILABLE", "发布服务未配置", { status: 503 });
          const input = exact(await sourceBody(request, 65536), ["operationId", "expectedGraphDigest", "expectedHeadVersion"]);
          send(await publications.publish(actor, workspaceId, id, input));
        }
        else if (method === "GET" && tail === "events") { query(url, []); send({ events: await investigations.events(actor, workspaceId, id) }); }
        else if (method === "GET" && tail === "graph") {
          query(url, ["view", "key", "text", "kind", "includeUncertain", "onlyHumanConfirmed"]);
          const options = { view: url.searchParams.get("view") ?? "BUSINESS", key: url.searchParams.get("key"), text: url.searchParams.get("text") ?? "", kind: url.searchParams.get("kind"),
            includeUncertain: flag(url, "includeUncertain"), onlyHumanConfirmed: flag(url, "onlyHumanConfirmed") };
          send({ graph: queryBusinessGraph(await investigations.graph(actor, workspaceId, id), options) });
        } else if (method === "GET" && tail === "task-evidence") {
          query(url, ["expectedRevision", "expectedGraphDigest"]);
          const revision = url.searchParams.get("expectedRevision"), graphDigest = url.searchParams.get("expectedGraphDigest");
          requireF003(/^[1-9][0-9]*$/.test(revision ?? "") && graphDigest !== null,
            "F003_INPUT_INVALID", "请明确任务证据的调查修订和图谱坐标", { status: 422 });
          send({ taskEvidence: await investigations.taskEvidence(actor, workspaceId, id,
            { expectedRevision: Number(revision), expectedGraphDigest: graphDigest === "" ? null : graphDigest }) });
        } else if (method === "GET" && tail === "trace") {
          query(url, ["key", "materialId"]); send({ trace: traceBusinessGraph(await investigations.graph(actor, workspaceId, id), { key: url.searchParams.get("key"), materialId: url.searchParams.get("materialId") }) });
        } else if (method === "GET" && tail === "seven-questions") {
          query(url, ["key"]); send({ answer: businessSevenQuestions(await investigations.graph(actor, workspaceId, id), url.searchParams.get("key")) });
        } else if (method === "GET" && /^materials\/[^/]+$/.test(tail)) {
          query(url, []); const material = await investigations.evidenceMaterial(actor, workspaceId, id, decodeURIComponent(tail.slice(10)));
          response.writeHead(200, { "content-type": "application/octet-stream", "content-length": material.bytes.length, "content-disposition": "attachment",
            "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId, "x-source-material-ref": material.sourceMaterial.id }); response.end(material.bytes);
        } else if (method === "POST" && ["pause", "resume", "cancel"].includes(tail)) {
          query(url, []); const input = exact(await sourceBody(request, 65536), ["expectedRevision"]);
          const investigation = await investigations.control(actor, workspaceId, id, { action: tail.toUpperCase(), expectedRevision: input.expectedRevision });
          if (tail === "resume") executor?.enqueue(investigation); else worker?.stop(workspaceId, id);
          send({ investigation });
        } else if (method === "POST" && tail === "adopt-technical-version") {
          query(url, []); const input = exact(await sourceBody(request, 65536), ["requestId", "versionId", "expectedRevision"]);
          const investigation = await investigations.adoptTechnicalVersion(actor, workspaceId, id, input);
          worker?.stop(workspaceId, id); executor?.enqueue(investigation); send({ investigation });
        } else throw new F003Error("F003_ROUTE_NOT_FOUND", "业务知识操作不存在", { status: 404 });
      }
    } catch (error) {
      request.resume();
      if (response.headersSent) response.destroy();
      else {
        const known = error instanceof F003Error || error instanceof SourceTruthError || error instanceof AuthError;
        json(response, known ? error.status : 500, { error: { code: known ? error.code : "F003_INTERNAL_ERROR", message: known ? error.message : "业务知识服务暂时不可用",
          ...(error.code === "F003_SESSION_WRITE_BLOCKED" ? { details:{missing:error.details?.missing ?? []} } : {}) } }, requestId, workspaceId);
      }
    }
    return true;
  };
}
