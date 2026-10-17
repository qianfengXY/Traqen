import assert from 'node:assert/strict';
import test from 'node:test';
import { renderComponent } from './support/render-components.mjs';
const { Applications } = await import('../app/access-applications.tsx');
const item = {id:'EXACT-APPLICATION',kind:'JOIN',workspaceId:'W1',accountId:'OTHER',canDecide:true,requestedRoles:['READ'],reason:'Exact linked request',status:'PENDING',createdAt:1,version:1};
const props = {items:[item],applicationId:item.id,context:{spaces:[],reviewRoles:[],canAdmin:true},pending:true,run:async()=>{},refresh:async()=>{},busy:false,accountId:'ADMIN'};
test('an application link opens the exact pending detail and a processed link shows its final outcome',()=>{
 assert.match(renderComponent(Applications,props), /<h2>处理申请<\/h2>/);
 const final=renderComponent(Applications,{...props,items:[{...item,status:'REJECTED',decisionReason:'Already handled by another manager'}]});
 assert.match(final, /Already handled by another manager/);assert.doesNotMatch(final,/批准所选角色/);
});
test('an applicant can read its linked record without being offered manager approval',()=>{
 const html=renderComponent(Applications,{...props,items:[{...item,accountId:'ADMIN',canDecide:false}]});
 assert.doesNotMatch(html,/批准所选角色/);assert.match(html,/申请详情/);
});
