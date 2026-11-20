import { readOrderProgress, progressConclusions, progressHeader, purchaseApplicationEdges } from './order-progress'
import { readCollectedChain } from './collected-chain-query'
jest.mock('./collected-chain-query',()=>({readCollectedChain:jest.fn()}))
beforeEach(()=>{jest.clearAllMocks();(readCollectedChain as jest.Mock).mockResolvedValue({rootDocumentId:'root',documents:[],relations:[],builtAt:'now'})})
it('rejects unknown or unauthorized roots before querying downstream data',async()=>{
 const db={query:jest.fn().mockResolvedValue([])}
 await expect(readOrderProgress(db,{id:'b'},['employee'],'TO1',['sales'])).rejects.toMatchObject({status:404})
 expect(db.query).toHaveBeenCalledTimes(1);expect(db.query.mock.calls[0][1]).toEqual(['b','TO1',['employee']]);expect(readCollectedChain).not.toHaveBeenCalled()
})
it('includes unlinked orders and does not limit discovery to the default time range',async()=>{
 const db={query:jest.fn().mockImplementation(async(sql:string)=>sql.startsWith("SELECT 'fulfillment'")?[{kind:'fulfillment',source_id:'1',number:'TO1',display:{},order_status:'no'}]:[])}
 await readOrderProgress(db,{id:'b'},['employee'],'TO1',['sales'])
 const sql=db.query.mock.calls.map(c=>c[0]).join('\n')
 expect(sql).toContain("raw_order_status='no'");expect(sql).not.toContain("interval '1 day'")
 expect(readCollectedChain).toHaveBeenCalledWith(db,{id:'b'},['employee'],'1','fulfillment')
})
it('looks up stock roots with stock ownership and restricts unavailable queue navigation',async()=>{
 const db={query:jest.fn().mockResolvedValueOnce([{kind:'stock',source_id:'s',number:'IO1',display:{}}]).mockResolvedValue([{found:1}])}
 const r=await readOrderProgress(db,{id:'b'},['employee'],'IO1',['sales'])
 expect(r.memberships).toEqual([expect.objectContaining({queue:'stock',accessible:true}),expect.objectContaining({queue:'stock_procurement',accessible:false})])
 expect(readCollectedChain).toHaveBeenCalledWith(db,{id:'b'},['employee'],'s','stock')
})

it('reports dispatch and allocation facts independently without inferring completion',()=>{
 expect(progressConclusions({order_status:'2'},'dispatch_pending',[{rawBillStatus:'B',rawAllocationStatus:'completed'}])).toEqual({fulfillment:'已建单未取号',allocation:'已齐套未审核'})
 expect(progressConclusions({order_status:'5'},'dispatch_synced',[{rawBillStatus:'C',rawAllocationStatus:'completed'}])).toEqual({fulfillment:'部分履约',allocation:'已齐套已审核'})
 expect(progressConclusions({},undefined,[]).allocation).toBe('待确认')
 expect(progressConclusions({},undefined,[{rawBillStatus:'C',rawAllocationStatus:'completed',association:{state:'conflict'}}]).allocation).toBe('待确认')
})

it('keeps full and last-mile tracking separate and ignores cancelled or conflicting dispatches',()=>{
 const r=progressHeader({shopifyOrderNumber:'#1',paidAt:'2026-11-19',dispatchDocuments:[{trackingNumbers:[{type:'full',number:'F'},{type:'last_mile',number:'L'},{type:'full',number:'F'}]},{rawInterceptStatus:'CANCELLED',trackingNumbers:[{type:'full',number:'X'}]},{association:{state:'conflict'},trackingNumbers:[{type:'last_mile',number:'X'}]}]})
 expect(r).toEqual({shopifyOrderNumber:'#1',paidAt:'2026-11-19',fullTrackingNumbers:['F'],lastMileTrackingNumbers:['L']})
})
it('links explicit application references only, never shared SKU or shared order number alone',()=>{
 const graph={documents:[{id:'a',sourceId:'1',number:'AP1',entity:'hzkj_purapplybill'},{id:'p',sourceId:'2',entity:'hzkj_purorderbill'}],relations:[]}
 const rows=(l:any)=>[{source_id:'2',raw:{hzkj_billentry:[l]}}]
 expect(purchaseApplicationEdges(graph,rows({hzkj_salbillnumber:'TO1',hzkj_srcbillnumber:'TO1'}),'TO1')).toEqual([])
 expect(purchaseApplicationEdges(graph,rows({hzkj_salbillnumber:'TO1',hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'1',hzkj_srcbillnumber:'AP1'}),'TO1')).toHaveLength(1)
 expect(purchaseApplicationEdges(graph,rows({hzkj_srcbillentity:'hzkj_purapplybill',hzkj_srcbillid:'1',hzkj_srcbillnumber:'WRONG'}),'TO1')).toEqual([])
})
