import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceTruthClient } from '../app/source-truth/client.ts';
import { setSessionProof } from '../app/auth-client.ts';
test('source snapshots consume the same cookie session and antiforgery proof as the main app',async t=>{
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;setSessionProof('');});let request;
 globalThis.fetch=async(_url,init)=>{request=init;return Response.json({ok:true});};
 setSessionProof('same-proof');await new SourceTruthClient('/api','', 'W1').request('/draft','PUT',{});
 assert.equal(request.credentials,'same-origin');assert.equal(new Headers(request.headers).get('x-traqen-csrf'),'same-proof');
 assert.equal(new Headers(request.headers).has('authorization'),false);
});
