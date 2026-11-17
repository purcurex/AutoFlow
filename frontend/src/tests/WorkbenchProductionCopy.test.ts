import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
describe('production workbench copy',()=>{
 it('keeps business instructions and omits internal coverage, pending fields and source reasons',()=>{
  const wrapper=mount(WorkbenchTaskHeading,{props:{title:'待审核清单',description:'已支付、待审核的履约订单。',dataAvailability:{mode:'collected',complete:false,reason:'已采集 API 数据；部分字段待提供，自动调用已暂停。',unclassifiedCount:99,missingDatasets:['receipt_notices']},replica:{readMode:'local',datasetId:'test',revision:'1',dataMode:'collected',sourceSyncedAt:'2026-11-12T00:00:00Z'}}})
  expect(wrapper.text()).toBe('待审核清单已支付、待审核的履约订单。')
  expect(wrapper.find('.collection-notice').exists()).toBe(false)
  wrapper.unmount()
 })
})
