import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReceiptNoticesView from '@/views/autoflow/ReceiptNoticesView.vue'
import { getReceiptNotices, type ReceiptNoticePage } from '@/api/receipt-notices'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/receipt-notices',()=>({getReceiptNotices:vi.fn()}))
const page:ReceiptNoticePage={source:'mock',refreshedAt:'2026-11-11T00:00:00Z',total:1,page:1,pageSize:20,departments:[],warehouses:[{code:'HZ',name:'杭州仓'}],totals:{quantity:6,inboundQuantity:2,pendingQuantity:4},items:[{id:'r1',number:'SH001',supplier:'Supplier',warehouse:'杭州仓',warehouseCode:'HZ',shippedAt:'2026-11-10T00:00:00Z',carrier:'顺丰',trackingNumber:'SF001',status:'partial',quantity:6,inboundQuantity:2,pendingQuantity:4,lines:[{id:'1',sku:'SKU1',name:'Product 1',variant:'Blue',imageUrl:null,quantity:2,inboundQuantity:2},{id:'2',sku:'SKU2',name:'Product 2',variant:'Red',imageUrl:null,quantity:4,inboundQuantity:0}]}]}
const wrappers:ReturnType<typeof mount>[]=[]
afterEach(()=>{for(const w of wrappers.splice(0))w.unmount();vi.clearAllMocks();vi.useRealTimers()})
async function setup(){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/workbench/:role',component:ReceiptNoticesView}]})
 await router.push('/workbench/warehouse?queue=receipt_notices')
 const wrapper=mount(ReceiptNoticesView,{global:{plugins:[router,createI18n({legacy:false,locale:'zh-CN',messages:{}})]}});wrappers.push(wrapper);await flushPromises();return {wrapper,router}
}
describe('warehouse receipt notices',()=>{
 it('keeps the same header and refresh controls through initial load, refresh and empty results',async()=>{
  let resolve!:(v:ReceiptNoticePage)=>void
  vi.mocked(getReceiptNotices).mockImplementation(()=>new Promise(done=>{resolve=done}))
  const {wrapper}=await setup()
  const header=wrapper.get('thead').element
  const refresh=wrapper.get('.workbench-refresh').element
  expect(wrapper.find('[role="status"]').exists()).toBe(true)
  resolve(page);await flushPromises()
  expect(wrapper.get('thead').element).toBe(header)
  expect(wrapper.get('.workbench-refresh').element).toBe(refresh)
  await wrapper.get('.workbench-refresh').trigger('click')
  expect(wrapper.get('thead').element).toBe(header)
  resolve({...page,items:[],total:0});await flushPromises()
  expect(wrapper.get('thead').element).toBe(header)
  expect(wrapper.get('.workbench-refresh').element).toBe(refresh)
  expect(wrapper.text()).toContain('暂无符合条件')
 })
 it('does not present uncollected receipt quantities as zero',async()=>{
  vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[],total:0,totals:{quantity:0,inboundQuantity:0,pendingQuantity:0},dataAvailability:{mode:'collected',complete:false,missingDatasets:['receipt_notices'],reason:'收货通知单尚未采集'}})
  const {wrapper}=await setup()
  expect(wrapper.text()).not.toContain('收货通知单尚未采集')
  expect(wrapper.get('.result-count').text()).toBe('—')
  expect(wrapper.text()).not.toContain('收货通知单数据尚未接入')
  expect(wrapper.text()).not.toContain('暂无符合条件')
  expect(wrapper.get('footer').text()).toContain('采购 — 件')
  expect(wrapper.get('footer').text()).not.toContain('采购 0 件')
 })
 it('renders one notice row with all products, quantities and combined logistics',async()=>{
  vi.mocked(getReceiptNotices).mockResolvedValue(page);const {wrapper,router}=await setup()
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);expect(wrapper.findAll('.product')).toHaveLength(2)
  expect(wrapper.text()).toContain('共 1 笔履约订单');expect(wrapper.get('tbody').text()).toContain('部分入库')
  const cell=wrapper.get('td[data-label="物流信息"]');expect(cell.text()).toContain('顺丰');expect(cell.text()).toContain('SF001')
  await router.replace({query:{queue:'receipt_notices',search:'SKU1',inboundStatus:'partial'}});await flushPromises()
  expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({search:'SKU1',status:'partial',page:1}),expect.any(AbortSignal))
  expect(wrapper.findAll('.product')).toHaveLength(2)
 })
 it('does not query while typing, on timers, focus or network changes',async()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval']});vi.mocked(getReceiptNotices).mockResolvedValue(page)
  const {wrapper}=await setup();await wrapper.get('input').setValue('SKU1')
  await vi.advanceTimersByTimeAsync(300000);window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));await flushPromises()
  expect(getReceiptNotices).toHaveBeenCalledTimes(1)
  await wrapper.get('form').trigger('submit');await flushPromises();expect(getReceiptNotices).toHaveBeenCalledTimes(2)
 })
 it('clears records and discards old account responses',async()=>{
  let resolve!:(v:ReceiptNoticePage)=>void;vi.mocked(getReceiptNotices).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
  const {wrapper}=await setup();invalidateSession();resolve(page);await flushPromises();expect(wrapper.find('tbody tr:not(.workbench-state-row)').exists()).toBe(false)
 })
 it('shows an error without inventing a zero count',async()=>{
  vi.mocked(getReceiptNotices).mockRejectedValue(new Error('unavailable'));const {wrapper}=await setup()
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);expect(wrapper.text()).not.toContain('共 0 张')
 })
})
it('renders collected quantities with unknown progress explicitly marked for investigation',async()=>{
 vi.mocked(getReceiptNotices).mockResolvedValue({...page,source:'fop',dataAvailability:{mode:'collected',complete:false,reason:'部分字段待提供'},items:[{...page.items[0]!,shippedAt:null,status:'unknown',inboundQuantity:null,pendingQuantity:null,lines:[{...page.items[0]!.lines[0]!,inboundQuantity:null}]}],totals:{quantity:6,inboundQuantity:null,pendingQuantity:null}})
 const {wrapper}=await setup()
 expect(wrapper.get('td[data-label="发货时间"]').text()).toBe('—')
 expect(wrapper.get('td[data-label="入库进度"]').text()).toBe('待核查')
 expect(wrapper.get('.product').text()).toContain('待入库 —')
 expect(wrapper.get('footer').text()).toContain('采购 6 件 · 已入库 — 件 · 待入库 — 件')
})
it('collapses three receipt source lines locally and retains each inbound quantity after expansion', async () => {
 const first=page.items[0]!
 vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[{...first,lines:[...first.lines,{...first.lines[0]!,id:'3',name:'Third receipt line'}]}]})
 const {wrapper}=await setup()
 expect(wrapper.findAll('.product')).toHaveLength(1)
 await wrapper.get('tbody tr').trigger('click')
 expect(wrapper.findAll('.product')).toHaveLength(1)
 await wrapper.get('.product-lines-toggle').trigger('click')
 expect(wrapper.findAll('.product')).toHaveLength(3)
 expect(wrapper.get('[data-testid=toggle-all-products]').text()).toContain('全部收起')
 await wrapper.get('[data-testid=toggle-all-products]').trigger('click')
 expect(wrapper.findAll('.product')).toHaveLength(1)
 expect(wrapper.get('[data-testid=toggle-all-products]').text()).toContain('全部展开')
 await wrapper.get('[data-testid=toggle-all-products]').trigger('click')
 expect(wrapper.findAll('.product')).toHaveLength(3)

 expect(wrapper.findAll('.product')[2]!.text()).toContain('Third receipt line')
 expect(wrapper.findAll('.product')[2]!.text()).not.toContain('Blue')
 expect(getReceiptNotices).toHaveBeenCalledTimes(1)
})

it('shows one fulfillment order with its receipt numbers and order amount',async()=>{
 vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[{...page.items[0]!,number:'TO001',noticeNumbers:['RN001','RN002'],amount:24.54,currency:'USD'}]})
 const {wrapper}=await setup()
 expect(wrapper.get('td[data-label="订单编号"]').text()).toContain('TO001')
 expect(wrapper.get('td[data-label="收货通知单"]').text()).toContain('RN002')
 expect(wrapper.get('td[data-label="订单金额"]').text()).toContain('$24.54')
})
it('automatically queries warehouse and status changes and retains options during the request',async()=>{
 const data={...page,warehouses:[{code:'01',name:'Hangzhou'},{code:'HNDGLB',name:'Shenzhen'}]}
 vi.mocked(getReceiptNotices).mockResolvedValue(data)
 const {wrapper}=await setup()
 const warehouse=wrapper.findAll('select').find(s=>s.find('option[value="HNDGLB"]').exists())!
 expect(warehouse.text()).toContain('HangZhou');expect(warehouse.text()).toContain('ShenZhen')
 let complete!:(v:ReceiptNoticePage)=>void
 vi.mocked(getReceiptNotices).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
 await warehouse.setValue('HNDGLB');await flushPromises()
 expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({warehouseCode:'HNDGLB',page:1}),expect.any(AbortSignal))
 expect(warehouse.find('option[value="01"]').exists()).toBe(true)
 complete({...data,items:[],total:0});await flushPromises();expect(wrapper.findAll('tbody tr:not(.workbench-state-row)')).toHaveLength(0)
 await wrapper.findAll('select').find(s=>s.find('option[value="partial"]').exists())!.setValue('partial');await flushPromises()
 expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({status:'partial',warehouseCode:'HNDGLB'}),expect.any(AbortSignal))
})

it('shows native purchase, received and pending quantities without borrowing consumer quantity',async()=>{
 const first=page.items[0]!
 vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[{...first,lines:[{...first.lines[0]!,quantity:3,purchaseQuantity:10,inboundQuantity:2,pendingQuantity:8}]}]})
 const {wrapper}=await setup()
 expect(wrapper.get('.product').text()).toContain('采购 10')
 expect(wrapper.get('.product').text()).toContain('已入库 2')
 expect(wrapper.get('.product').text()).toContain('待入库 8')
 expect(getReceiptNotices).toHaveBeenCalledWith(expect.objectContaining({pageSize:100}),expect.any(AbortSignal))
})
it('requeries automatically when clearing a submitted search',async()=>{
 vi.mocked(getReceiptNotices).mockResolvedValue(page)
 const {wrapper}=await setup();await wrapper.get('input').setValue('SKU1');await wrapper.get('form').trigger('submit');await flushPromises()
 await wrapper.get('input').setValue('');await flushPromises()
 expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({search:undefined,page:1}),expect.any(AbortSignal))
})

it('labels an exceptional fulfillment in the normal inbound list',async()=>{
 vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[{...page.items[0]!,exception:{type:'procurement_exception',reason:'采购状态冲突'}}]})
 const {wrapper}=await setup()
 expect(wrapper.get('tbody .order-exception-label').text()).toBe('采购异常')
})

it('requeries when submitting unchanged filters and bypasses cached results on manual refresh',async()=>{
 vi.mocked(getReceiptNotices).mockResolvedValue(page)
 const {wrapper}=await setup()
 await wrapper.get('form').trigger('submit');await flushPromises()
 expect(getReceiptNotices).toHaveBeenCalledTimes(2)
 expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({refresh:true}),expect.any(AbortSignal))
 await wrapper.get('.workbench-refresh').trigger('click');await flushPromises()
 expect(getReceiptNotices).toHaveBeenCalledTimes(3)
 expect(getReceiptNotices).toHaveBeenLastCalledWith(expect.objectContaining({refresh:true}),expect.any(AbortSignal))
})
