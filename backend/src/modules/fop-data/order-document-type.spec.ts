import { orderDocumentType } from './order-document-type'
import { withOrderBusinessStatus } from './order-business-status'
import { normalizeCollectedOrder } from './collected-order-normalizer'
it('preserves native sample type through ingestion and already-collected read projection',()=>{
 const raw={id:'1',billno:'TO1',hzkj_org:{id:'100'},hzkj_billtype:{number:'hzkj_orders_BT_Sample',name:{zh_CN:'样品订单'}},hzkj_orders_billentry:[]}
 const expected={orderTypeCode:'hzkj_orders_BT_Sample',orderTypeName:'样品订单'}
 expect(normalizeCollectedOrder(raw,{companyId:'100'}).display).toMatchObject(expected)
 expect(withOrderBusinessStatus({id:'1',items:[]},raw,'100',{persistedExceptions:true})).toMatchObject(expected)
})
it('keeps absent, changed and unknown native types without guessing from amount or number',()=>{
 expect(orderDocumentType({billno:'SAMPLE',hzkj_total_amount:0})).toEqual({orderTypeCode:null,orderTypeName:null})
 expect(orderDocumentType({hzkj_billtype_number:'future',hzkj_billtype_name:'未来类型'})).toEqual({orderTypeCode:'future',orderTypeName:'未来类型'})
 expect(withOrderBusinessStatus({id:'1',items:[],orderTypeCode:'hzkj_orders_BT_Sample'},{id:'1',hzkj_billtype:{number:'hzkj_orders_BT'}},'100',{persistedExceptions:true}).orderTypeCode).toBe('hzkj_orders_BT')
})
