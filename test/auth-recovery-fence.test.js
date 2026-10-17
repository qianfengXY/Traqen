import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {authenticationRestoreFenceSql} from '../src/auth/recovery-fence.js';

test('an archive predating identity tables restores into a closed gate that the identity migration cannot reopen',async t=>{
 const db=await PGlite.create();t.after(()=>db.close());
 await db.exec("CREATE TABLE project(id text PRIMARY KEY,tenant_id text);CREATE TABLE source_truth_access(workspace_id text,actor_id text,role text,revision integer);");
 await db.exec(authenticationRestoreFenceSql);
 let state=(await db.query('SELECT * FROM auth_control')).rows[0];assert.equal(state.initialized,true);assert.equal(state.recovery,true);
 await db.exec(await readFile(new URL('../db/migrations/0039_f008_identity.sql',import.meta.url),'utf8'));
 state=(await db.query('SELECT * FROM auth_control')).rows[0];assert.equal(state.initialized,true);assert.equal(state.recovery,true);
 await db.query("INSERT INTO auth_record(kind,id,payload)VALUES('credentials','old',$1),('accounts','admin',$2)",[JSON.stringify({used:false}),JSON.stringify({recoveryAdmin:true})]);const epoch=Number(state.epoch);
 await db.exec(authenticationRestoreFenceSql);state=(await db.query('SELECT * FROM auth_control')).rows[0];assert.equal(Number(state.epoch),epoch+1);
 const records=(await db.query('SELECT * FROM auth_record ORDER BY kind')).rows;assert.equal(records[0].payload.recoveryAdmin,undefined);assert.equal(records[1].payload.used,true);
});
