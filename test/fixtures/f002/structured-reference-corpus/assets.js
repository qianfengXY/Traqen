import test from 'node:test';
import assert from 'node:assert/strict';
function subject(){return 7;}
test('reads😀',()=>{assert.strictEqual(subject(),7);});
function notATest(test){test('fake',()=>{});}
