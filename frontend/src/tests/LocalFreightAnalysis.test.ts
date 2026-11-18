import { mount, flushPromises as flushVuePromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import EChartStub from '@/components/charts/EChart.vue'
import LocalFreightAnalysis from '@/components/freight/LocalFreightAnalysis.vue'
import FreightDetailsDialog from '@/components/freight/FreightDetailsDialog.vue'
import { getLocalFreight } from '@/api/local-freight'
vi.mock('@/api/local-freight',()=>({getLocalFreight:vi.fn()}))
vi.mock('@/components/freight/FreightDetailsDialog.vue',()=>({default:{props:['query','name'],template:'<div />'}}))
vi.mock('@/composables/useAnalyticsRefresh',()=>({useAnalyticsRefresh:()=>({updated:vi.fn()})}))
vi.mock('@/components/charts/EChart.vue',()=>({default:{props:['option','label'],template:'<div class="chart-stub" />'}}))
const measure={amount:'12.34',previousAmount:'10',delta:'2.34',percent:23.4}
const sample={source:'local',currency:'CNY',asOf:'2026-11-17T01:00:00Z',periods:[{id:'p',label:'11-09',from:'2026-11-09',to:'2026-11-15',partial:false}],values:[measure],totals:measure,billCount:2,averagePerBill:'6.17',weightKg:'1',weightBillCount:1,costPerKg:'6.17',series:[{id:'native',label:'实际渠道中文名称',values:[measure],totals:measure,billCount:2}],currencies:['CNY'],warehouses:['HangZhou'],quality:{missingCurrencyCount:1,missingDateCount:0}}
const mountView=()=>mount(LocalFreightAnalysis,{global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
beforeEach(()=>{vi.useFakeTimers();vi.mocked(getLocalFreight).mockReset().mockResolvedValue(sample as any)})
afterEach(()=>vi.useRealTimers())
describe('real local freight chart',()=>{
 it('drills chart cells into actual source records only when the backend advertises capability',async()=>{
  vi.mocked(getLocalFreight).mockResolvedValue({...sample,canViewDetails:true,canExport:true} as any)
  const w=mountView();await flushPromises()
  w.findComponent(EChartStub).vm.$emit('select',{seriesIndex:0,dataIndex:0});await flushPromises()
  expect(w.findComponent(FreightDetailsDialog).props('query')).toMatchObject({currency:'CNY',dimension:'carrier',dimensionId:'native',periodId:'p'})
  await w.get('[aria-label="运费仓库"]').setValue('HangZhou');await flushPromises()
  expect(w.findComponent(FreightDetailsDialog).exists()).toBe(false);w.unmount()
 })
 it('drills owner department totals through the same local department scope, not the native department dimension',async()=>{
  vi.mocked(getLocalFreight).mockResolvedValue({...sample,canViewDetails:true,series:[{...sample.series[0],id:'p1',departmentId:'d1',departmentName:'业务一部',englishName:'Alex'}],departmentSeries:[{...sample.series[0],id:'d1',label:'业务一部'}]} as any)
  const w=mountView();await flushPromises();await w.get('[aria-label="运费统计维度"]').setValue('owner');await flushPromises()
  w.findComponent(EChartStub).vm.$emit('select',{seriesIndex:0,dataIndex:0});await flushPromises()
  expect(w.findComponent(FreightDetailsDialog).props('query')).toMatchObject({currency:'CNY',dimension:'owner',departmentId:'d1'})
  expect(w.findComponent(FreightDetailsDialog).props('query').dimensionId).toBeUndefined();w.unmount()
 })
 it('groups owner bars by department with English names and retains native-currency comparison deltas',async()=>{
  const owner=(id:string,dept:string,name:string,amount:string)=>({id,label:'中文名',departmentId:dept,englishName:name,values:[measure],totals:{...measure,amount},billCount:2})
  vi.mocked(getLocalFreight).mockResolvedValue({...sample,series:[owner('p2','d2','Bob','20'),owner('p1','d1','Alex','10')],departmentSeries:[{...sample.series[0],id:'d2',label:'业务二部',totals:{...measure,amount:'20'}},{...sample.series[0],id:'d1',label:'业务一部',totals:{...measure,amount:'10'}}]} as any)
  const w=mountView();await flushPromises();await w.get('[aria-label="运费统计维度"]').setValue('owner');await flushPromises()
  const chart=()=>w.findComponent(EChartStub).props('option') as any
  expect(chart().xAxis.data).toEqual(['业务一部','Alex','','业务二部','Bob'])
  expect(chart().series[0].data.map((r:any)=>r?.value??null)).toEqual([10,10,null,20,20])
  expect(chart().series[0].name).toBe('实际运费')
  expect(chart().tooltip.formatter([{dataIndex:1,seriesIndex:0,value:10}])).toContain('发运单量：2')
  await w.get('input[type=checkbox]').setValue(true)
  expect(chart().series[0].name).toBe('运费变化')
  expect(chart().series[0].data[0].value).toBe(2.34)
  expect(chart().tooltip.formatter([{dataIndex:1,seriesIndex:0,value:2.34}])).toContain('环比：+23.40%')
  w.unmount()
 })
 it('switches every dimension and time axis with accurate comparison tooltips and table values',async()=>{
  const w=mountView();await flushPromises()
  const bounds={week:['2026-06-01','2026-06-07'],month:['2026-06-01','2026-06-30'],year:['2026-06-01','2026-11-17']}
  for(const grain of ['week','month','year'] as const){
   const [from,to]=bounds[grain]
   vi.mocked(getLocalFreight).mockResolvedValue({...sample,periods:[{id:grain,label:grain,from,to,previousFrom:'2026-05-01',previousTo:'2026-05-31',partial:false}]} as any)
   await w.get('[aria-label="运费时间轴"]').setValue(grain);await w.get('button.query').trigger('click');await flushPromises()
   if(grain==='week')expect(w.get('input[type=date]').attributes('min')).toBe('2026-06-01')
   for(const dim of ['carrier','channel','warehouse','country','customer','owner','department']){
    await w.get('[aria-label="运费统计维度"]').setValue(dim);await flushPromises()
    await w.get('input[type=checkbox]').setValue(true)
    const option=w.findComponent(EChartStub).props('option') as any
    expect(option.xAxis.data).toEqual([grain])
    expect(option.series[0].data).toEqual([2.34])
    const tip=option.tooltip.formatter([{seriesName:'实际渠道中文名称',seriesIndex:0,dataIndex:0,value:2.34}])
    expect(tip).toContain('当期');expect(tip).toContain('12.34');expect(tip).toContain('上期');expect(tip).toContain('10.00');expect(tip).toContain('23.40%')
    expect(w.get('tbody').text()).toContain('2.34');expect(w.get('tbody').text()).toContain('23.40%')
    await w.get('input[type=checkbox]').setValue(false)
    expect((w.findComponent(EChartStub).props('option') as any).series[0].data).toEqual([12.34])
   }
  }
  w.unmount()
 })
 it('does not present unavailable annual comparisons as zero',async()=>{
  const unavailable={amount:'12.34',previousAmount:null,delta:null,percent:null}
  vi.mocked(getLocalFreight).mockResolvedValue({...sample,totals:unavailable,values:[unavailable],series:[{...sample.series[0],totals:unavailable,values:[unavailable]}]} as any)
  const w=mountView();await flushPromises();await w.get('input[type=checkbox]').setValue(true)
  expect((w.findComponent(EChartStub).props('option') as any).series[0].data).toEqual([null])
  expect(w.text()).toContain('上期无可比数据');w.unmount()
 })
 it('shows warehouse names while querying by the original warehouse code',async()=>{
  vi.mocked(getLocalFreight).mockResolvedValue({...sample,warehouses:['01','HNDGLB'],warehouseOptions:[{id:'01',name:'HangZhou'},{id:'HNDGLB',name:'ShenZhen'}]} as any)
  const w=mountView();await flushPromises()
  const select=w.get('[aria-label="运费仓库"]')
  expect(select.text()).toContain('HangZhou');expect(select.text()).toContain('ShenZhen')
  await select.setValue('HNDGLB');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0].warehouse).toBe('HNDGLB');w.unmount()
 })
 it('shows native currency, real totals and dimensions without mock labels',async()=>{
  const w=mountView();await flushPromises()
  expect(w.attributes('data-source')).toBe('local')
  expect(w.get('[data-freight-total]').text()).toContain('12.34')
  expect(w.get('[data-freight-total]').text()).not.toContain('$')
  expect(w.text()).toContain('实际渠道中文名称')
  expect(w.text()).toContain('币种缺失 1 单')
  expect(w.text()).not.toContain('Mock')
  w.unmount()
 })
 it('forces manual queries and fetches by native warehouse and dimension',async()=>{
  const w=mountView();await flushPromises();await w.get('select[aria-label="运费仓库"]').setValue('HangZhou');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0].warehouse).toBe('HangZhou')
  await w.get('select[aria-label="运费统计维度"]').setValue('channel');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0].dimension).toBe('channel')
  await w.get('button.query').trigger('click');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[1]).toEqual({force:true});w.unmount()
 })
 it('clears stale totals when permissions or requests fail',async()=>{
  const w=mountView();await flushPromises();vi.mocked(getLocalFreight).mockRejectedValueOnce(Error('forbidden'))
  await w.get('button.query').trigger('click');await flushPromises()
  expect(w.find('[data-freight-total]').exists()).toBe(false)
  expect(w.get('[role=alert]').text()).toContain('加载失败');w.unmount()
 })
 it('advances default UTC+8 dates on refresh across week/year boundaries and retains historical selections',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-12-31T15:59:00Z'))
  const w=mountView();await flushPromises()
  vi.setSystemTime(new Date('2026-12-31T16:01:00Z'))
  await w.get('button.query').trigger('click');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0]).toMatchObject({year:2027,weekOf:'2027-01-01'})
  expect(w.get('select[aria-label="运费年份"]').text()).toContain('2027')
  await w.get('input[type=date]').setValue('2027-01-01');await flushPromises()
  vi.setSystemTime(new Date('2027-01-04T02:00:00Z'))
  await w.get('button.query').trigger('click');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0].weekOf).toBe('2027-01-04')
  await w.get('input[type=date]').setValue('2027-01-02');await flushPromises()
  vi.setSystemTime(new Date('2027-01-11T02:00:00Z'))
  await w.get('button.query').trigger('click');await flushPromises()
  expect(vi.mocked(getLocalFreight).mock.lastCall?.[0].weekOf).toBe('2027-01-02');w.unmount()
 })

})

async function flushPromises(){await flushVuePromises();if(vi.isFakeTimers())await vi.advanceTimersByTimeAsync(200);else await new Promise(resolve=>setTimeout(resolve,205));await flushVuePromises()}
