import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const capture = await import('./workbench-purchase-return-capture.mjs').catch(e => {if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
const response=(pageNo,rows,totalCount,lastPage)=>({report:{success:true},raw:JSON.stringify({status:true,errorCode:'0',data:{filter:"org in (100000) and org.number = 'hyperzone.test'",pageNo,pageSize:100,totalCount,lastPage,rows}})})
test('captures refund candidates without classifying them as physical return facts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-refund-'))
 try{
  let calls=0
  const m=await capture.capturePurchaseRefundCandidates({directory:dir,context:{tenantId:'test',userId:'test'},query:async q=>{calls++;assert.equal(q.operation,'purchase-return');return q.pageNo===1?response(1,[{id:'1',billno:'PO1',hzkj_pay_status:'3'}],2,false):response(2,[{id:'2',billno:'PO2',hzkj_pay_status:'4'}],2,true)}})
  assert.equal(calls,2);assert.equal(m.complete,true);assert.equal(m.rowCount,2);assert.equal(m.physicalReturnIntegration,false);assert.equal(m.semanticType,'purchase_refund_candidates');assert.equal(m.pages.length,2)
  const facts=JSON.parse(fs.readFileSync(path.join(dir,m.normalized.file),'utf8'))
  assert.equal(facts.physicalReturnIntegration,false);assert.equal(facts.items.length,2);assert.equal(facts.items[1].semanticType,'purchase_refund_candidate');assert.equal(facts.items[1].currency,null)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('fails closed on unexpected status, retaining an incomplete receipt instead of inventing returns',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-refund-'))
 try{
  const m=await capture.capturePurchaseRefundCandidates({directory:dir,context:{},query:async()=>response(1,[{id:'1',hzkj_pay_status:'1'}],1,true)})
  assert.equal(m.complete,false);assert.equal(m.error,'unexpected_refund_status');assert.equal(m.physicalReturnIntegration,false)
  assert.equal(fs.existsSync(path.join(dir,'refund-candidates.json')),false)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
