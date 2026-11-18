import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateMaterialReturnPage} from './material-return-page.mjs'
const page=(n,rows,last,total=2)=>({filter:'[org in (100000) AND 1 = 1]',pageNo:n,pageSize:1,rows:rows.map(billno=>({billno})),lastPage:last,totalCount:total})
test('verifies number-only pagination without manufacturing source IDs',()=>{const seen=new Set();const total=validateMaterialReturnPage(page(1,['R1'],false),1,1,undefined,seen);assert.equal(validateMaterialReturnPage(page(2,['R2'],true),2,1,total,seen),2);assert.equal(seen.size,2)})
test('rejects repeated rows, changing totals, missing final rows and wrong companies',()=>{assert.throws(()=>validateMaterialReturnPage(page(2,['R1'],true),2,1,2,new Set(['R1'])));assert.throws(()=>validateMaterialReturnPage(page(1,['R1'],true),1,1,undefined,new Set()));assert.throws(()=>validateMaterialReturnPage(page(1,['R1'],false),1,1,3,new Set()));assert.throws(()=>validateMaterialReturnPage({...page(1,['R1'],true,1),filter:'[org in (200000)]'},1,1,undefined,new Set()))})
