import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import { timestampCapability } from './build-fop-timestamp-capabilities.mjs'
test('maps public request name through objpropname without inventing creation windows',()=>{
 const result=timestampCapability({number:'queryOrderList',bodyentryentity:[{paramname:'start_modifytime',objpropname:'modifytime'}],filter_entity:[{filter_column:'modifytime',filter_compare:'GREATEROREQUAL',filter_value:'modifytime'}],response:[{respparamname:'createtime',respobjpropname:'createtime'}]})
 assert.equal(result.timeFilters[0].requestParameter,'start_modifytime')
 assert.equal(result.creationWindowCaptureInTimestampEngine,false);assert.equal(result.creationRangeFilterAvailable,false);assert.equal(result.keyset,false);assert.equal(result.sourceClock,false)
})
test('the checked-in 26 API capability contract enables only four documented modified windows',()=>{
 const contract=JSON.parse(readFileSync(new URL('../docs/openapi/fop-query-timestamp-capabilities.json',import.meta.url)))
 assert.equal(contract.apis.length,26)
 assert.deepEqual(contract.apis.filter(x=>x.ordinaryModifiedCapture).map(x=>x.api),['queryAllocation','queryDeliveryNotice','queryDispatch','queryOrderList'])
 for(const api of contract.apis.filter(x=>x.ordinaryModifiedCapture)){
  assert.deepEqual(api.ordering,[{field:'modifytime',direction:'asc'},{field:'id',direction:'asc'}])
  assert.ok(api.timeFilters.some(x=>x.requestParameter==='start_modifytime'&&x.comparison==='GREATEROREQUAL'))
  assert.ok(api.timeFilters.some(x=>x.requestParameter==='end_modifytime'&&x.comparison==='LESS'))
 }
 assert.equal(contract.capture.failureAdvancesWatermark,false);assert.equal(contract.capture.missingRowsAreDeletions,false)
})
