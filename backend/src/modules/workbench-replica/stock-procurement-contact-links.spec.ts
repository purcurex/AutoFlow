import { stockProcurementContactLinks } from './stock-procurement-contact-links'
const batch={id:'b',company_id:'100000'},order={id:'o1',billno:'TO1'}
const parent={id:'s1',billno:'IO1',org_id:'100000',hzkj_stock_type:'1',hzkj_orders_billentry:[{id:'sl1',seq:1,hzkj_local_sku_id:'sku1'},{id:'sl2',seq:2,hzkj_local_sku_id:'sku2'}]}
const purchase={id:'p1',billno:'CG1',hzkj_cancelstatus:'A',hzkj_1688_order_n:'5127549338101022434',hzkj_billentry:[{hzkj_salbillnumber:'IO1',hzkj_salbillentryid:'sl1',hzkj_salbillentryseq:'1'}]}
const record={stockId:'s1',stockNumber:'IO1',stockType:'1',stockPurchaseStatus:'2',orderNumber:'TO1',skuId:'sku1',recordId:'r1',quantity:'1',status:'1'}
const source={skuId:'sku1',sku:'SKU1',fullPaymentQuantity:'1',depositQuantity:'0',records:[record]}
const setup=(stocks:any[]=[parent],purchases:any[]=[purchase])=>({query:jest.fn(async(sql:string,params?:any[])=>{
 expect(params).toEqual(['b','100000',['IO1']]);return (sql.includes('analytics_facts')?stocks:purchases).map(raw=>({raw}))
})})
it('loads exact local stock/SKU purchases using only the authorized root, retaining 1688 identity',async()=>{
 const db=setup(),result=await stockProcurementContactLinks(db,batch,order,[{procurementSource:source}])
 expect(db.query).toHaveBeenCalledTimes(2);expect(result[0].purchase).toEqual({id:'p1',number:'CG1',platformOrderNumber:'5127549338101022434'})
 expect(result[0].references[0]).toMatchObject({sourceType:'full_payment',parent,skuId:'sku1',consumption:{recordId:'r1'}})
})
it.each([{stockPurchaseStatus:'3'},{stockPurchaseStatus:'4'},{quantity:'0'},{status:'unknown'},{orderNumber:'TO-other'},{skuId:'sku-other'}])('excludes non-pending or unrelated consumption %j without queries',async patch=>{
 const db=setup();expect(await stockProcurementContactLinks(db,batch,order,[{procurementSource:{...source,records:[{...record,...patch}]}}])).toEqual([]);expect(db.query).not.toHaveBeenCalled()
})
it.each([
 {stocks:[],purchases:[purchase]}, {stocks:[parent,{...parent,id:'s-other'}],purchases:[purchase]},
 {stocks:[{...parent,org_id:'200000'}],purchases:[purchase]},
 {stocks:[parent],purchases:[{...purchase,org:{id:'200000'}}]},
 {stocks:[parent],purchases:[{...purchase,hzkj_cancelstatus:'B'}]},
 {stocks:[parent],purchases:[{...purchase,hzkj_billentry:[{hzkj_salbillnumber:'IO1',hzkj_salbillentryid:'sl2',hzkj_salbillentryseq:'2'}]}]},
])('does not substitute another stock, company, cancelled PO or SKU',async ({stocks,purchases})=>{
 await expect(stockProcurementContactLinks(setup(stocks,purchases),batch,order,[{procurementSource:source}])).rejects.toThrow()
})
