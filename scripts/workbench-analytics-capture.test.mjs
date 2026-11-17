import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateAnalyticsPage, captureFamily } from './workbench-analytics-capture.mjs'
const page = overrides => ({ filter: "[org in (100000) AND org.number = 'hyperzone.test']", pageNo: 1, pageSize: 100, totalCount: 1, rows: [{ id: '1', org_id: '100000' }], lastPage: true, ...overrides })
test('uses one explicit full modification window across pages for changed APIs',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'analytics-window-')),requests=[]
 try{
  const m=await captureFamily({entity:'fulfillment',directory:dir,context:{tenantId:'test'},query:async q=>{
   requests.push(q);return {report:{success:true},raw:JSON.stringify({data:page({pageNo:q.pageNo,totalCount:2,rows:[{id:String(q.pageNo),org_id:'100000'}],lastPage:q.pageNo===2})})}
  }})
  assert.equal(m.complete,true);assert.equal(requests[0].startModifytime,'1970-01-01 00:00:00')
  assert.match(requests[0].endModifytime,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(requests[0].endModifytime,requests[1].endModifytime)
  assert.equal(m.modificationWindow.toExclusive,requests[0].endModifytime)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('requires company proof, stable total, exact terminal coverage and unique IDs', () => {
  assert.equal(validateAnalyticsPage(page(), 1, 100, undefined, new Set()), 1)
  for (const bad of [{ filter: 'org.number=other' }, { rows: [{ id: '1', org_id: '2' }] }, { totalCount: 2 }, { rows: [{ id: 1 }] }, { lastPage: false }, { rows: [{ id: '1' }, { id: '1' }], totalCount: 2 }]) assert.throws(() => validateAnalyticsPage(page(bad), 1, 100, undefined, new Set()))
  assert.throws(() => validateAnalyticsPage(page(), 1, 100, 2, new Set()))
})
test('records failed family without activating or losing page evidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-capture-'))
  try {
    let calls = 0
    const m = await captureFamily({ entity: 'receipt', directory: dir, context: { tenantId: 'test' }, query: async () => ++calls === 1 ? { report: { success: true }, raw: JSON.stringify({ data: page({ totalCount: 2, lastPage: false }) }) } : { report: { success: false } } })
    assert.equal(m.complete, false); assert.equal(m.rowCount, 1); assert.equal(m.error, 'source_query_failed'); assert.equal(m.pages.length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
