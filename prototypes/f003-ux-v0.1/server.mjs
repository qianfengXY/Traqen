import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png'};
const publicFiles=new Set(['index.html','styles.css','app.mjs','model.mjs']);
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try {
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
    if(!publicFiles.has(name)){res.writeHead(404);res.end('Not found');return;}
    const file=await realpath(resolve(root,name));
    if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end();return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"});
    res.end(req.method==='HEAD'?undefined:content);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(4317,'127.0.0.1',()=>process.stdout.write('F003 UX exploration: http://localhost:4317\n'));
