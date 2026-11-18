import { mount,flushPromises } from '@vue/test-utils'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import AnalyticsTrendDialog from '@/components/charts/AnalyticsTrendDialog.vue'
import { invalidateSession } from '@/utils/session'
const get=vi.hoisted(()=>vi.fn())
vi.mock('@/api/local-dashboard-analytics',()=>({getLocalDashboardTrend:get}))
vi.mock('@/components/charts/EChart.vue',()=>({default:{name:'EChart',props:['option','label'],template:'<div data-chart />'}}))
const target={dimension:'person' as const,id:'p1',name:'Alex'}
const props={title:'订单量分析',target,targets:[target,{...target,id:'p2',name:'Betty'}],query:{chartId:'order_volume' as const,from:'2026-11-01',to:'2026-11-03',departmentId:'d1',warehouseCode:'01',entityType:'fulfillment' as const},metric:'orders' as const,metricLabel:'订单数',scope:'业务一部 · HangZhou'}
const sample={source:'local',grain:'day',from:'2026-11-01',to:'2026-11-03',orderCount:3,totalQuantity:'5',amount:null,missingAmountCount:0,points:[{period:'2026-11-01',orderCount:3,quantity:'5',amount:null}]}
beforeEach(()=>{get.mockReset();get.mockResolvedValue(sample);HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','')});HTMLDialogElement.prototype.close=vi.fn()})
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks()})
describe('analytics trend dialog',()=>{
 it('carries the applied filters and reaggregates the chosen grain',async()=>{
  const w=mount(AnalyticsTrendDialog,{props,attachTo:document.body});await flushPromises()
  expect(get).toHaveBeenLastCalledWith({...props.query,dimension:'person',id:'p1',grain:'day'})
  const monthly=[...document.querySelectorAll('button')].find(b=>b.textContent==='按月')!;monthly.click();await flushPromises()
  expect(get.mock.lastCall![0]).toMatchObject({grain:'month',departmentId:'d1',warehouseCode:'01'})
  expect(document.querySelector('[aria-modal=true]')).not.toBeNull();w.unmount()
 })
 it('clears old data and rejects a delayed response after target changes',async()=>{
  let finish!:(value:unknown)=>void
  get.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const w=mount(AnalyticsTrendDialog,{props,attachTo:document.body});await flushPromises()
  await w.setProps({target:{...target,id:'p2',name:'Betty'}});await flushPromises()
  expect(document.querySelector('.trend-total strong')?.textContent).toBe('3')
  finish({...sample,orderCount:999});await flushPromises()
  expect(document.querySelector('.trend-total strong')?.textContent).toBe('3')
  get.mockRejectedValueOnce(new Error('Permission changed'));await w.setProps({target});await flushPromises()
  expect(document.querySelector('[data-chart]')).toBeNull()
  expect(document.querySelector('[role=alert]')?.textContent).toContain('趋势暂不可用');w.unmount()
 })
 it('closes and clears data when the session changes; Escape is supported',async()=>{
  const w=mount(AnalyticsTrendDialog,{props,attachTo:document.body});await flushPromises()
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel'));expect(w.emitted('close')).toHaveLength(1)
  invalidateSession();await flushPromises()
  expect(w.emitted('close')).toHaveLength(2);expect(document.querySelector('[data-chart]')).toBeNull();w.unmount()
 })
})
