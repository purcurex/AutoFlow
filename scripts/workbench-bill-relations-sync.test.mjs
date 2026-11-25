import test from 'node:test'
import assert from 'node:assert/strict'
import {relationQueryParameters} from './workbench-automatic-relations.mjs'
import {buildRequest} from './fop-workbench-openapi.mjs'
test('manual and automatic queue use authorized root query contracts',()=>{
 const requests=[{root_kind:'fulfillment',root_number:'TO1'},{root_kind:'stock',root_number:'IO2'}].map(t=>{const{operation,saveResponse,...p}=relationQueryParameters(t);return buildRequest(operation,p).body});assert.deepEqual(requests,[{orderNo:'TO1',level:'BILL'},{stockOrderNo:'IO2',level:'BILL'}])
})
