import test from 'node:test'
import assert from 'node:assert/strict'
import {runQuery} from './fop-workbench-openapi.mjs'
import {scheduledPageQuery} from './workbench-scheduled-sync.mjs'
const config={FOP_OPENAPI_IDENTITY:'test',FOP_OPENAPI_ACCESS_TOKEN:'test'}
const options={operation:'order-list',orgNumber:'hyperzone.test',ids:['1'],pageNo:1,pageSize:100}
test('transport preserves bounded Retry-After seconds and HTTP-date without response text',async()=>{
 for(const value of ['10800',new Date(Date.now()+10800000).toUTCString()]){
  const result=await runQuery(config,options,async()=>new Response('PRIVATE',{status:429,headers:{'Retry-After':value}}))
  assert.ok(result.report.retryAfterMs>=10798000&&result.report.retryAfterMs<=10800000)
  assert.ok(!JSON.stringify(result.report).includes('PRIVATE'))
 }
 for(const value of ['bad','-1','9999999999999']){
  const result=await runQuery(config,options,async()=>new Response('',{status:429,headers:{'Retry-After':value}}))
  assert.equal(result.report.retryAfterMs,null)
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

test('multi-day source cooldown is never shortened to one day',async()=>{const r=await runQuery(config,options,async()=>new Response('',{status:429,headers:{'Retry-After':'259200'}}));assert.equal(r.report.retryAfterMs,259200000)})

test('OAuth quota rejection stops the schedule without classifying it as expired credentials',async()=>{
 const credentials={FOP_OPENAPI_IDENTITY:'test',FOP_OPENAPI_CLIENT_ID:'test',FOP_OPENAPI_CLIENT_SECRET:'test',FOP_OPENAPI_USERNAME:'test',FOP_OPENAPI_ACCOUNT_ID:'test'}
 let calls=0,refreshes=0
 await assert.rejects(scheduledPageQuery({parameters:options,enabled:()=>true,refreshCredentials:async()=>{refreshes++;return true},query:()=>runQuery(credentials,options,async()=>{
  calls++;return new Response(JSON.stringify({status:false,errorCode:'2528'}),{status:429,headers:{'Retry-After':'259200'}})
 })}),e=>e.message==='timestamp_source_rate_limited'&&e.retryAfterMs===259200000)
 assert.equal(calls,1);assert.equal(refreshes,0)
})
