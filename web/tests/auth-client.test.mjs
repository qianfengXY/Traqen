import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionFetch, setSessionProof, setReviewRole } from '../app/auth-client.ts';

test('all browser consumers share cookies and CSRF without sending a reusable bearer token',async t=>{
 const old=globalThis.fetch; t.after(()=>{globalThis.fetch=old;setSessionProof('');setReviewRole('');});
 const requests=[];globalThis.fetch=async(url,init)=>{requests.push({url,init});return Response.json({ok:true});};
 setSessionProof('signed-session-proof');setReviewRole('business-owner');
 await sessionFetch('/api/v1/workspaces/W1/source-truth',{method:'POST',body:'{}'});
 const {init}=requests[0];assert.equal(init.credentials,'same-origin');
 assert.equal(new Headers(init.headers).get('x-traqen-csrf'),'signed-session-proof');
 assert.equal(new Headers(init.headers).get('x-traqen-review-role'),'business-owner');
 assert.equal(new Headers(init.headers).has('authorization'),false);
});

test('a failed mutation is never automatically replayed',async t=>{
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});let count=0;
 globalThis.fetch=async()=>{count++;return Response.json({error:{code:'AUTH_SESSION_EXPIRED'}},{status:401});};
 assert.equal((await sessionFetch('/api/v1/access/applications',{method:'POST',body:'{}'})).status,401);
 assert.equal(count,1);
});
