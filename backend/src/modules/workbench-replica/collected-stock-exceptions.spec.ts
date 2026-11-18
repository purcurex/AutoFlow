import { stockExceptionDisplay, canViewUnassignedStockExceptions } from './collected-stock-exceptions'
const raw={id:'123',org_id:'company',hzkj_orderstatus:'2',hzkj_receipt_status:'',hzkj_receipt_date:null,hzkj_operator_id:'0'}
const row={id:'123',stockNumber:'IO1',items:[{sku:'S',quantity:2}],amount:12,currency:'USD',warehouse:'HangZhou',customerName:'Client',paidAt:null,owner:null}
it('reuses the order display contract without source-customer or Shopify facts',()=>{
 const r=stockExceptionDisplay(row,raw)
 expect(r).toMatchObject({id:'stock:123',sourceDocumentId:'123',documentKind:'stock_order',orderNumber:'IO1',shopifyOrderNumber:'备货订单',shippingRecipient:null,shippingCountryCode:null,warehouse:'HangZhou',customerName:'Client',amount:12,paidAt:null})
 expect(r.exception.reason).toBe('业务员为空；备货收款日期待补齐')
 expect(r.items).toEqual(row.items)
})
it('uses specific, independent reasons and removes resolved issues',()=>{
 expect(stockExceptionDisplay(row,{...raw,hzkj_operator_id:'8'}).exception.reason).toBe('备货收款日期待补齐')
 expect(stockExceptionDisplay(row,{...raw,hzkj_orderstatus:'1'}).exception.reason).toBe('业务员为空')
 expect(stockExceptionDisplay(row,{...raw,hzkj_operator_id:'8',hzkj_receipt_status:'1'}).exception.reason).toBe('备货收款日期待补齐')
 expect(stockExceptionDisplay(row,{id:'123',hzkj_orderstatus:'2'}).exception).toBeNull()
 expect(stockExceptionDisplay(row,{...raw,hzkj_operator_id:'8',hzkj_receipt_date:'2026-11-17 08:00:00'}).exception).toBeNull()
})
it('only grants unassigned diagnostics to full administrators without a narrowed owner or department',()=>{
 const c={user:{role:'admin'},org:{employeeIds:null,marketingScope:{rootId:'marketing'}}}
 expect(canViewUnassignedStockExceptions(c,{})).toBe(true)
 expect(canViewUnassignedStockExceptions(c,{departmentId:'marketing'})).toBe(true)
 for(const q of [{ownerId:'8'},{departmentId:'dept'}])expect(canViewUnassignedStockExceptions(c,q)).toBe(false)
 expect(canViewUnassignedStockExceptions({...c,user:{role:'user'}},{})).toBe(false)
 expect(canViewUnassignedStockExceptions({...c,org:{...c.org,employeeIds:['8']}},{})).toBe(false)
})
