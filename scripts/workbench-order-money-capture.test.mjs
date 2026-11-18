import {test} from 'node:test';import assert from 'node:assert/strict';import {validateMoneyDetail} from './workbench-order-money-capture.mjs'
const parent={source_id:'1',order_number:'TO1',owner_employee_id:'2'}
const body=(patch={})=>({status:true,errorCode:'0',data:{filter:'[org in (100000)]',totalCount:1,rows:[{id:'1',billno:'TO1',hzkj_operator_id:'2',hzkj_order_amount:0,...patch}]}})
test('keeps zero and records missing fields, not invented totals',()=>{const c=validateMoneyDetail(body(),parent,'100000');assert.equal(c.values.hzkj_order_amount,0);assert.equal(c.complete,false);assert(c.missingFields.includes('hzkj_total_amount'))})
test('requires exact identity, company and valid amounts',()=>{assert.throws(()=>validateMoneyDetail(body({id:'3'}),parent,'100000'));assert.throws(()=>validateMoneyDetail(body(),parent,'9'));assert.throws(()=>validateMoneyDetail(body({hzkj_total_amount:'bad'}),parent,'100000'))})

test('captures fixed header tax and does not require package tax for complete monetary data',()=>{const c=validateMoneyDetail(body({hzkj_total_amount:12,hzkj_fre_quo_amount:2,hzkj_fixed_tax_fee:0,hzkj_discount_cost:0}),parent,'100000');assert.equal(c.complete,true);assert.equal(c.values.hzkj_fixed_tax_fee,0);assert(!c.missingFields.includes('hzkj_logistics_info'))})
test('does not substitute package tax for omitted or null fixed tax',()=>{for(const patch of [{},{hzkj_fixed_tax_fee:null}]){const c=validateMoneyDetail(body({hzkj_total_amount:12,hzkj_fre_quo_amount:2,hzkj_discount_cost:0,hzkj_logistics_info:[{id:'p1',hzkj_package_tax_fee:9}],...patch}),parent,'100000');assert.equal(c.complete,false);assert.equal(c.values.hzkj_fixed_tax_fee,patch.hzkj_fixed_tax_fee)}})

test('accepts missing package rows and signed discount without losing known total',()=>{const c=validateMoneyDetail(body({hzkj_total_amount:9.04,hzkj_discount_cost:-1.72,hzkj_logistics_info:null}),parent,'100000');assert.equal(c.values.hzkj_total_amount,9.04);assert.equal(c.values.hzkj_discount_cost,-1.72);assert.equal(c.complete,false)})

test('retains the real queryOrderList package channel alias during import',()=>{
 const capture=validateMoneyDetail(body({hzkj_logistics_info:[{hzkj_combofield:'1',hzkj_channel_name:'万邦快线含电'}]}),parent,'100000')
 assert.equal(capture.values.hzkj_logistics_info[0].hzkj_channel_name,'万邦快线含电')
})

test('retains package tracking as a string paired with its channel and rejects numeric loss',()=>{
 const packages=[{hzkj_combofield:'1',hzkj_channel_name:'渠道甲',hzkj_tracking_number:'000123'},{hzkj_combofield:'2',hzkj_channel_name:'渠道乙',hzkj_tracking_number:null}]
 assert.deepEqual(validateMoneyDetail(body({hzkj_logistics_info:packages}),parent,'100000').values.hzkj_logistics_info,packages)
 assert.throws(()=>validateMoneyDetail(body({hzkj_logistics_info:[{hzkj_tracking_number:123}]}),parent,'100000'),/invalid_package_tracking_number/)
})
