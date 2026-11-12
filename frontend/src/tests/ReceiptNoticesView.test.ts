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
 it('does not present uncollected receipt quantities as zero',async()=>{
  vi.mocked(getReceiptNotices).mockResolvedValue({...page,items:[],total:0,totals:{quantity:0,inboundQuantity:0,pendingQuantity:0},dataAvailability:{mode:'collected',complete:false,missingDatasets:['receipt_notices'],reason:'收货通知单尚未采集'}})
  const {wrapper}=await setup()
  expect(wrapper.text()).toContain('收货通知单尚未采集')
  expect(wrapper.get('.result-count').text()).toBe('— · 待接入')
  expect(wrapper.text()).toContain('收货通知单数据尚未接入')
  expect(wrapper.text()).not.toContain('暂无符合条件')
  expect(wrapper.get('footer').text()).toContain('通知 — 件')
  expect(wrapper.get('footer').text()).not.toContain('通知 0 件')
 })
 it('renders one notice row with all products, quantities and combined logistics',async()=>{
  vi.mocked(getReceiptNotices).mockResolvedValue(page);const {wrapper,router}=await setup()
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);expect(wrapper.findAll('.product')).toHaveLength(2)
  expect(wrapper.text()).toContain('共 1 张收货通知单');expect(wrapper.get('tbody').text()).toContain('部分入库')
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
  const {wrapper}=await setup();invalidateSession();resolve(page);await flushPromises();expect(wrapper.find('tbody').exists()).toBe(false)
 })
 it('shows an error without inventing a zero count',async()=>{
  vi.mocked(getReceiptNotices).mockRejectedValue(new Error('unavailable'));const {wrapper}=await setup()
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);expect(wrapper.text()).not.toContain('共 0 张')
 })
})
