import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FreightDetailsDialog from '@/components/freight/FreightDetailsDialog.vue'
import { getLocalFreightDetails, exportLocalFreightDetails } from '@/api/local-freight'
import { downloadBlob } from '@/utils/export'
vi.mock('@/api/local-freight',()=>({getLocalFreightDetails:vi.fn(),exportLocalFreightDetails:vi.fn()}))
vi.mock('@/utils/export',()=>({downloadBlob:vi.fn()}))
const query={grain:'month' as const,year:2026,currency:'CNY',dimension:'carrier' as const,dimensionId:'c1',periodId:'2026-11',warehouse:'WH'}
const result={source:'local',currency:'CNY',from:'2026-11-01',to:'2026-11-18',asOf:'2026-11-18T00:00:00Z',total:51,amount:'12.30',page:1,pageSize:50,canExport:true,items:[{id:'1',documentNumber:'FY-real',confirmedAt:'2026-11-18T00:00:00Z',amount:'12.30',weightKg:null,currency:'CNY'}]}
const mountView=()=>mount(FreightDetailsDialog,{props:{query,name:'原生服务商'},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})],stubs:{Teleport:true}}})
beforeEach(()=>{vi.mocked(getLocalFreightDetails).mockReset().mockResolvedValue(result as any);vi.mocked(exportLocalFreightDetails).mockReset().mockResolvedValue(new Blob(['xlsx']));HTMLDialogElement.prototype.showModal=vi.fn();HTMLDialogElement.prototype.close=vi.fn()})
describe('freight native document dialog',()=>{
 it('loads source bills with the selected query, preserves unknown weights and pages without changing scope',async()=>{
  const w=mountView();await flushPromises();expect(w.text()).toContain('FY-real');expect(w.text()).toContain('未提供')
  expect(vi.mocked(getLocalFreightDetails).mock.lastCall?.[0]).toEqual({...query,page:1,pageSize:50})
  await w.get('[aria-label="下一页"]').trigger('click');await flushPromises()
  expect(vi.mocked(getLocalFreightDetails).mock.lastCall?.[0]).toEqual({...query,page:2,pageSize:50});w.unmount()
 })
 it('uses the shared workbench page-size control and resets the page on size changes',async()=>{
  const w=mountView();await flushPromises();await w.get('[aria-label="下一页"]').trigger('click');await flushPromises()
  await w.get('[aria-label="每页条数"]').setValue('1000');await flushPromises()
  expect(vi.mocked(getLocalFreightDetails).mock.lastCall?.[0]).toEqual({...query,page:1,pageSize:1000});w.unmount()
 })
 it('exports the whole selected scope and clears records after permission failures',async()=>{
  const w=mountView();await flushPromises();await w.get('[data-export-details]').trigger('click');await flushPromises()
  expect(vi.mocked(exportLocalFreightDetails).mock.lastCall?.[0]).toEqual(query);expect(downloadBlob).toHaveBeenCalled()
  vi.mocked(getLocalFreightDetails).mockRejectedValueOnce(Error('denied'));await w.get('[aria-label="下一页"]').trigger('click');await flushPromises()
  expect(w.text()).not.toContain('FY-real');expect(w.get('[role=alert]').text()).toContain('加载失败');expect(w.find('[data-export-details]').exists()).toBe(false);w.unmount()
 })
})
