import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import OrderExceptionLabel from '@/components/autoflow/OrderExceptionLabel.vue'
import { installTextTooltips } from '@/utils/textTooltips'
const plugins=()=>[createI18n({legacy:false,locale:'zh-CN',messages:{}})]
let dispose:(()=>void)|undefined
let wrapper:ReturnType<typeof mount>|undefined
afterEach(()=>{dispose?.();dispose=undefined;wrapper?.unmount();wrapper=undefined;document.body.innerHTML='';vi.useRealTimers()})
it('retains refresh label and both metadata lines throughout load, success and offline states',async()=>{
 const control=mount(WorkbenchRefreshControl,{props:{busy:true},global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
 try {
  const button=control.get('button').element,metadata=control.get('.workbench-refresh-status').element
  expect(control.get('button').text()).toBe('刷新')
  expect(control.findAll('.workbench-refresh-status > span')).toHaveLength(2)
  expect(control.text()).toContain('最近查询 — · UTC+8')
  await control.setProps({busy:false,refreshedAt:'2026-11-18T08:23:45Z'})
  expect(control.get('button').element).toBe(button)
  expect(control.get('.workbench-refresh-status').element).toBe(metadata)
  expect(control.text()).toContain('16:23:45')
  await control.get('button').trigger('click');expect(control.emitted('refresh')).toHaveLength(1)
  await control.setProps({offline:true})
  expect(control.get('button').attributes('disabled')).toBeDefined()
  expect(control.get('.workbench-refresh-status').element).toBe(metadata)
 } finally {control.unmount()}
})
it('shows the actual reason after one second on hover or focus, cancels quick passes, and removes a resolved badge',async()=>{
 vi.useFakeTimers()
 wrapper=mount(OrderExceptionLabel,{attachTo:document.body,props:{exception:{type:'outbound_exception',reason:'部分出库无法核实'}},global:{plugins:plugins()}})
 dispose=installTextTooltips()
 const badge=wrapper.get('.workbench-status-badge')
 await badge.trigger('pointerover');vi.advanceTimersByTime(999);expect(document.querySelector('[role=tooltip]')).toBeNull()
 vi.advanceTimersByTime(1);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('部分出库无法核实')
 await badge.trigger('pointerout');expect(document.querySelector('[role=tooltip]')).toBeNull()
 await badge.trigger('pointerover');vi.advanceTimersByTime(500);await badge.trigger('pointerout');vi.advanceTimersByTime(500);expect(document.querySelector('[role=tooltip]')).toBeNull()
 expect(badge.attributes('tabindex')).toBe('0');await badge.trigger('focusin');vi.advanceTimersByTime(1000);expect(document.querySelector('[role=tooltip]')?.textContent).toBe('部分出库无法核实')
 await wrapper.setProps({exception:null});await Promise.resolve();expect(document.querySelector('[role=tooltip]')).toBeNull();expect(wrapper.find('.workbench-status-badge').exists()).toBe(false)
})
it('keeps page boundaries and emits numeric page-size changes without submitting a search form',async()=>{
 wrapper=mount(WorkbenchPagination,{props:{page:1,pageSize:50,pages:3},global:{plugins:plugins()}})
 expect(wrapper.get('[aria-label="上一页"]').attributes('disabled')).toBeDefined()
 await wrapper.get('[aria-label="下一页"]').trigger('click');expect(wrapper.emitted('page')).toEqual([[2]])
 expect(wrapper.findAll('option').map(x=>x.text())).toEqual(['20','50','100','200','500','1000']); await wrapper.get('select').setValue('1000');expect(wrapper.emitted('pageSize')).toEqual([[1000]])
 await wrapper.setProps({page:3});expect(wrapper.get('[aria-label="下一页"]').attributes('disabled')).toBeDefined()
 await wrapper.setProps({disabled:true});expect(wrapper.get('select').attributes('disabled')).toBeDefined()
 expect(wrapper.findAll('button').every(b=>b.attributes('type')==='button')).toBe(true)
})
