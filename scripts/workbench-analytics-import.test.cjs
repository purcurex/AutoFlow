const test=require('node:test'),assert=require('node:assert/strict'),{associate}=require('./workbench-analytics-import.cjs')
test('owner association requires exact parent and same customer; ambiguous owner remains unknown',()=>{
 const parent={source_id:'1',order_number:'TO1',owner_employee_id:'owner1',customer_id:'c1'},byId=new Map([['1',parent]]),byNo=new Map([['TO1',parent]])
 const row=()=>({entity_type:'dispatch',source_id:'9',customer_id:'c1',raw:{hzkj_order_no:'TO1'},facts:{}})
 assert.equal(associate(row(),byId,byNo,new Map()).owner_employee_id,'owner1')
 assert.equal(associate({...row(),customer_id:'other'},byId,byNo,new Map()).owner_employee_id,null)
 assert.equal(associate(row(),byId,new Map([['TO1',null]]),new Map()).owner_employee_id,null)
 const multi={entity_type:'purchase',raw:{hzkj_billentry:[{hzkj_salbillnumber:'TO1'},{hzkj_salbillnumber:'TO2'}]},facts:{}}
 assert.equal(associate(multi,byId,new Map([...byNo,['TO2',{...parent,source_id:'2',owner_employee_id:'owner2'}]]),new Map()).owner_employee_id,null)
})
test('a newly captured order uses only an already verified stable employee ID',()=>{
 const row=()=>({entity_type:'fulfillment',source_id:'2',document_number:'TO2',raw:{hzkj_operator_id:'master'},facts:{}})
 assert.equal(associate(row(),new Map(),new Map(),new Map()).owner_employee_id,null)
 assert.equal(associate(row(),new Map(),new Map(),new Map(),new Set(['master'])).owner_employee_id,'master')
 const existing=new Map([['2',{order_number:'DIFFERENT',owner_employee_id:'master'}]])
 assert.equal(associate(row(),existing,new Map(),new Map(),new Set(['master'])).owner_employee_id,null)
})
test('native dispatch ownership overrides a conflicting parent and never falls back for blank/unverified owner',()=>{
 const parents=new Map([['TO1',{source_id:'1',owner_employee_id:'parent',customer_id:'customer'}]])
 const row=owner=>({entity_type:'dispatch',customer_id:'customer',raw:{hzkj_order_no:'TO1',hzkj_bizoperator_id:owner},facts:{businessEligible:true}})
 const verified=associate(row('native'),new Map(),parents,new Map(),new Set(['native','parent']))
 assert.equal(verified.owner_employee_id,'native');assert.equal(verified.facts.effective,true)
 for(const owner of ['',null,'unverified']){const actual=associate(row(owner),new Map(),parents,new Map(),new Set(['parent']));assert.equal(actual.owner_employee_id,null);assert.equal(actual.facts.effective,false)}
})
