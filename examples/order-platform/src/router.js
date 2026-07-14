import { createServer } from "node:http";

function routePattern(path) {
  const names = [];
  const expression = path.split("/").map((segment) => {
    const parameter = segment.startsWith(":")
      ? segment.slice(1)
      : segment.startsWith("{") && segment.endsWith("}")
        ? segment.slice(1, -1)
        : null;
    if (!parameter) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names.push(parameter);
    return "([^/]+)";
  }).join("/");
  return { names, expression: new RegExp(`^${expression}$`) };
}

async function jsonBody(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { statusCode: 400 });
  }
}

export function createRouter() {
  const routes = [];
  const app = {
    post(path, handler) {
      routes.push({ method: "POST", path, ...routePattern(path), handler });
      return app;
    },
    listen(port = 0, host = "127.0.0.1") {
      const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        const route = routes.find((candidate) =>
          candidate.method === request.method && candidate.expression.test(url.pathname));
        if (!route) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "NOT_FOUND" }));
          return;
        }
        const match = route.expression.exec(url.pathname);
        const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
        try {
          const result = await route.handler({ request, params, body: await jsonBody(request) });
          response.writeHead(result.status ?? 200, { "content-type": "application/json" });
          response.end(JSON.stringify(result.body ?? {}));
        } catch (error) {
          response.writeHead(error.statusCode ?? 500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: error.code ?? "INTERNAL_ERROR", message: error.message }));
        }
      });
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server));
      });
    },
  };
  return app;
}
