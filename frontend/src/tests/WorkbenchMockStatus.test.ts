import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { expect, it, vi } from 'vitest'
import WorkbenchReplicaControls from '@/components/autoflow/WorkbenchReplicaControls.vue'
vi.mock('@/api/workbench-replica',()=>({getWorkbenchReplicaStatus:vi.fn().mockResolvedValue({readMode:'local',dataMode:'mock',initialized:true,state:'ready',paused:true,mockGeneratedAt:'2026-11-11T08:00:00Z'}),requestWorkbenchReplicaSync:vi.fn(),getWorkbenchReplicaJob:vi.fn()}))
it('shows only the proven synchronization time without dataset-mode prompts',async()=>{
  const wrapper=mount(WorkbenchReplicaControls,{global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
  await flushPromises()
  expect(wrapper.text()).toContain('最近同步 —')
  expect(wrapper.text()).not.toContain('本地模拟数据')
  expect(wrapper.text()).not.toContain('真实数据')
  expect(wrapper.text()).not.toContain('2026/11/11')
  expect(wrapper.text()).not.toContain('源数据同步于')
  expect(wrapper.find('[data-testid="sync-workbench"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
