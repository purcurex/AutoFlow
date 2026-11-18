import test from 'node:test'
import assert from 'node:assert/strict'
import {runQuery} from './fop-workbench-openapi.mjs'
import {scheduledPageQuery} from './workbench-scheduled-sync.mjs'
const config={FOP_OPENAPI_IDENTITY:'test',FOP_OPENAPI_ACCESS_TOKEN:'test'}
const options={operation:'order-list',orgNumber:'hyperzone.test',startModifytime:'2026-11-18 00:00:00',endModifytime:'2026-11-18 01:00:00',pageNo:1,pageSize:100}
test('transport preserves bounded Retry-After seconds and HTTP-date without response text',async()=>{
 for(const value of ['10800',new Date(Date.now()+10800000).toUTCString()]){
  const result=await runQuery(config,options,async()=>new Response('PRIVATE',{status:429,headers:{'Retry-After':value}}))
  assert.ok(result.report.retryAfterMs>=10798000&&result.report.retryAfterMs<=10800000)
  assert.ok(!JSON.stringify(result.report).includes('PRIVATE'))
 }
 for(const value of ['bad','-1','9999999999999']){
  const result=await runQuery(config,options,async()=>new Response('',{status:429,headers:{'Retry-After':value}}))
  assert.equal(result.report.retryAfterMs,value==='9999999999999'?86400000:null)
 }
})
test('native HTTP200 errorCode401/612 refreshes once and never advances past an auth failure',async()=>{
 for(const code of ['401','612']){
  let calls=0,refreshes=0
  const result=await scheduledPageQuery({parameters:options,enabled:()=>true,refreshCredentials:async()=>{refreshes++;return true},
   query:()=>runQuery(config,options,async()=>new Response(JSON.stringify(++calls===1?{status:false,errorCode:code,message:'PRIVATE'}:{status:true,errorCode:'0',data:{rows:[],pageNo:1,pageSize:100,totalCount:0,lastPage:true}})))})
  assert.equal(result.report.success,true);assert.equal(refreshes,1);assert.equal(calls,2)
 }
})
